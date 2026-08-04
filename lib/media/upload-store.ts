import type { MediaKind } from "./contracts";

const DATABASE_NAME = "cifra-media-pipeline-v1";
const DATABASE_VERSION = 2;
const OPERATIONS_STORE = "operations";
const CHUNKS_STORE = "chunks";
const DEVICE_KEYS_STORE = "device-keys";

export type StoredUploadPhase =
  | "encrypting"
  | "uploading"
  | "processing"
  | "ready"
  | "rejected"
  | "failed"
  | "expired";

export interface StoredMediaOperation {
  operationId: string;
  ownerUserId: string;
  ownerDeviceId: string;
  scopeId: string;
  topicId: string;
  kind: MediaKind;
  fileName: string;
  mimeType: string;
  plaintextSize: number;
  ciphertextSize: number;
  mediaId: string;
  uploadId: string;
  manifestVersion: number;
  expectedParts: number;
  nextPart: number;
  completeIdempotencyKey: string;
  expiresAt: string;
  phase: StoredUploadPhase;
  resumeFrom: "uploading" | "processing" | null;
  progress: number;
  rejectionCode: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMediaChunk {
  id: string;
  operationId: string;
  partNumber: number;
  ciphertext: ArrayBuffer;
  checksumSha256: string;
  sizeBytes: number;
}

export interface StoredDeviceKeys {
  id: string;
  userId: string;
  deviceId: string;
  encryptionKeyId: string;
  encryptionPrivateKey: CryptoKey;
  encryptionPublicJwk: JsonWebKey;
  signatureKeyId: string;
  signaturePrivateKey: CryptoKey;
  signaturePublicJwk: JsonWebKey;
  registrationIdempotencyKey: string;
  registeredKeyVersion: number | null;
  createdAt: string;
}

export class MediaStorageError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "MediaStorageError";
  }
}

export class MediaUploadStore {
  async putOperation(operation: StoredMediaOperation): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction(OPERATIONS_STORE, "readwrite");
    const completed = transactionComplete(transaction);
    transaction.objectStore(OPERATIONS_STORE).put(operation);
    await completed;
  }

  async getOperation(operationId: string): Promise<StoredMediaOperation | null> {
    const database = await openDatabase();
    const transaction = database.transaction(OPERATIONS_STORE, "readonly");
    const completed = transactionComplete(transaction);
    const request = transaction
      .objectStore(OPERATIONS_STORE)
      .get(operationId);
    const result = await requestResult<StoredMediaOperation | undefined>(request);
    await completed;
    return result ?? null;
  }

  async getLatestOperationForScope(
    userId: string,
    deviceId: string,
    topicId: string,
  ): Promise<StoredMediaOperation | null> {
    const database = await openDatabase();
    const transaction = database.transaction(OPERATIONS_STORE, "readonly");
    const completed = transactionComplete(transaction);
    const index = transaction.objectStore(OPERATIONS_STORE).index("scopeId");
    const operations = await requestResult<StoredMediaOperation[]>(
      index.getAll(
        IDBKeyRange.only(mediaOperationScopeId(userId, deviceId, topicId)),
      ),
    );
    await completed;
    return (
      operations.sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      )[0] ?? null
    );
  }

  async putChunk(chunk: StoredMediaChunk): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction(CHUNKS_STORE, "readwrite");
    const completed = transactionComplete(transaction);
    transaction.objectStore(CHUNKS_STORE).put(chunk);
    try {
      await completed;
    } catch (error) {
      if (isQuotaError(error)) {
        throw new MediaStorageError(
          "Браузеру не хватает защищённого локального хранилища для продолжения загрузки",
          "MEDIA_STORAGE_QUOTA_EXCEEDED",
        );
      }
      throw error;
    }
  }

  async getChunk(
    operationId: string,
    partNumber: number,
  ): Promise<StoredMediaChunk | null> {
    const database = await openDatabase();
    const transaction = database.transaction(CHUNKS_STORE, "readonly");
    const completed = transactionComplete(transaction);
    const result = await requestResult<StoredMediaChunk | undefined>(
      transaction
        .objectStore(CHUNKS_STORE)
        .get(chunkId(operationId, partNumber)),
    );
    await completed;
    return result ?? null;
  }

  async deleteChunk(operationId: string, partNumber: number): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction(CHUNKS_STORE, "readwrite");
    const completed = transactionComplete(transaction);
    transaction
      .objectStore(CHUNKS_STORE)
      .delete(chunkId(operationId, partNumber));
    await completed;
  }

  async acknowledgeUploadedPart(
    operation: StoredMediaOperation,
    partNumber: number,
  ): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction(
      [OPERATIONS_STORE, CHUNKS_STORE],
      "readwrite",
    );
    const completed = transactionComplete(transaction);
    transaction.objectStore(OPERATIONS_STORE).put(operation);
    transaction
      .objectStore(CHUNKS_STORE)
      .delete(chunkId(operation.operationId, partNumber));
    await completed;
  }

  async deleteOperation(operationId: string): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction(
      [OPERATIONS_STORE, CHUNKS_STORE],
      "readwrite",
    );
    const completed = transactionComplete(transaction);
    transaction.objectStore(OPERATIONS_STORE).delete(operationId);
    const chunkStore = transaction.objectStore(CHUNKS_STORE);
    const chunkKeys = await requestResult<IDBValidKey[]>(
      chunkStore.index("operationId").getAllKeys(IDBKeyRange.only(operationId)),
    );
    chunkKeys.forEach((key) => chunkStore.delete(key));
    await completed;
  }

  async putDeviceKeys(keys: StoredDeviceKeys): Promise<void> {
    const database = await openDatabase();
    const transaction = database.transaction(DEVICE_KEYS_STORE, "readwrite");
    const completed = transactionComplete(transaction);
    transaction.objectStore(DEVICE_KEYS_STORE).put(keys);
    await completed;
  }

  async getDeviceKeys(id: string): Promise<StoredDeviceKeys | null> {
    const database = await openDatabase();
    const transaction = database.transaction(DEVICE_KEYS_STORE, "readonly");
    const completed = transactionComplete(transaction);
    const result = await requestResult<StoredDeviceKeys | undefined>(
      transaction.objectStore(DEVICE_KEYS_STORE).get(id),
    );
    await completed;
    return result ?? null;
  }
}

export function createStoredChunk(input: {
  operationId: string;
  partNumber: number;
  ciphertext: ArrayBuffer;
  checksumSha256: string;
}): StoredMediaChunk {
  return {
    id: chunkId(input.operationId, input.partNumber),
    operationId: input.operationId,
    partNumber: input.partNumber,
    ciphertext: input.ciphertext,
    checksumSha256: input.checksumSha256,
    sizeBytes: input.ciphertext.byteLength,
  };
}

export function mediaOperationScopeId(
  userId: string,
  deviceId: string,
  topicId: string,
): string {
  return `${userId}:${deviceId}:${topicId}`;
}

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new MediaStorageError(
        "Браузер не предоставляет IndexedDB для безопасного возобновления загрузки",
        "MEDIA_STORAGE_UNAVAILABLE",
      ),
    );
  }
  if (databasePromise) return databasePromise;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      let operations: IDBObjectStore;
      if (!database.objectStoreNames.contains(OPERATIONS_STORE)) {
        operations = database.createObjectStore(OPERATIONS_STORE, {
          keyPath: "operationId",
        });
      } else {
        operations = request.transaction!.objectStore(OPERATIONS_STORE);
      }
      if (!operations.indexNames.contains("topicId")) {
        operations.createIndex("topicId", "topicId", { unique: false });
      }
      if (!operations.indexNames.contains("scopeId")) {
        operations.createIndex("scopeId", "scopeId", { unique: false });
      }
      if (!database.objectStoreNames.contains(CHUNKS_STORE)) {
        const chunks = database.createObjectStore(CHUNKS_STORE, {
          keyPath: "id",
        });
        chunks.createIndex("operationId", "operationId", { unique: false });
      }
      if (!database.objectStoreNames.contains(DEVICE_KEYS_STORE)) {
        database.createObjectStore(DEVICE_KEYS_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(storageFailure(request.error));
    request.onblocked = () =>
      reject(
        new MediaStorageError(
          "Обновление локального media-хранилища заблокировано другой вкладкой",
          "MEDIA_STORAGE_BLOCKED",
        ),
      );
  }).catch((error: unknown) => {
    databasePromise = null;
    throw error;
  });
  databasePromise = opening;
  return opening;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageFailure(request.error));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(storageFailure(transaction.error));
    transaction.onerror = () => reject(storageFailure(transaction.error));
  });
}

function storageFailure(error: DOMException | null): MediaStorageError {
  if (isQuotaError(error)) {
    return new MediaStorageError(
      "Браузеру не хватает локального хранилища для media pipeline",
      "MEDIA_STORAGE_QUOTA_EXCEEDED",
    );
  }
  return new MediaStorageError(
    "Не удалось обратиться к защищённому локальному media-хранилищу",
    "MEDIA_STORAGE_FAILED",
  );
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "QuotaExceededError";
}

function chunkId(operationId: string, partNumber: number): string {
  return `${operationId}:${partNumber}`;
}
