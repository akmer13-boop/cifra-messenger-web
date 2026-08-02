import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_AVATAR_FILE_BYTES,
  configureAvatarAllowedOrigins,
  normalizeSafeAvatarUrl,
  validateAvatarFile,
} from "../app/avatar-policy.mjs";

test("allows local avatars and only explicitly allowed cross-origin HTTPS", () => {
  configureAvatarAllowedOrigins(["https://media.cifra.example/path"]);

  assert.equal(normalizeSafeAvatarUrl("/media/avatar.png"), "/media/avatar.png");
  assert.equal(
    normalizeSafeAvatarUrl("https://web.cifra.example/avatar.png", {
      pageOrigin: "https://web.cifra.example",
    }),
    "https://web.cifra.example/avatar.png",
  );
  assert.equal(
    normalizeSafeAvatarUrl("https://media.cifra.example/avatar.png", {
      pageOrigin: "https://web.cifra.example",
    }),
    "https://media.cifra.example/avatar.png",
  );
  assert.equal(
    normalizeSafeAvatarUrl("https://tracking.example/avatar.png", {
      pageOrigin: "https://web.cifra.example",
    }),
    undefined,
  );
  assert.equal(
    normalizeSafeAvatarUrl("http://media.cifra.example/avatar.png", {
      pageOrigin: "https://web.cifra.example",
    }),
    undefined,
  );
});

test("rejects active image formats and validates upload MIME and size", () => {
  assert.equal(
    normalizeSafeAvatarUrl("data:image/svg+xml;base64,PHN2Zz4="),
    undefined,
  );
  assert.equal(validateAvatarFile({ type: "image/png", size: 1024 }), null);
  assert.match(
    validateAvatarFile({ type: "image/svg+xml", size: 1024 }),
    /PNG, JPEG, WebP и AVIF/,
  );
  assert.match(
    validateAvatarFile({
      type: "image/jpeg",
      size: MAX_AVATAR_FILE_BYTES + 1,
    }),
    /5 МБ/,
  );
});
