import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  CLOUD_CHUNK_SIZE, decideStartupSync, splitEncodedSave, joinAndValidateChunks, shouldCacheActiveData,
  compareMutationVersion, chooseProblemState, chooseProgressState, chooseSettingsState, mergeStateMaps, decomposeLegacySave,
  decodeSettingsRecord, mergeSettingsPayload, findLocalIdsMissingFromCatalog,
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

test("dirty記録を失ってもcatalogにないローカル問題と履歴を再同期対象にする", () => {
  assert.deepEqual(findLocalIdsMissingFromCatalog({
    p: [{ id: "cloud" }, { id: "local-only" }],
    h: { cloud: {}, "progress-only": {} },
  }, ["cloud"]), {
    problemIds: ["local-only"],
    progressIds: ["progress-only"],
  });
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

test("同時刻ではmutationIdで決定する", () => {
  assert.equal(compareMutationVersion({ modifiedAt: 10, mutationId: "b" }, { modifiedAt: 10, mutationId: "a" }), 1);
  assert.equal(chooseProblemState({ modifiedAt: 10, mutationId: "a" }, { modifiedAt: 11, mutationId: "a" }).modifiedAt, 11);
  assert.equal(chooseProgressState({ answeredAt: 12, mutationId: "z" }, { answeredAt: 12, mutationId: "a" }).mutationId, "z");
  assert.equal(chooseSettingsState({ modifiedAt: 1, mutationId: "a" }, { modifiedAt: 2, mutationId: "a" }).modifiedAt, 2);
});

for (const order of ["PC先行", "スマホ先行"]) {
  test(`問題単位マージ: ${order}`, () => {
    const pc = Object.fromEntries([1, 2, 3].map((id) => [String(id), { answeredAt: id === 3 ? 30 : 20, mutationId: `pc-${id}`, payload: `PC-${id}` }]));
    const mobile = Object.fromEntries([3, 4, 5].map((id) => [String(id), { answeredAt: id === 3 ? 40 : 35, mutationId: `mobile-${id}`, payload: `スマホ-${id}` }]));
    const merged = order === "PC先行"
      ? mergeStateMaps(pc, mobile, chooseProgressState)
      : mergeStateMaps(mobile, pc, chooseProgressState);
    assert.deepEqual(Object.fromEntries(Object.entries(merged).map(([id, value]) => [id, value.payload])), {
      "1": "PC-1", "2": "PC-2", "3": "スマホ-3", "4": "スマホ-4", "5": "スマホ-5",
    });
  });
}

test("tombstoneより古い状態では復活しない", () => {
  const tombstone = { modifiedAt: 20, mutationId: "delete", deleted: true };
  const stale = { modifiedAt: 19, mutationId: "edit", deleted: false };
  assert.equal(chooseProblemState(stale, tombstone).deleted, true);
});

test("新設定payloadを優先し、将来の未知フィールドを維持する", () => {
  const legacy = {
    reviewSettings: { first_correct_days: 7, wrong_retry_days: 1 },
    adminCount: 3,
    genreOrder: ["legacy"],
  };
  assert.deepEqual(decodeSettingsRecord(legacy), legacy);

  const record = {
    ...legacy,
    payload: JSON.stringify({
      reviewSettings: { first_correct_days: 14, future_toggle: true },
      adminCount: 5,
      genreOrder: ["new"],
      futureSection: { mode: "advanced" },
    }),
  };
  assert.deepEqual(decodeSettingsRecord(record), {
    reviewSettings: { first_correct_days: 14, wrong_retry_days: 1, future_toggle: true },
    adminCount: 5,
    genreOrder: ["new"],
    futureSection: { mode: "advanced" },
  });

  assert.deepEqual(mergeSettingsPayload(decodeSettingsRecord(record), {
    reviewSettings: { first_correct_days: 21 },
    adminCount: 8,
    genreOrder: ["current"],
  }), {
    reviewSettings: { first_correct_days: 21, wrong_retry_days: 1, future_toggle: true },
    adminCount: 8,
    genreOrder: ["current"],
    futureSection: { mode: "advanced" },
  });
});

test("旧snapshot v5を問題・履歴・設定へ分解", () => {
  const result = decomposeLegacySave({ v: 5, p: [{ id: "p1" }, { id: "p2" }], h: { p1: { attempts: [] } }, s: { first_correct_days: 7 }, a: 12 });
  assert.equal(result.problems.length, 2);
  assert.deepEqual(Object.keys(result.history), ["p1"]);
  assert.equal(result.settings.adminCount, 12);
  assert.equal(decomposeLegacySave({ p: [], h: {} }).settings.adminCount, 3);
  assert.throws(() => decomposeLegacySave({ p: Array.from({ length: 10001 }, (_, id) => ({ id })) }), /10,000/);
});
