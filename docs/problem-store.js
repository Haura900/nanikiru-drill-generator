// IndexedDB persistence for problem bodies and cloud-sync mutation metadata.
// Records are intentionally stored one-at-a-time: no large JSON blob is written
// when a single problem changes.
const DB_NAME = "nanikiru-drill-generator";
const DB_VERSION = 1;
const LEGACY_PROBLEMS_KEY = "nanikiru-problems-v1";
const LEGACY_DIRTY_PROBLEMS_KEY = "nanikiru-dirty-problems-v2";
const LEGACY_DIRTY_PROGRESS_KEY = "nanikiru-dirty-progress-v2";
const LEGACY_PROBLEM_VERSIONS_KEY = "nanikiru-problem-versions-v2";
const LEGACY_PROGRESS_VERSIONS_KEY = "nanikiru-progress-versions-v2";

let database;
let opened;
let initialized;
let writeQueue = Promise.resolve();

function idbError(event, fallback) { return event?.target?.error || new Error(fallback); }
function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = (event) => reject(idbError(event, "IndexedDB transaction failed"));
  });
}
function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = (event) => reject(idbError(event, "IndexedDB request failed"));
  });
}
function queueWrite(work) {
  const next = writeQueue.then(work, work);
  writeQueue = next.catch(() => {});
  return next;
}
function legacyObject(key) {
  const raw = localStorage.getItem(key);
  if (raw === null) return { present: false, value: {} };
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${key} の形式が不正です。`);
  return { present: true, value };
}
function legacyProblems() {
  const raw = localStorage.getItem(LEGACY_PROBLEMS_KEY);
  if (raw === null) return { present: false, value: [] };
  const parsed = JSON.parse(raw);
  const value = Array.isArray(parsed) ? parsed : parsed?.problems;
  if (!Array.isArray(value)) throw new Error(`${LEGACY_PROBLEMS_KEY} の形式が不正です。`);
  return { present: true, value };
}

async function migrateLegacy() {
  const oldProblems = legacyProblems();
  const oldDirtyProblems = legacyObject(LEGACY_DIRTY_PROBLEMS_KEY);
  const oldDirtyProgress = legacyObject(LEGACY_DIRTY_PROGRESS_KEY);
  const oldProblemVersions = legacyObject(LEGACY_PROBLEM_VERSIONS_KEY);
  const oldProgressVersions = legacyObject(LEGACY_PROGRESS_VERSIONS_KEY);
  const keys = [LEGACY_PROBLEMS_KEY, LEGACY_DIRTY_PROBLEMS_KEY, LEGACY_DIRTY_PROGRESS_KEY, LEGACY_PROBLEM_VERSIONS_KEY, LEGACY_PROGRESS_VERSIONS_KEY];
  if (!keys.some((key) => localStorage.getItem(key) !== null)) return;
  const tx = database.transaction(["problems", "syncMutations", "metadata", "migrationConflicts"], "readwrite");
  const metadata = tx.objectStore("metadata");
  const already = await requestResult(metadata.get("legacy-v1-v2-migrated"));
  if (already?.value) { await transactionDone(tx); return; }
  const problems = tx.objectStore("problems");
  const conflicts = tx.objectStore("migrationConflicts");
  // Existing IndexedDB data is authoritative. A legacy same-ID conflict is kept
  // separately instead of silently overwriting either version.
  for (let order = 0; order < oldProblems.value.length; order += 1) {
    const value = oldProblems.value[order];
    const id = String(value?.id || "");
    if (!id) throw new Error("旧問題データにIDがありません。");
    const existing = await requestResult(problems.get(id));
    if (!existing) problems.put({ id, order, value });
    else if (JSON.stringify(existing.value) !== JSON.stringify(value)) conflicts.put({ key: `problem:${id}`, id, value, importedAt: Date.now() });
  }
  const mutations = tx.objectStore("syncMutations");
  const addMutations = (kind, dirty, versions) => {
    const ids = new Set([...Object.keys(dirty), ...Object.keys(versions)]);
    ids.forEach((id) => {
      const key = `${kind}:${id}`;
      mutations.put({ key, kind, id, version: versions[id] || dirty[id], dirty: Boolean(dirty[id]) });
    });
  };
  addMutations("problem", oldDirtyProblems.value, oldProblemVersions.value);
  addMutations("progress", oldDirtyProgress.value, oldProgressVersions.value);
  metadata.put({ key: "legacy-v1-v2-migrated", value: { at: Date.now(), problemCount: oldProblems.value.length } });
  await transactionDone(tx);
  // Only delete after the transaction committed. A read-back makes the migration
  // retry-safe if a browser terminates us at an unfortunate time.
  const verifyTx = database.transaction("problems", "readonly");
  const verification = await requestResult(verifyTx.objectStore("problems").getAll());
  await transactionDone(verifyTx);
  if (verification.length < new Set(oldProblems.value.map((item) => item.id)).size) throw new Error("旧問題データの移行確認に失敗しました。");
  keys.forEach((key) => localStorage.removeItem(key));
}

export async function initialize() {
  if (initialized) return initialized;
  initialized = (async () => {
    if (!globalThis.indexedDB) throw new Error("このブラウザではIndexedDBを利用できません。");
    if (!opened) opened = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("problems")) db.createObjectStore("problems", { keyPath: "id" });
        if (!db.objectStoreNames.contains("syncMutations")) db.createObjectStore("syncMutations", { keyPath: "key" });
        if (!db.objectStoreNames.contains("metadata")) db.createObjectStore("metadata", { keyPath: "key" });
        if (!db.objectStoreNames.contains("migrationConflicts")) db.createObjectStore("migrationConflicts", { keyPath: "key" });
      };
      request.onblocked = () => reject(new Error("IndexedDBの更新が別のタブでブロックされています。不要なタブを閉じて再読み込みしてください。"));
      request.onerror = (event) => reject(idbError(event, "IndexedDBを開けませんでした。"));
      request.onsuccess = () => { database = request.result; database.onversionchange = () => database.close(); resolve(database); };
    });
    await opened;
    await migrateLegacy();
    return database;
  })();
  return initialized;
}
export async function loadAll() {
  await initialize();
  const tx = database.transaction("problems", "readonly");
  const rows = await requestResult(tx.objectStore("problems").getAll());
  await transactionDone(tx);
  return rows.sort((a, b) => a.order - b.order).map((row) => row.value);
}
export async function get(id) {
  await initialize(); const tx = database.transaction("problems", "readonly");
  const row = await requestResult(tx.objectStore("problems").get(id)); await transactionDone(tx); return row?.value || null;
}
export function upsert(problem, order) { return upsertMany([{ problem, order }]); }
export function upsertMany(entries) { return queueWrite(async () => {
  await initialize(); const tx = database.transaction("problems", "readwrite");
  entries.forEach(({ problem, order }) => tx.objectStore("problems").put({ id: problem.id, order, value: problem }));
  await transactionDone(tx);
}); }
export function remove(id) { return queueWrite(async () => { await initialize(); const tx = database.transaction("problems", "readwrite"); tx.objectStore("problems").delete(id); await transactionDone(tx); }); }
export function removeMany(ids) { return queueWrite(async () => { await initialize(); const tx = database.transaction("problems", "readwrite"); const store = tx.objectStore("problems"); ids.forEach((id) => store.delete(id)); await transactionDone(tx); }); }
export function clear() { return queueWrite(async () => { await initialize(); const tx = database.transaction(["problems", "syncMutations"], "readwrite"); tx.objectStore("problems").clear(); tx.objectStore("syncMutations").clear(); await transactionDone(tx); }); }
export async function replaceAll(values) { return queueWrite(async () => { await initialize(); const tx = database.transaction("problems", "readwrite"); const store = tx.objectStore("problems"); store.clear(); values.forEach((value, order) => store.put({ id: value.id, order, value })); await transactionDone(tx); }); }
export async function flush() { await writeQueue; }
export async function loadMutations(kind, dirtyOnly = false) {
  await initialize(); const tx = database.transaction("syncMutations", "readonly"); const all = await requestResult(tx.objectStore("syncMutations").getAll()); await transactionDone(tx);
  return all.filter((item) => item.kind === kind && (!dirtyOnly || item.dirty));
}
export function putMutation(kind, id, version, dirty) { return queueWrite(async () => { await initialize(); const tx = database.transaction("syncMutations", "readwrite"); const store = tx.objectStore("syncMutations"); const old = await requestResult(store.get(`${kind}:${id}`)); store.put({ key: `${kind}:${id}`, kind, id, version: version || old?.version, dirty: dirty === undefined ? Boolean(old?.dirty) : dirty }); await transactionDone(tx); }); }
export function clearMutationDirty(kind, id, mutationId) { return queueWrite(async () => { await initialize(); const tx = database.transaction("syncMutations", "readwrite"); const store = tx.objectStore("syncMutations"); const row = await requestResult(store.get(`${kind}:${id}`)); if (row && (!mutationId || row.version?.mutationId === mutationId)) store.put({ ...row, dirty: false }); await transactionDone(tx); }); }
export function removeMutations(kind) { return queueWrite(async () => { await initialize(); const tx = database.transaction("syncMutations", "readwrite"); const store = tx.objectStore("syncMutations"); const rows = await requestResult(store.getAll()); rows.filter((row) => row.kind === kind).forEach((row) => store.delete(row.key)); await transactionDone(tx); }); }
export const problemStoreInfo = { DB_NAME, DB_VERSION, stores: ["problems", "syncMutations", "metadata", "migrationConflicts"] };
if (typeof window !== "undefined") window.NanikiruProblemStore = { initialize, loadAll, get, upsert, upsertMany, remove, removeMany, clear, replaceAll, flush, loadMutations, putMutation, clearMutationDirty, removeMutations, problemStoreInfo };
