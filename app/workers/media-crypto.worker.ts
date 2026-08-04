/// <reference lib="webworker" />

import {
  bytesToHex,
  deriveMediaPartIv,
  mediaPartAad,
} from "../../lib/media/protocol.mjs";

type WorkerRequest =
  | { type: "digest"; requestId: string; file: Blob }
  | {
      type: "encrypt";
      requestId: string;
      file: Blob;
      mediaId: string;
      mediaKey: CryptoKey;
      noncePrefix: Uint8Array;
      maxPlaintextPartBytes: number;
      expectedParts: number;
    }
  | { type: "chunk-ack"; requestId: string; partNumber: number };

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

const workerScope = self as unknown as DedicatedWorkerGlobalScope;
const chunkAcknowledgements = new Map<string, () => void>();

workerScope.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === "chunk-ack") {
    const key = acknowledgementKey(request.requestId, request.partNumber);
    chunkAcknowledgements.get(key)?.();
    chunkAcknowledgements.delete(key);
    return;
  }
  void execute(request);
});

async function execute(
  request: Exclude<WorkerRequest, { type: "chunk-ack" }>,
): Promise<void> {
  try {
    if (request.type === "digest") {
      const checksumSha256 = await sha256Hex(await request.file.arrayBuffer());
      post({ type: "digest-result", requestId: request.requestId, checksumSha256 });
      return;
    }

    for (let partNumber = 0; partNumber < request.expectedParts; partNumber += 1) {
      const start = partNumber * request.maxPlaintextPartBytes;
      const end = Math.min(
        request.file.size,
        start + request.maxPlaintextPartBytes,
      );
      const plaintext = await request.file.slice(start, end).arrayBuffer();
      const ciphertext = await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: deriveMediaPartIv(request.noncePrefix, partNumber)
            .buffer as ArrayBuffer,
          additionalData: mediaPartAad(request.mediaId, partNumber)
            .buffer as ArrayBuffer,
          tagLength: 128,
        },
        request.mediaKey,
        plaintext,
      );
      const checksumSha256 = await sha256Hex(ciphertext);
      post(
        {
          type: "chunk",
          requestId: request.requestId,
          partNumber,
          checksumSha256,
          ciphertext,
        },
        [ciphertext],
      );
      await waitForChunkAcknowledgement(request.requestId, partNumber);
    }
    post({ type: "encrypt-result", requestId: request.requestId });
  } catch (error) {
    post({
      type: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : "Media crypto worker failed",
    });
  }
}

async function sha256Hex(value: ArrayBuffer): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", value)));
}

function waitForChunkAcknowledgement(
  requestId: string,
  partNumber: number,
): Promise<void> {
  return new Promise((resolve) => {
    chunkAcknowledgements.set(
      acknowledgementKey(requestId, partNumber),
      resolve,
    );
  });
}

function acknowledgementKey(requestId: string, partNumber: number): string {
  return `${requestId}:${partNumber}`;
}

function post(message: WorkerResponse, transfer: Transferable[] = []): void {
  workerScope.postMessage(message, transfer);
}

export {};
