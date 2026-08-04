export interface EncryptedMediaChunk {
  partNumber: number;
  checksumSha256: string;
  ciphertext: ArrayBuffer;
}

type PendingRequest =
  | {
      kind: "digest";
      resolve: (checksum: string) => void;
      reject: (error: Error) => void;
    }
  | {
      kind: "encrypt";
      onChunk: (chunk: EncryptedMediaChunk) => Promise<void>;
      resolve: () => void;
      reject: (error: Error) => void;
    };

type WorkerResponse =
  | { type: "digest-result"; requestId: string; checksumSha256: string }
  | {
      type: "chunk";
      requestId: string;
      partNumber: number;
      checksumSha256: string;
      ciphertext: ArrayBuffer;
    }
  | { type: "encrypt-result"; requestId: string }
  | { type: "error"; requestId: string; message: string };

export class MediaCryptor {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingRequest>();

  digestFile(file: Blob): Promise<string> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { kind: "digest", resolve, reject });
      this.getWorker().postMessage({ type: "digest", requestId, file });
    });
  }

  encryptFile(input: {
    file: Blob;
    mediaId: string;
    mediaKey: CryptoKey;
    noncePrefix: Uint8Array;
    maxPlaintextPartBytes: number;
    expectedParts: number;
    onChunk: (chunk: EncryptedMediaChunk) => Promise<void>;
  }): Promise<void> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {
        kind: "encrypt",
        onChunk: input.onChunk,
        resolve,
        reject,
      });
      this.getWorker().postMessage({
        type: "encrypt",
        requestId,
        file: input.file,
        mediaId: input.mediaId,
        mediaKey: input.mediaKey,
        noncePrefix: input.noncePrefix,
        maxPlaintextPartBytes: input.maxPlaintextPartBytes,
        expectedParts: input.expectedParts,
      });
    });
  }

  cancel(): void {
    this.worker?.terminate();
    this.worker = null;
    const error = new Error("Media crypto operation cancelled");
    this.pending.forEach((request) => request.reject(error));
    this.pending.clear();
  }

  dispose(): void {
    this.cancel();
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(
      new URL("../../app/workers/media-crypto.worker.ts", import.meta.url),
      { type: "module", name: "cifra-media-crypto" },
    );
    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      void this.handleResponse(event.data);
    });
    worker.addEventListener("error", () => {
      const error = new Error("Не удалось выполнить шифрование в Web Worker");
      this.pending.forEach((request) => request.reject(error));
      this.pending.clear();
      worker.terminate();
      if (this.worker === worker) this.worker = null;
    });
    this.worker = worker;
    return worker;
  }

  private async handleResponse(response: WorkerResponse): Promise<void> {
    const request = this.pending.get(response.requestId);
    if (!request) return;

    if (response.type === "error") {
      this.pending.delete(response.requestId);
      request.reject(new Error(response.message));
      return;
    }
    if (response.type === "digest-result" && request.kind === "digest") {
      this.pending.delete(response.requestId);
      request.resolve(response.checksumSha256);
      return;
    }
    if (response.type === "chunk" && request.kind === "encrypt") {
      try {
        await request.onChunk({
          partNumber: response.partNumber,
          checksumSha256: response.checksumSha256,
          ciphertext: response.ciphertext,
        });
        this.worker?.postMessage({
          type: "chunk-ack",
          requestId: response.requestId,
          partNumber: response.partNumber,
        });
      } catch (error) {
        this.pending.delete(response.requestId);
        request.reject(
          error instanceof Error ? error : new Error("Не удалось сохранить chunk"),
        );
        this.cancel();
      }
      return;
    }
    if (response.type === "encrypt-result" && request.kind === "encrypt") {
      this.pending.delete(response.requestId);
      request.resolve();
    }
  }
}
