import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app-check.js";
import { getAuth, GoogleAuthProvider, browserLocalPersistence, setPersistence, signInWithPopup, onAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  getFirestore, doc, collection, getDoc, getDocs, setDoc, deleteDoc, onSnapshot,
  runTransaction, serverTimestamp, query, orderBy, writeBatch,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { firebaseConfig, appCheckConfig, isFirebaseConfigured } from "./firebase-config.js?v=20260712-1";
import {
  CLOUD_SCHEMA_VERSION, MAX_PROBLEMS_PER_USER, MAX_PROBLEM_PAYLOAD_CHARS, MAX_PROGRESS_PAYLOAD_CHARS,
  compareMutationVersion, chooseProblemState, chooseProgressState, chooseSettingsState,
  nextMutationVersion, joinAndValidateChunks, decomposeLegacySave,
} from "./cloud-sync-core.js?v=20260712-1";

const DEVICE_ID_KEY = "nanikiru-device-id-v1";
const BOUND_UID_KEY = "nanikiru-bound-uid-v1";
const DIRTY_PROBLEMS_KEY = "nanikiru-dirty-problems-v2";
const DIRTY_PROGRESS_KEY = "nanikiru-dirty-progress-v2";
const DIRTY_SETTINGS_KEY = "nanikiru-dirty-settings-v2";
const PROBLEM_VERSIONS_KEY = "nanikiru-problem-versions-v2";
const PROGRESS_VERSIONS_KEY = "nanikiru-progress-versions-v2";
const SETTINGS_VERSION_KEY = "nanikiru-settings-version-v2";
const REPLACE_CLOUD_KEY = "nanikiru-replace-cloud-from-backup-v2";
const ACTIVE_KEYS = ["nanikiru-problems-v1", "nanikiru-learning-v1", "nanikiru-review-settings-v1", "nanikiru-admin-count-v1", "nanikiru-genre-order-v1"];
const listeners = new Set();
const state = { configured: false, ready: false, user: null, status: "クラウドを確認しています", error: "", lastSync: null, dirty: false, syncing: false };
let auth;
let db;
let uploadTimer;
let applyingCloud = false;
let syncPromise = null;
let subscriptions = [];
let initialAuthResolved;
const initialAuthPromise = new Promise((resolve) => { initialAuthResolved = resolve; });

const deviceId = (() => {
  let value = localStorage.getItem(DEVICE_ID_KEY);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(DEVICE_ID_KEY, value); }
  return value;
})();

const readObject = (key) => { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch { return {}; } };
const writeObject = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const hasDirty = () => Object.keys(readObject(DIRTY_PROBLEMS_KEY)).length > 0 || Object.keys(readObject(DIRTY_PROGRESS_KEY)).length > 0 || Boolean(localStorage.getItem(DIRTY_SETTINGS_KEY));

function emit(patch = {}) {
  Object.assign(state, patch);
  renderState();
  listeners.forEach((listener) => { try { listener({ ...state }); } catch (error) { console.error(error); } });
}

function messageFor(error) {
  console.error("Cloud sync error", error?.code || error?.name || "unknown");
  if (!navigator.onLine) return "オフライン・未同期";
  if (error?.code === "permission-denied") return "同期の権限がありません";
  if (error?.code === "auth/unauthorized-domain") return "このドメインはGoogleログインを許可されていません";
  return error?.message || "同期に失敗しました";
}

function waitForSaveApi() {
  if (window.NanikiruSaveData) return Promise.resolve(window.NanikiruSaveData);
  return new Promise((resolve) => window.addEventListener("nanikiru-app-ready", () => resolve(window.NanikiruSaveData), { once: true }));
}

function monotonicDirty(mapKey, versionsKey, id, timeField, deleted = false) {
  if (applyingCloud) return;
  const dirty = readObject(mapKey);
  const versions = readObject(versionsKey);
  const version = nextMutationVersion(dirty[id] || versions[id], timeField);
  dirty[id] = { ...version, deleted };
  versions[id] = version;
  writeObject(mapKey, dirty); writeObject(versionsKey, versions);
  scheduleUpload();
}

function markProblemDirty(problemId, { deleted = false } = {}) {
  if (typeof problemId === "string" && problemId) monotonicDirty(DIRTY_PROBLEMS_KEY, PROBLEM_VERSIONS_KEY, problemId, "modifiedAt", deleted);
}

function markProgressDirty(problemId, { deleted = false } = {}) {
  if (typeof problemId === "string" && problemId) monotonicDirty(DIRTY_PROGRESS_KEY, PROGRESS_VERSIONS_KEY, problemId, "answeredAt", deleted);
}

function markSettingsDirty() {
  if (applyingCloud) return;
  const previous = readObject(SETTINGS_VERSION_KEY);
  const version = nextMutationVersion(previous, "modifiedAt");
  writeObject(SETTINGS_VERSION_KEY, version);
  writeObject(DIRTY_SETTINGS_KEY, version);
  scheduleUpload();
}

function markAllDirty({ problemIds = [], progressIds = [], replaceCloud = false } = {}) {
  problemIds.forEach((id) => markProblemDirty(id));
  progressIds.forEach((id) => markProgressDirty(id));
  markSettingsDirty();
  if (replaceCloud) localStorage.setItem(REPLACE_CLOUD_KEY, "1");
}

function scheduleUpload() {
  clearTimeout(uploadTimer);
  emit({ dirty: true, status: state.user ? (navigator.onLine ? "未同期の変更があります" : "オフライン・未同期") : "ローカルに未同期の変更があります" });
  if (state.user && navigator.onLine) uploadTimer = setTimeout(() => syncNow(), 1800);
}

function catalogRef(uid) { return doc(db, "users", uid, "sync", "catalog"); }
function problemRef(uid, id) { return doc(db, "users", uid, "problems", id); }
function progressRef(uid, id) { return doc(db, "users", uid, "progress", id); }
function settingsRef(uid) { return doc(db, "users", uid, "settings", "main"); }
function migrationRef(uid) { return doc(db, "users", uid, "migration", "state"); }

async function ensureCatalog(uid, ids) {
  if (!ids.length) return;
  await runTransaction(db, async (transaction) => {
    const ref = catalogRef(uid);
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists() ? snapshot.data().problemIds || [] : [];
    const merged = [...new Set([...existing, ...ids])];
    if (merged.length > MAX_PROBLEMS_PER_USER) throw new Error("問題数が10,000問を超えるため同期できません。データ画面からバックアップを保存してください。");
    transaction.set(ref, { schemaVersion: CLOUD_SCHEMA_VERSION, problemIds: merged, updatedAt: serverTimestamp(), updatedBy: deviceId });
  });
}

function problemRecord(problemId, value, version) {
  const payload = version.deleted ? "" : JSON.stringify(value);
  if (payload.length > MAX_PROBLEM_PAYLOAD_CHARS) throw new Error(`問題 ${problemId} のデータが大きすぎます`);
  return { schemaVersion: 2, problemId, payload, modifiedAt: version.modifiedAt, mutationId: version.mutationId, updatedAt: serverTimestamp(), updatedBy: deviceId, deleted: Boolean(version.deleted) };
}

function progressRecord(problemId, value, version) {
  const payload = version.deleted ? "" : JSON.stringify(value);
  if (payload.length > MAX_PROGRESS_PAYLOAD_CHARS) throw new Error(`履歴 ${problemId} のデータが大きすぎます`);
  return { schemaVersion: 2, problemId, payload, answeredAt: version.answeredAt, mutationId: version.mutationId, updatedAt: serverTimestamp(), updatedBy: deviceId, deleted: Boolean(version.deleted) };
}

async function uploadRecord({ uid, id, local, ref, chooser, timeField, dirtyKey, versionsKey }) {
  let remoteWinner = null;
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    const remote = snapshot.exists() ? snapshot.data() : null;
    const winner = chooser(local, remote);
    if (winner === local) transaction.set(ref, local);
    else remoteWinner = remote;
  });
  const dirty = readObject(dirtyKey);
  if (dirty[id]?.mutationId === local.mutationId) { delete dirty[id]; writeObject(dirtyKey, dirty); }
  const versions = readObject(versionsKey);
  const winner = remoteWinner || local;
  versions[id] = { [timeField]: winner[timeField], mutationId: winner.mutationId };
  writeObject(versionsKey, versions);
  if (remoteWinner) await applyRemoteRecords(remoteWinner, ref.path.includes("/progress/") ? "progress" : "problem");
}

async function syncDirty(uid) {
  const api = await waitForSaveApi();
  if (localStorage.getItem(REPLACE_CLOUD_KEY) === "1") {
    const catalog = await getDoc(catalogRef(uid));
    const localSave = api.buildSaveData();
    const localProblems = new Set(localSave.p.map((problem) => problem.id));
    const localProgress = new Set(Object.keys(localSave.h || {}));
    (catalog.exists() ? catalog.data().problemIds || [] : []).forEach((id) => {
      if (!localProblems.has(id)) markProblemDirty(id, { deleted: true });
      if (!localProgress.has(id)) markProgressDirty(id, { deleted: true });
    });
  }
  const dirtyProblems = readObject(DIRTY_PROBLEMS_KEY);
  const dirtyProgress = readObject(DIRTY_PROGRESS_KEY);
  await ensureCatalog(uid, [...new Set([...Object.keys(dirtyProblems), ...Object.keys(dirtyProgress)])]);
  for (const [id, version] of Object.entries(dirtyProblems)) {
    const local = problemRecord(id, api.getProblem(id), version);
    await uploadRecord({ uid, id, local, ref: problemRef(uid, id), chooser: chooseProblemState, timeField: "modifiedAt", dirtyKey: DIRTY_PROBLEMS_KEY, versionsKey: PROBLEM_VERSIONS_KEY });
  }
  for (const [id, version] of Object.entries(dirtyProgress)) {
    const local = progressRecord(id, api.getProgress(id), version);
    await uploadRecord({ uid, id, local, ref: progressRef(uid, id), chooser: chooseProgressState, timeField: "answeredAt", dirtyKey: DIRTY_PROGRESS_KEY, versionsKey: PROGRESS_VERSIONS_KEY });
  }
  const dirtySettings = readObject(DIRTY_SETTINGS_KEY);
  if (dirtySettings.mutationId) {
    const value = api.getSettings();
    const local = { schemaVersion: 2, ...value, ...dirtySettings, updatedAt: serverTimestamp(), updatedBy: deviceId };
    let remoteWinner = null;
    await runTransaction(db, async (transaction) => {
      const ref = settingsRef(uid); const snapshot = await transaction.get(ref); const remote = snapshot.exists() ? snapshot.data() : null;
      if (chooseSettingsState(local, remote) === local) transaction.set(ref, local); else remoteWinner = remote;
    });
    if (readObject(DIRTY_SETTINGS_KEY).mutationId === dirtySettings.mutationId) localStorage.removeItem(DIRTY_SETTINGS_KEY);
    writeObject(SETTINGS_VERSION_KEY, { modifiedAt: (remoteWinner || local).modifiedAt, mutationId: (remoteWinner || local).mutationId });
    if (remoteWinner) await applyRemoteRecords(remoteWinner, "settings");
  }
  if (!hasDirty()) localStorage.removeItem(REPLACE_CLOUD_KEY);
}

async function applyRemoteRecords(record, type) {
  const api = await waitForSaveApi();
  applyingCloud = true;
  try {
    if (type === "problem") {
      const versions = readObject(PROBLEM_VERSIONS_KEY); const local = versions[record.problemId];
      if (compareMutationVersion(record, local, "modifiedAt") < 0) return;
      const value = record.deleted ? null : JSON.parse(record.payload);
      await api.applyCloudRecords({ problemRecords: [{ problemId: record.problemId, deleted: record.deleted, value }] });
      versions[record.problemId] = { modifiedAt: record.modifiedAt, mutationId: record.mutationId }; writeObject(PROBLEM_VERSIONS_KEY, versions);
      const dirty = readObject(DIRTY_PROBLEMS_KEY); if (dirty[record.problemId] && compareMutationVersion(record, dirty[record.problemId], "modifiedAt") >= 0) { delete dirty[record.problemId]; writeObject(DIRTY_PROBLEMS_KEY, dirty); }
    } else if (type === "progress") {
      const versions = readObject(PROGRESS_VERSIONS_KEY); const local = versions[record.problemId];
      if (compareMutationVersion(record, local, "answeredAt") < 0) return;
      const value = record.deleted ? null : JSON.parse(record.payload);
      await api.applyCloudRecords({ progressRecords: [{ problemId: record.problemId, deleted: record.deleted, value }] });
      versions[record.problemId] = { answeredAt: record.answeredAt, mutationId: record.mutationId }; writeObject(PROGRESS_VERSIONS_KEY, versions);
      const dirty = readObject(DIRTY_PROGRESS_KEY); if (dirty[record.problemId] && compareMutationVersion(record, dirty[record.problemId], "answeredAt") >= 0) { delete dirty[record.problemId]; writeObject(DIRTY_PROGRESS_KEY, dirty); }
    } else {
      const local = readObject(SETTINGS_VERSION_KEY); if (compareMutationVersion(record, local, "modifiedAt") < 0) return;
      await api.applyCloudRecords({ settingsRecord: { reviewSettings: record.reviewSettings, adminCount: record.adminCount, genreOrder: record.genreOrder } });
      writeObject(SETTINGS_VERSION_KEY, { modifiedAt: record.modifiedAt, mutationId: record.mutationId });
    }
  } finally { applyingCloud = false; }
}

function subscribeRealtime(uid) {
  subscriptions.forEach((unsubscribe) => unsubscribe()); subscriptions = [];
  subscriptions.push(onSnapshot(collection(db, "users", uid, "problems"), (snapshot) => snapshot.docChanges().forEach((change) => { if (change.type !== "removed") applyRemoteRecords(change.doc.data(), "problem").catch(handleError); }), handleError));
  subscriptions.push(onSnapshot(collection(db, "users", uid, "progress"), (snapshot) => snapshot.docChanges().forEach((change) => { if (change.type !== "removed") applyRemoteRecords(change.doc.data(), "progress").catch(handleError); }), handleError));
  subscriptions.push(onSnapshot(settingsRef(uid), (snapshot) => { if (snapshot.exists()) applyRemoteRecords(snapshot.data(), "settings").catch(handleError); }, handleError));
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function migrateLegacy(uid) {
  const migration = await getDoc(migrationRef(uid));
  if (migration.exists() && migration.data().completed) return;
  const oldMetaRef = doc(db, "users", uid, "sync", "meta");
  const oldMetaSnapshot = await getDoc(oldMetaRef);
  if (!oldMetaSnapshot.exists()) {
    await setDoc(migrationRef(uid), { schemaVersion: 2, completed: true, problemCount: 0, progressCount: 0, updatedAt: serverTimestamp(), updatedBy: deviceId });
    return;
  }
  const meta = oldMetaSnapshot.data();
  const manifestSnapshot = await getDoc(doc(db, "users", uid, "snapshots", meta.snapshotId));
  if (!manifestSnapshot.exists()) throw new Error("旧クラウドデータの保存情報がありません");
  const chunksSnapshot = await getDocs(query(collection(db, "users", uid, "snapshots", meta.snapshotId, "chunks"), orderBy("index")));
  const encoded = await joinAndValidateChunks(chunksSnapshot.docs.map((item) => item.data()), meta, sha256);
  const api = await waitForSaveApi(); const decoded = await api.decodeSaveData(encoded); const legacy = decomposeLegacySave(decoded);
  await api.applySaveData(decoded, { scheduleUpload: false });
  markAllDirty({ problemIds: legacy.problems.map((problem) => problem.id), progressIds: Object.keys(legacy.history) });
  await syncDirty(uid);
  const [problemsSnapshot, progressSnapshot] = await Promise.all([getDocs(collection(db, "users", uid, "problems")), getDocs(collection(db, "users", uid, "progress"))]);
  if (problemsSnapshot.size !== legacy.problems.length || progressSnapshot.size !== Object.keys(legacy.history).length) throw new Error("旧データの移行後検証に失敗しました");
  await setDoc(migrationRef(uid), { schemaVersion: 2, completed: true, problemCount: problemsSnapshot.size, progressCount: progressSnapshot.size, updatedAt: serverTimestamp(), updatedBy: deviceId });
  const batch = writeBatch(db); chunksSnapshot.docs.forEach((item) => batch.delete(item.ref)); batch.delete(manifestSnapshot.ref); batch.delete(oldMetaRef); await batch.commit();
}

async function syncNow() {
  if (!state.user || !navigator.onLine) return;
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    emit({ syncing: true, status: "同期中", error: "" });
    await syncDirty(state.user.uid);
    emit({ dirty: hasDirty(), status: hasDirty() ? "未同期の変更があります" : "同期済み", lastSync: new Date() });
  })().catch((error) => { handleError(error); throw error; }).finally(() => { syncPromise = null; emit({ syncing: false }); });
  return syncPromise;
}

async function signIn() {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (error) { emit({ error: messageFor(error) }); }
}

async function signOut() {
  if (!state.user) return;
  const cache = {}; ACTIVE_KEYS.forEach((key) => { const value = localStorage.getItem(key); if (value !== null) cache[key] = value; });
  localStorage.setItem(`nanikiru-user-cache-v2:${state.user.uid}`, JSON.stringify(cache));
  [...ACTIVE_KEYS, BOUND_UID_KEY, DIRTY_PROBLEMS_KEY, DIRTY_PROGRESS_KEY, DIRTY_SETTINGS_KEY, PROBLEM_VERSIONS_KEY, PROGRESS_VERSIONS_KEY, SETTINGS_VERSION_KEY, REPLACE_CLOUD_KEY].forEach((key) => localStorage.removeItem(key));
  await firebaseSignOut(auth); location.reload();
}

async function deleteCloudData() {
  if (!state.user) return;
  const uid = state.user.uid;
  for (const name of ["problems", "progress"]) {
    const snapshot = await getDocs(collection(db, "users", uid, name));
    for (let offset = 0; offset < snapshot.docs.length; offset += 400) { const batch = writeBatch(db); snapshot.docs.slice(offset, offset + 400).forEach((item) => batch.delete(item.ref)); await batch.commit(); }
  }
  for (const ref of [catalogRef(uid), settingsRef(uid), migrationRef(uid)]) await deleteDoc(ref).catch(() => {});
}

function handleError(error) { emit({ error: messageFor(error), status: navigator.onLine ? "同期に失敗しました" : "オフライン・未同期", syncing: false }); }

async function handleSignedIn(user) {
  await waitForSaveApi(); emit({ user, status: "クラウドを確認しています", error: "" });
  const bound = localStorage.getItem(BOUND_UID_KEY);
  if (bound && bound !== user.uid) {
    [...ACTIVE_KEYS, DIRTY_PROBLEMS_KEY, DIRTY_PROGRESS_KEY, DIRTY_SETTINGS_KEY, PROBLEM_VERSIONS_KEY, PROGRESS_VERSIONS_KEY, SETTINGS_VERSION_KEY].forEach((key) => localStorage.removeItem(key));
    await window.NanikiruSaveData.reload();
  }
  localStorage.setItem(BOUND_UID_KEY, user.uid);
  await migrateLegacy(user.uid);
  const catalog = await getDoc(catalogRef(user.uid));
  const api = await waitForSaveApi();
  if (!catalog.exists() && api.hasMeaningfulLocalData()) {
    const save = api.buildSaveData();
    markAllDirty({ problemIds: save.p.map((problem) => problem.id), progressIds: Object.keys(save.h || {}) });
  }
  subscribeRealtime(user.uid);
  if (hasDirty()) await syncNow(); else emit({ dirty: false, status: "同期済み", lastSync: new Date() });
}

function renderState() {
  const signedOut = document.getElementById("cloud-signed-out"); const signedIn = document.getElementById("cloud-signed-in"); if (!signedOut) return;
  signedOut.classList.toggle("hidden", Boolean(state.user)); signedIn?.classList.toggle("hidden", !state.user);
  const login = document.getElementById("cloud-login-button"); if (login) login.disabled = !state.configured;
  const user = document.getElementById("cloud-user"); if (user) user.textContent = state.user ? `${state.user.displayName || "Googleユーザー"}${state.user.email ? `（${state.user.email}）` : ""}` : "";
  const status = document.getElementById("cloud-status"); if (status) status.textContent = state.status;
  const last = document.getElementById("cloud-last-sync"); if (last) last.textContent = state.lastSync ? `最終同期: ${state.lastSync.toLocaleString("ja-JP")}` : "";
  const error = document.getElementById("cloud-error"); if (error) { error.textContent = state.error; error.className = `message ${state.error ? "error" : "hidden"}`; }
}

function bindUi() {
  document.getElementById("cloud-login-button")?.addEventListener("click", signIn);
  document.getElementById("cloud-logout-button")?.addEventListener("click", signOut);
  document.getElementById("cloud-sync-now")?.addEventListener("click", () => syncNow().catch(() => {})); renderState();
}

async function initialize() {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindUi, { once: true }); else bindUi();
  if (!isFirebaseConfigured()) { emit({ ready: true, configured: false, status: "クラウド同期は未設定です" }); initialAuthResolved(); return; }
  try {
    const app = initializeApp(firebaseConfig);
    if (!appCheckConfig.recaptchaEnterpriseSiteKey) throw new Error("App Checkのサイトキーが未設定です");
    const debugToken = localStorage.getItem("nanikiru-app-check-debug-token-local");
    if (debugToken && location.hostname === "localhost") self.FIREBASE_APPCHECK_DEBUG_TOKEN = debugToken;
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckConfig.recaptchaEnterpriseSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
    auth = getAuth(app); db = getFirestore(app); await setPersistence(auth, browserLocalPersistence);
    emit({ configured: true, status: "クラウドを確認しています" });
    onAuthStateChanged(auth, async (user) => {
      try { if (user) await handleSignedIn(user); else emit({ user: null, dirty: hasDirty(), status: hasDirty() ? "ローカルに未同期の変更があります" : "ログインしていません" }); }
      catch (error) { handleError(error); }
      if (!state.ready) { emit({ ready: true }); initialAuthResolved(); }
    });
  } catch (error) { emit({ ready: true, configured: false, status: "クラウド同期を初期化できません", error: messageFor(error) }); initialAuthResolved(); }
}

window.addEventListener("online", () => { if (state.user) syncNow().catch(() => {}); });
window.addEventListener("offline", () => emit({ status: state.user ? "オフライン・未同期" : state.status }));
window.NanikiruCloud = {
  signIn, signOut, syncNow, scheduleUpload, deleteCloudData, markProblemDirty, markProgressDirty, markSettingsDirty, markAllDirty,
  getState: () => ({ ...state }), subscribe(listener) { listeners.add(listener); listener({ ...state }); return () => listeners.delete(listener); },
};
window.NANIKIRU_CLOUD_READY = initialAuthPromise;
initialize();
