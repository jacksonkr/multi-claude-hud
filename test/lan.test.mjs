import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveKey, seal, open } from "../lib/lan.mjs";

const key = deriveKey("correct horse battery staple");

test("seal/open round-trips an object", () => {
  const obj = { host: "mac", sessions: [{ sessionId: "x", status: "busy" }], t: 123 };
  const buf = seal(key, obj);
  assert.deepEqual(open(key, buf), obj);
});

test("wrong key cannot decrypt", () => {
  const buf = seal(key, { secret: 42 });
  assert.equal(open(deriveKey("different passphrase"), buf), null);
});

test("tampered ciphertext is rejected by the GCM tag", () => {
  const buf = seal(key, { a: 1 });
  buf[buf.length - 1] ^= 0xff; // flip a byte
  assert.equal(open(key, buf), null);
});

test("non-MCH / short buffers return null, never throw", () => {
  assert.equal(open(key, Buffer.from("hello")), null);
  assert.equal(open(key, Buffer.alloc(0)), null);
  assert.equal(open(key, Buffer.from("XXXXyyyyzzzz")), null);
});

test("deriveKey is deterministic and 32 bytes; empty passphrase is null", () => {
  assert.ok(deriveKey("pw").equals(deriveKey("pw")));
  assert.equal(deriveKey("pw").length, 32);
  assert.equal(deriveKey(""), null);
});

test("no key means open returns null", () => {
  assert.equal(open(null, seal(key, { a: 1 })), null);
});
