import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.has(key) ? values.get(key) : null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
};
globalThis.window = globalThis;
localStorage.setItem("nanikiru-problems-v1", JSON.stringify([{ id: "old-b", note: "second" }, { id: "old-a", note: "first" }]));
localStorage.setItem("nanikiru-dirty-problems-v2", JSON.stringify({ "old-a": { modifiedAt: 1, mutationId: "a" } }));
const store = await import("../docs/problem-store.js");

test("localStorageの旧問題とdirty状態をID単位で安全に移行する", async () => {
  await store.initialize();
  assert.deepEqual((await store.loadAll()).map((item) => item.id), ["old-b", "old-a"]);
  assert.equal(localStorage.getItem("nanikiru-problems-v1"), null);
  assert.equal(localStorage.getItem("nanikiru-dirty-problems-v2"), null);
  const dirty = await store.loadMutations("problem", true);
  assert.deepEqual(dirty.map((item) => item.id), ["old-a"]);
});

test("CRUD、順序、直列化した連続更新を復元する", async () => {
  await store.clear();
  await store.upsertMany([{ problem: { id: "a", n: 1 }, order: 2 }, { problem: { id: "b", n: 1 }, order: 1 }]);
  await Promise.all([store.upsert({ id: "a", n: 2 }, 2), store.upsert({ id: "a", n: 3 }, 2)]);
  await store.remove("b");
  await store.flush();
  assert.deepEqual(await store.loadAll(), [{ id: "a", n: 3 }]);
});

test("10MB超の問題群を個別レコードとして保存・再読込する", async () => {
  await store.clear();
  const payload = "x".repeat(210_000);
  const problems = Array.from({ length: 50 }, (_, order) => ({ problem: { id: `large-${order}`, payload }, order }));
  assert.ok(JSON.stringify(problems).length > 10 * 1024 * 1024);
  await store.upsertMany(problems);
  await store.upsert({ id: "large-25", payload: `${payload}updated` }, 25);
  await store.flush();
  const loaded = await store.loadAll();
  assert.equal(loaded.length, 50);
  assert.equal(loaded[25].payload.endsWith("updated"), true);
});
