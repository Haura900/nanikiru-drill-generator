import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CLOUD_CHUNK_SIZE, decideStartupSync, splitEncodedSave, joinAndValidateChunks, shouldCacheActiveData,
} from "../docs/cloud-sync-core.js";

const hash = async (value) => createHash("sha256").update(value).digest("hex");

test("起動時同期判断の全分岐", () => {
  const decide = (overrides) => decideStartupSync({ hasCloud: true, hasLocal: true, dirty: false, localRevision: 4, cloudRevision: 4, ...overrides });
  assert.equal(decide({ hasCloud: false, hasLocal: true }), "upload");
  assert.equal(decide({ hasCloud: true, hasLocal: false }), "download");
  assert.equal(decide({ cloudRevision: 5 }), "download");
  assert.equal(decide({}), "synced");
  assert.equal(decide({ dirty: true }), "upload");
  assert.equal(decide({ dirty: true, cloudRevision: 5 }), "conflict");
  assert.equal(decide({ isInitialBinding: true }), "choose");
  assert.equal(decide({ localRevision: 5, cloudRevision: 4 }), "conflict");
  assert.equal(decide({ hasCloud: false, hasLocal: false }), "synced");
});

test("600,000文字境界と複数チャンク", () => {
  assert.deepEqual(splitEncodedSave("a".repeat(CLOUD_CHUNK_SIZE)).map((part) => part.length), [600000]);
  assert.deepEqual(splitEncodedSave("a".repeat(CLOUD_CHUNK_SIZE + 1)).map((part) => part.length), [600000, 1]);
});

test("チャンクを結合してSHA-256を検証", async () => {
  const text = `NK3:${"x".repeat(800000)}`;
  const payloads = splitEncodedSave(text).map((payload, index) => ({ index, payload })).reverse();
  assert.equal(await joinAndValidateChunks(payloads, { chunkCount: 2, charLength: text.length, sha256: await hash(text) }, hash), text);
});

test("チャンク不足とSHA不一致を拒否", async () => {
  await assert.rejects(joinAndValidateChunks([{ index: 0, payload: "a" }], { chunkCount: 2, charLength: 2, sha256: await hash("aa") }, hash), /不足/);
  await assert.rejects(joinAndValidateChunks([{ index: 0, payload: "a" }], { chunkCount: 1, charLength: 1, sha256: "0".repeat(64) }, hash), /検証/);
});

test("空データでユーザーキャッシュを上書きしない", () => {
  assert.equal(shouldCacheActiveData({}), false);
  assert.equal(shouldCacheActiveData({ history: "{}", problems: "[]" }), false);
  assert.equal(shouldCacheActiveData({ problems: '[{"id":"a"}]' }), true);
});
