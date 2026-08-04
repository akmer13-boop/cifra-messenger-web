import type {
  CapabilitiesResponse,
  MediaCapabilities,
  MediaCreateUploadInput,
  MediaCreateUploadResponse,
  MediaKind,
  MediaUploadPartResponse,
  MediaView,
  TopicCryptoContext,
} from "./contracts";
import { prepareMediaKey } from "./crypto";
import {
  ensureRegisteredDeviceKeys,
  type DeviceCryptoRegistrationApi,
} from "./device-key-store";
import { MediaCryptor } from "./media-cryptor";
import {
  calculateMediaUploadPlan,
  MEDIA_CIPHER,
} from "./protocol.mjs";
import {
  createStoredChunk,
  mediaOperationScopeId,
  MediaStorageError,
  MediaUploadStore,
  type StoredMediaOperation,
} from "./upload-store";

export type MediaPipelinePhase =
  | "idle"
  | "analyzing"
  | "creating"
  | "encrypting"
  | "uploading"
  | "completing"
  | "processing"
  | "ready"
  | "rejected"
  | "failed"
  | "expired"
  | "cancelled";

export interface MediaPipelineSnapshot {
  phase: MediaPipelinePhase;
  fileName: string;
  kind: MediaKind | null;
  progress: number;
  detail: string;
  mediaId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
  canCancel: boolean;
  canRetry: boolean;
  deliveryBlocked: boolean;
}

export interface MediaUploadApi extends DeviceCryptoRegistrationApi {
  getMediaCapabilities(): Promise<CapabilitiesResponse>;
  getTopicCryptoContext(topicId: string): Promise<TopicCryptoContext>;
  createMediaUpload(
    input: MediaCreateUploadInput,
    idempotencyKey: string,
  ): Promise<MediaCreateUploadResponse>;
  uploadMediaPart(
    uploadId: string,
    partNumber: number,
    ciphertext: ArrayBuffer,
    checksumSha256: string,
  ): Promise<MediaUploadPartResponse>;
  completeMediaUpload(
    uploadId: string,
    idempotencyKey: string,
  ): Promise<MediaView>;
  getMedia(mediaId: string): Promise<MediaView>;
}

export interface StartMediaUploadOptions {
  durationMs?: number;
}

export const EMPTY_MEDIA_PIPELINE_SNAPSHOT: MediaPipelineSnapshot = {
  phase: "idle",
  fileName: "",
  kind: null,
  progress: 0,
  detail: "",
  mediaId: null,
  errorCode: null,
  errorMessage: null,
  retryable: false,
  canCancel: false,
  canRetry: false,
  deliveryBlocked: false,
};

const PROCESSING_POLL_TIMEOUT_MS = 180_000;
const PROCESSING_POLL_INTERVAL_MS = 1_200;

interface MediaOperationScope {
  userId: string;
  deviceId: string;
  scopeId: string;
}

export class MediaUploadCoordinator {
  private readonly store: MediaUploadStore;
  private readonly cryptor = new MediaCryptor();
  private snapshot: MediaPipelineSnapshot = EMPTY_MEDIA_PIPELINE_SNAPSHOT;
  private operation: StoredMediaOperation | null = null;
  private capabilities: CapabilitiesResponse | null = null;
  private runGeneration = 0;
  private disposed = false;

  constructor(
    private readonly api: MediaUploadApi,
    private readonly topicId: string,
    private readonly onSnapshot: (snapshot: MediaPipelineSnapshot) => void,
    store = new MediaUploadStore(),
  ) {
    this.store = store;
  }

  get currentSnapshot(): MediaPipelineSnapshot {
    return this.snapshot;
  }

  async getCapabilities(force = false): Promise<CapabilitiesResponse> {
    if (!force && this.capabilities) return this.capabilities;
    this.capabilities = await this.api.getMediaCapabilities();
    return this.capabilities;
  }

  async loadPending(): Promise<void> {
    if (this.disposed) return;
    const scope = this.requireScope();
    const operation = await this.store.getLatestOperationForScope(
      scope.userId,
      scope.deviceId,
      this.topicId,
    );
    if (!operation || this.disposed) return;
    this.assertCurrentScope(scope);
    this.assertOperationScope(operation, scope);
    this.operation = operation;

    if (operation.phase === "encrypting") {
      await this.failStoredOperation(
        operation,
        "MEDIA_RESELECT_REQUIRED",
        "Вкладка закрылась до завершения шифрования. Исходный файл не сохранялся — выберите его заново.",
        false,
        null,
      );
      return;
    }
    if (operation.phase === "uploading") {
      const generation = this.beginRun();
      await this.executeSafely(generation, () =>
        this.uploadStoredOperation(operation, generation),
      );
      return;
    }
    if (operation.phase === "processing") {
      const generation = this.beginRun();
      await this.executeSafely(generation, () =>
        this.pollProcessing(operation, generation),
      );
      return;
    }
    this.emit(storedOperationSnapshot(operation));
  }

  async start(
    file: File,
    kind: MediaKind,
    options: StartMediaUploadOptions = {},
  ): Promise<void> {
    if (this.disposed) throw new Error("Media pipeline остановлен");
    const scope = this.requireScope();
    if (isBusyPhase(this.snapshot.phase)) {
      throw new Error("Дождитесь завершения текущей media-операции");
    }
    if (this.operation) {
      this.assertOperationScope(this.operation, scope);
      await this.store.deleteOperation(this.operation.operationId);
      this.operation = null;
    }

    const generation = this.beginRun();
    this.emit({
      ...EMPTY_MEDIA_PIPELINE_SNAPSHOT,
      phase: "analyzing",
      fileName: file.name,
      kind,
      progress: 2,
      detail: "Проверяем возможности backend и файл",
      canCancel: true,
    });
    await this.executeSafely(generation, () =>
      this.createEncryptAndUpload(file, kind, options, generation, scope),
    );
  }

  async retry(): Promise<void> {
    if (!this.operation || !this.snapshot.canRetry) return;
    const scope = this.requireScope();
    const generation = this.beginRun();
    const operation = this.operation;
    this.assertOperationScope(operation, scope);
    this.emit({
      ...this.snapshot,
      detail: "Возобновляем media-операцию",
      retryable: false,
      canRetry: false,
    });
    await this.executeSafely(generation, () => {
      if (operation.resumeFrom === "uploading") {
        return this.uploadStoredOperation(operation, generation);
      }
      if (operation.resumeFrom === "processing") {
        return this.pollProcessing(operation, generation);
      }
      throw new MediaPipelineError(
        "MEDIA_RESELECT_REQUIRED",
        "Выберите исходный файл заново",
        false,
      );
    });
  }

  async cancel(): Promise<void> {
    if (["completing", "processing"].includes(this.snapshot.phase)) return;
    if (!isBusyPhase(this.snapshot.phase) && this.snapshot.phase !== "failed") {
      return;
    }
    this.runGeneration += 1;
    this.cryptor.cancel();
    const operation = this.operation;
    this.operation = null;
    if (operation) await this.store.deleteOperation(operation.operationId);
    this.emit({
      ...this.snapshot,
      phase: "cancelled",
      progress: 0,
      detail: "Операция отменена. Серверная upload-сессия истечёт автоматически.",
      errorCode: null,
      errorMessage: null,
      retryable: false,
      canCancel: false,
      canRetry: false,
      deliveryBlocked: false,
    });
  }

  async dismiss(): Promise<void> {
    if (isBusyPhase(this.snapshot.phase)) return;
    const operation = this.operation;
    this.operation = null;
    if (operation) await this.store.deleteOperation(operation.operationId);
    this.emit(EMPTY_MEDIA_PIPELINE_SNAPSHOT);
  }

  dispose(): void {
    this.disposed = true;
    this.runGeneration += 1;
    this.cryptor.dispose();
  }

  private async createEncryptAndUpload(
    file: File,
    kind: MediaKind,
    options: StartMediaUploadOptions,
    generation: number,
    scope: MediaOperationScope,
  ): Promise<void> {
    const capabilities = await this.getCapabilities(true);
    this.assertActive(generation);
    this.assertCurrentScope(scope);
    validateSelectedFile(file, kind, options, capabilities.media);
    const uploadPlan = calculateMediaUploadPlan(
      file.size,
      capabilities.media.maxPlaintextPartBytes,
    );
    if (uploadPlan.expectedParts > capabilities.media.maxParts) {
      throw new MediaPipelineError(
        "MEDIA_TOO_MANY_PARTS",
        "Файл требует больше частей, чем разрешает backend",
        false,
      );
    }

    await ensureRegisteredDeviceKeys(this.api, this.store);
    this.assertActive(generation);
    this.assertCurrentScope(scope);
    this.update({ progress: 8, detail: "Считаем SHA-256 исходного файла" });
    const checksumSha256 = await this.cryptor.digestFile(file);
    this.assertActive(generation);
    this.assertCurrentScope(scope);

    const cryptoContext = await this.api.getTopicCryptoContext(this.topicId);
    this.assertActive(generation);
    this.assertCurrentScope(scope);
    validateCryptoContext(cryptoContext, this.topicId, this.api.currentDeviceId);
    const preparedKey = await prepareMediaKey({
      complianceKeyId: cryptoContext.complianceKey.keyId,
      compliancePublicJwk: cryptoContext.complianceKey.publicJwk,
    });
    this.assertActive(generation);
    this.assertCurrentScope(scope);

    this.update({
      phase: "creating",
      progress: 16,
      detail: "Создаём идемпотентную upload-сессию",
    });
    const createIdempotencyKey = crypto.randomUUID();
    const upload = await this.api.createMediaUpload(
      {
        topic_id: this.topicId,
        kind,
        mime_type: file.type,
        plaintext_size: file.size,
        ciphertext_size: uploadPlan.ciphertextSize,
        checksum_sha256: checksumSha256,
        expected_parts: uploadPlan.expectedParts,
        compliance_key_id: cryptoContext.complianceKey.keyId,
        wrapped_media_dek: preparedKey.wrappedMediaDek,
        media_cipher: MEDIA_CIPHER,
        media_nonce: preparedKey.mediaNonce,
      },
      createIdempotencyKey,
    );
    this.assertActive(generation);
    this.assertCurrentScope(scope);
    validateUploadDescriptor(
      upload,
      this.topicId,
      kind,
      file.size,
      uploadPlan,
      capabilities.media,
      scope.userId,
    );

    const timestamp = new Date().toISOString();
    const operation: StoredMediaOperation = {
      operationId: crypto.randomUUID(),
      ownerUserId: scope.userId,
      ownerDeviceId: scope.deviceId,
      scopeId: scope.scopeId,
      topicId: this.topicId,
      kind,
      fileName: file.name,
      mimeType: file.type,
      plaintextSize: file.size,
      ciphertextSize: uploadPlan.ciphertextSize,
      mediaId: upload.media.id,
      uploadId: upload.upload.id,
      manifestVersion: upload.upload.manifestVersion,
      expectedParts: upload.upload.expectedParts,
      nextPart: 0,
      completeIdempotencyKey: crypto.randomUUID(),
      expiresAt: upload.upload.expiresAt,
      phase: "encrypting",
      resumeFrom: null,
      progress: 20,
      rejectionCode: null,
      errorCode: null,
      errorMessage: null,
      retryable: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.operation = operation;
    await this.store.putOperation(operation);
    this.emit({
      ...this.snapshot,
      phase: "encrypting",
      progress: 20,
      detail: "Шифруем части в отдельном Web Worker",
      mediaId: operation.mediaId,
      canCancel: true,
    });

    await this.cryptor.encryptFile({
      file,
      mediaId: upload.media.id,
      mediaKey: preparedKey.mediaKey,
      noncePrefix: preparedKey.noncePrefix,
      maxPlaintextPartBytes: upload.upload.maxPlaintextPartBytes,
      expectedParts: upload.upload.expectedParts,
      onChunk: async (chunk) => {
        this.assertActive(generation);
        await this.store.putChunk(
          createStoredChunk({
            operationId: operation.operationId,
            partNumber: chunk.partNumber,
            ciphertext: chunk.ciphertext,
            checksumSha256: chunk.checksumSha256,
          }),
        );
        this.assertActive(generation);
        this.update({
          progress:
            20 + Math.round(((chunk.partNumber + 1) / operation.expectedParts) * 25),
          detail: `Зашифровано частей: ${chunk.partNumber + 1} из ${operation.expectedParts}`,
        });
      },
    });
    this.assertActive(generation);
    operation.phase = "uploading";
    operation.resumeFrom = "uploading";
    operation.progress = 45;
    operation.updatedAt = new Date().toISOString();
    await this.store.putOperation(operation);
    await this.uploadStoredOperation(operation, generation);
  }

  private async uploadStoredOperation(
    operation: StoredMediaOperation,
    generation: number,
  ): Promise<void> {
    this.assertActive(generation);
    this.assertOperationScope(operation, this.requireScope());
    this.operation = operation;
    if (new Date(operation.expiresAt).getTime() <= Date.now()) {
      await this.expireOperation(operation);
      return;
    }

    operation.phase = "uploading";
    operation.resumeFrom = "uploading";
    operation.errorCode = null;
    operation.errorMessage = null;
    operation.retryable = false;
    operation.updatedAt = new Date().toISOString();
    await this.store.putOperation(operation);
    this.emit({
      phase: "uploading",
      fileName: operation.fileName,
      kind: operation.kind,
      progress: uploadProgress(operation.nextPart, operation.expectedParts),
      detail: `Загружаем encrypted parts: ${operation.nextPart} из ${operation.expectedParts}`,
      mediaId: operation.mediaId,
      errorCode: null,
      errorMessage: null,
      retryable: false,
      canCancel: true,
      canRetry: false,
      deliveryBlocked: false,
    });

    for (
      let partNumber = operation.nextPart;
      partNumber < operation.expectedParts;
      partNumber += 1
    ) {
      this.assertActive(generation);
      this.assertOperationScope(operation, this.requireScope());
      const chunk = await this.store.getChunk(operation.operationId, partNumber);
      if (!chunk) {
        throw new MediaPipelineError(
          "MEDIA_ENCRYPTED_PART_MISSING",
          "Encrypted part отсутствует в локальном хранилище. Выберите файл заново.",
          false,
        );
      }
      const response = await this.api.uploadMediaPart(
        operation.uploadId,
        partNumber,
        chunk.ciphertext,
        chunk.checksumSha256,
      );
      this.assertActive(generation);
      this.assertOperationScope(operation, this.requireScope());
      if (
        response.partNumber !== partNumber ||
        response.checksumSha256 !== chunk.checksumSha256 ||
        response.sizeBytes !== chunk.sizeBytes
      ) {
        throw new MediaPipelineError(
          "MEDIA_PART_ACK_INVALID",
          "Backend подтвердил другую ciphertext-часть",
          false,
        );
      }
      const acknowledgedOperation: StoredMediaOperation = {
        ...operation,
        nextPart: partNumber + 1,
        progress: uploadProgress(partNumber + 1, operation.expectedParts),
        updatedAt: new Date().toISOString(),
      };
      await this.store.acknowledgeUploadedPart(
        acknowledgedOperation,
        partNumber,
      );
      Object.assign(operation, acknowledgedOperation);
      this.assertActive(generation);
      this.update({
        progress: operation.progress,
        detail: `Загружено encrypted parts: ${operation.nextPart} из ${operation.expectedParts}`,
      });
    }

    this.assertActive(generation);
    this.update({
      phase: "completing",
      progress: 86,
      detail: "Фиксируем upload и запускаем backend processing",
      canCancel: false,
    });
    const media = await this.api.completeMediaUpload(
      operation.uploadId,
      operation.completeIdempotencyKey,
    );
    this.assertActive(generation);
    this.assertOperationScope(operation, this.requireScope());
    validateStoredMediaView(media, operation, "MEDIA_COMPLETE_ACK_INVALID");
    operation.phase = "processing";
    operation.resumeFrom = "processing";
    operation.progress = 90;
    operation.updatedAt = new Date().toISOString();
    await this.store.putOperation(operation);
    await this.pollProcessing(operation, generation, media);
  }

  private async pollProcessing(
    operation: StoredMediaOperation,
    generation: number,
    firstView?: MediaView,
  ): Promise<void> {
    this.assertOperationScope(operation, this.requireScope());
    this.operation = operation;
    operation.phase = "processing";
    operation.resumeFrom = "processing";
    operation.errorCode = null;
    operation.errorMessage = null;
    operation.retryable = false;
    operation.updatedAt = new Date().toISOString();
    await this.store.putOperation(operation);
    this.emit({
      phase: "processing",
      fileName: operation.fileName,
      kind: operation.kind,
      progress: 90,
      detail: "Backend проверяет и обрабатывает encrypted media",
      mediaId: operation.mediaId,
      errorCode: null,
      errorMessage: null,
      retryable: false,
      canCancel: false,
      canRetry: false,
      deliveryBlocked: false,
    });

    const deadline = Date.now() + PROCESSING_POLL_TIMEOUT_MS;
    let media = firstView;
    while (Date.now() < deadline) {
      this.assertActive(generation);
      media ??= await this.api.getMedia(operation.mediaId);
      this.assertActive(generation);
      this.assertOperationScope(operation, this.requireScope());
      validateStoredMediaView(media, operation, "MEDIA_STATUS_INVALID");
      if (media.status === "ready") {
        operation.phase = "ready";
        operation.resumeFrom = null;
        operation.progress = 100;
        operation.updatedAt = new Date().toISOString();
        await this.store.putOperation(operation);
        this.emit({
          ...storedOperationSnapshot(operation),
          detail:
            "Тестовая encrypted-загрузка готова. Для будущей отправки после финального crypto-контракта выберите исходник заново.",
          deliveryBlocked: true,
        });
        return;
      }
      if (media.status === "rejected") {
        operation.phase = "rejected";
        operation.resumeFrom = null;
        operation.rejectionCode = media.rejectionCode;
        operation.errorCode = media.rejectionCode ?? "MEDIA_REJECTED";
        operation.errorMessage = "Backend отклонил media после проверки";
        operation.retryable = false;
        operation.updatedAt = new Date().toISOString();
        await this.store.putOperation(operation);
        this.emit(storedOperationSnapshot(operation));
        return;
      }
      if (media.status === "failed") {
        await this.failStoredOperation(
          operation,
          media.rejectionCode ?? "MEDIA_PROCESSING_FAILED",
          "Backend не смог обработать media",
          false,
          null,
        );
        return;
      }
      if (media.status === "expired") {
        await this.expireOperation(operation);
        return;
      }
      this.update({
        progress: media.status === "processing" ? 96 : media.status === "scanning" ? 93 : 90,
        detail: processingStatusLabel(media.status),
      });
      media = undefined;
      await wait(PROCESSING_POLL_INTERVAL_MS);
    }
    throw new MediaPipelineError(
      "MEDIA_PROCESSING_TIMEOUT",
      "Обработка продолжается дольше ожидаемого. Можно повторить проверку статуса.",
      true,
    );
  }

  private async executeSafely(
    generation: number,
    action: () => Promise<void>,
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      if (!this.isActive(generation)) return;
      const failure = normalizeFailure(error);
      const operation = this.operation;
      if (failure.expired && operation) {
        await this.expireOperation(operation);
        return;
      }
      if (operation) {
        const resumeFrom =
          operation.phase === "processing" || this.snapshot.phase === "processing"
            ? "processing"
            : operation.phase === "uploading" ||
                this.snapshot.phase === "uploading" ||
                this.snapshot.phase === "completing"
              ? "uploading"
              : null;
        await this.failStoredOperation(
          operation,
          failure.code,
          failure.message,
          failure.retryable && resumeFrom !== null,
          resumeFrom,
        );
        return;
      }
      this.emit({
        ...this.snapshot,
        phase: "failed",
        detail: failure.message,
        errorCode: failure.code,
        errorMessage: failure.message,
        retryable: false,
        canCancel: false,
        canRetry: false,
      });
    }
  }

  private async failStoredOperation(
    operation: StoredMediaOperation,
    code: string,
    message: string,
    retryable: boolean,
    resumeFrom: "uploading" | "processing" | null,
  ): Promise<void> {
    operation.phase = "failed";
    operation.resumeFrom = resumeFrom;
    operation.errorCode = code;
    operation.errorMessage = message;
    operation.retryable = retryable;
    operation.updatedAt = new Date().toISOString();
    await this.store.putOperation(operation);
    this.operation = operation;
    this.emit(storedOperationSnapshot(operation));
  }

  private async expireOperation(operation: StoredMediaOperation): Promise<void> {
    operation.phase = "expired";
    operation.resumeFrom = null;
    operation.errorCode = "MEDIA_UPLOAD_EXPIRED";
    operation.errorMessage = "Срок upload-сессии истёк. Выберите файл заново.";
    operation.retryable = false;
    operation.updatedAt = new Date().toISOString();
    await this.store.putOperation(operation);
    this.operation = operation;
    this.emit(storedOperationSnapshot(operation));
  }

  private beginRun(): number {
    this.runGeneration += 1;
    return this.runGeneration;
  }

  private isActive(generation: number): boolean {
    return !this.disposed && generation === this.runGeneration;
  }

  private assertActive(generation: number): void {
    if (!this.isActive(generation)) {
      throw new MediaPipelineError(
        "MEDIA_OPERATION_CANCELLED",
        "Media operation cancelled",
        false,
      );
    }
  }

  private requireScope(): MediaOperationScope {
    const userId = this.api.currentSession?.context.user_id;
    if (!userId) {
      throw new MediaPipelineError(
        "MEDIA_SESSION_REQUIRED",
        "Для media-операции требуется активная backend-сессия",
        false,
      );
    }
    const deviceId = this.api.currentDeviceId;
    return {
      userId,
      deviceId,
      scopeId: mediaOperationScopeId(userId, deviceId, this.topicId),
    };
  }

  private assertCurrentScope(expected: MediaOperationScope): void {
    const current = this.requireScope();
    if (current.scopeId !== expected.scopeId) {
      throw new MediaPipelineError(
        "MEDIA_ACCOUNT_CHANGED",
        "Аккаунт или устройство изменились во время media-операции",
        false,
      );
    }
  }

  private assertOperationScope(
    operation: StoredMediaOperation,
    expected: MediaOperationScope,
  ): void {
    if (
      operation.ownerUserId !== expected.userId ||
      operation.ownerDeviceId !== expected.deviceId ||
      operation.topicId !== this.topicId ||
      operation.scopeId !== expected.scopeId
    ) {
      throw new MediaPipelineError(
        "MEDIA_OPERATION_SCOPE_MISMATCH",
        "Сохранённая media-операция принадлежит другому аккаунту, устройству или чату",
        false,
      );
    }
  }

  private update(patch: Partial<MediaPipelineSnapshot>): void {
    this.emit({ ...this.snapshot, ...patch });
  }

  private emit(snapshot: MediaPipelineSnapshot): void {
    if (this.disposed) return;
    this.snapshot = snapshot;
    this.onSnapshot(snapshot);
  }
}

class MediaPipelineError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly expired = false,
  ) {
    super(message);
    this.name = "MediaPipelineError";
  }
}

function validateSelectedFile(
  file: File,
  kind: MediaKind,
  options: StartMediaUploadOptions,
  capabilities: MediaCapabilities,
): void {
  if (!capabilities.enabled) {
    throw new MediaPipelineError(
      "MEDIA_DISABLED",
      "Backend media pipeline пока выключен",
      false,
    );
  }
  if (!file.size) {
    throw new MediaPipelineError(
      "MEDIA_EMPTY",
      "Нельзя отправить пустой файл",
      false,
    );
  }
  const mimeType = baseMimeType(file.type);
  if (!mimeType) {
    throw new MediaPipelineError(
      "MEDIA_MIME_REQUIRED",
      "Браузер не определил MIME-тип файла",
      false,
    );
  }
  if (
    !capabilities.allowedMimeTypes.some(
      (allowedMimeType) => baseMimeType(allowedMimeType) === mimeType,
    )
  ) {
    throw new MediaPipelineError(
      "MEDIA_MIME_NOT_ALLOWED",
      `Backend не разрешает MIME-тип ${mimeType}`,
      false,
    );
  }
  const byteLimit =
    kind === "voice" ? capabilities.voice.maxBytes : capabilities.maxFileBytes;
  if (file.size > byteLimit) {
    throw new MediaPipelineError(
      "MEDIA_FILE_TOO_LARGE",
      `Размер превышает backend-лимит ${formatBytes(byteLimit)}`,
      false,
    );
  }
  if (kind === "voice") {
    if (!capabilities.voice.enabled) {
      throw new MediaPipelineError(
        "VOICE_DISABLED",
        "Backend voice pipeline пока выключен",
        false,
      );
    }
    if (
      options.durationMs !== undefined &&
      options.durationMs > capabilities.voice.maxDurationSeconds * 1_000
    ) {
      throw new MediaPipelineError(
        "VOICE_TOO_LONG",
        `Голосовое длиннее ${capabilities.voice.maxDurationSeconds} секунд`,
        false,
      );
    }
  }
}

function validateCryptoContext(
  context: TopicCryptoContext,
  topicId: string,
  deviceId: string,
): void {
  if (context.topicId !== topicId) {
    throw new MediaPipelineError(
      "MEDIA_CRYPTO_CONTEXT_INVALID",
      "Backend вернул crypto context другого чата",
      false,
    );
  }
  if (context.senderDeviceId !== deviceId) {
    throw new MediaPipelineError(
      "MEDIA_CRYPTO_CONTEXT_INVALID",
      "Backend вернул crypto context другого устройства",
      false,
    );
  }
  if (new Date(context.expiresAt).getTime() <= Date.now()) {
    throw new MediaPipelineError(
      "MEDIA_CRYPTO_CONTEXT_EXPIRED",
      "Crypto context уже истёк — повторите попытку",
      true,
    );
  }
}

function validateUploadDescriptor(
  upload: MediaCreateUploadResponse,
  topicId: string,
  kind: MediaKind,
  plaintextSize: number,
  plan: { expectedParts: number; ciphertextSize: number },
  capabilities: MediaCapabilities,
  ownerUserId: string,
): void {
  if (
    upload.media.topicId !== topicId ||
    upload.media.ownerId !== ownerUserId ||
    upload.media.kind !== kind ||
    upload.media.plaintextSize !== plaintextSize ||
    upload.media.ciphertextSize !== null ||
    upload.media.manifestVersion !== upload.upload.manifestVersion ||
    upload.upload.expectedParts !== plan.expectedParts ||
    upload.upload.chunkMaxBytes !== capabilities.chunkMaxBytes ||
    upload.upload.maxPlaintextPartBytes !== capabilities.maxPlaintextPartBytes ||
    upload.upload.mediaCipher !== MEDIA_CIPHER ||
    upload.upload.nonceDerivation !== "PREFIX8+PART_UINT32_BE"
  ) {
    throw new MediaPipelineError(
      "MEDIA_UPLOAD_CONTRACT_MISMATCH",
      "Upload descriptor не совпадает с capabilities backend",
      false,
    );
  }
}

function validateStoredMediaView(
  media: MediaView,
  operation: StoredMediaOperation,
  errorCode: "MEDIA_COMPLETE_ACK_INVALID" | "MEDIA_STATUS_INVALID",
): void {
  if (
    media.id !== operation.mediaId ||
    media.topicId !== operation.topicId ||
    media.ownerId !== operation.ownerUserId ||
    media.kind !== operation.kind ||
    media.plaintextSize !== operation.plaintextSize ||
    media.ciphertextSize !== operation.ciphertextSize ||
    media.manifestVersion !== operation.manifestVersion
  ) {
    throw new MediaPipelineError(
      errorCode,
      "Backend вернул данные другой или повреждённой media-операции",
      false,
    );
  }
}

function storedOperationSnapshot(
  operation: StoredMediaOperation,
): MediaPipelineSnapshot {
  const phase = operation.phase;
  const deliveryBlocked = phase === "ready";
  return {
    phase,
    fileName: operation.fileName,
    kind: operation.kind,
    progress: operation.progress,
    detail:
      operation.errorMessage ??
      (deliveryBlocked
        ? "Тестовая encrypted-загрузка готова. Для отправки потребуется повторно выбрать исходник."
        : phase === "rejected"
          ? "Backend отклонил media после проверки"
          : "Media pipeline"),
    mediaId: operation.mediaId,
    errorCode: operation.errorCode,
    errorMessage: operation.errorMessage,
    retryable: operation.retryable,
    canCancel: phase === "failed" && operation.retryable,
    canRetry: phase === "failed" && operation.retryable,
    deliveryBlocked,
  };
}

function normalizeFailure(error: unknown): {
  code: string;
  message: string;
  retryable: boolean;
  expired: boolean;
} {
  if (error instanceof MediaPipelineError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      expired: error.expired,
    };
  }
  if (error instanceof MediaStorageError) {
    return {
      code: error.code,
      message: error.message,
      retryable: false,
      expired: false,
    };
  }
  if (error instanceof Error) {
    const apiError = error as Error & {
      status?: number;
      code?: string;
      retryable?: boolean;
    };
    return {
      code: apiError.code ?? "MEDIA_PIPELINE_FAILED",
      message: apiError.message || "Media pipeline завершился с ошибкой",
      retryable: apiError.retryable === true,
      expired: apiError.status === 410,
    };
  }
  return {
    code: "MEDIA_PIPELINE_FAILED",
    message: "Media pipeline завершился с ошибкой",
    retryable: false,
    expired: false,
  };
}

function isBusyPhase(phase: MediaPipelinePhase): boolean {
  return [
    "analyzing",
    "creating",
    "encrypting",
    "uploading",
    "completing",
    "processing",
  ].includes(phase);
}

function uploadProgress(uploadedParts: number, expectedParts: number): number {
  return 45 + Math.round((uploadedParts / expectedParts) * 39);
}

function baseMimeType(value: string): string {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function processingStatusLabel(status: MediaView["status"]): string {
  if (status === "scanning") return "Backend проверяет media на угрозы";
  if (status === "processing") return "Backend обрабатывает media";
  return "Backend готовит media к обработке";
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024 * 1_024) return `${Math.ceil(bytes / 1_024)} КБ`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} МБ`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
