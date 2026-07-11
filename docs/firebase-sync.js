import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, browserLocalPersistence, setPersistence,
  signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut as firebaseSignOut,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import {
  getFirestore, doc, collection, getDoc, getDocs, setDoc, deleteDoc,
  onSnapshot, runTransaction, serverTimestamp, query, orderBy,
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";
import { firebaseConfig, isFirebaseConfigured } from "./firebase-config.js?v=20260711-1";

const CHUNK_SIZE = 600000;
const CLOUD_REVISION_KEY = "nanikiru-cloud-revision-v1";
const DEVICE_ID_KEY = "nanikiru-device-id-v1";
const BOUND_UID_KEY = "nanikiru-bound-uid-v1";
const DIRTY_KEY = "nanikiru-cloud-dirty-v1";
const ACTIVE_KEYS = ["nanikiru-problems-v1", "nanikiru-learning-v1", "nanikiru-review-settings-v1", "nanikiru-admin-count-v1"];
const listeners = new Set();
const state = { configured: false, ready: false, user: null, status: "クラウド同期は未設定です", error: "", lastSync: null, dirty: false, syncing: false };
let auth = null;
let db = null;
let uploadTimer = null;
let unsubscribeMeta = null;
let applyingCloud = false;
let changeVersion = 0;
let initialAuthResolved;
const initialAuthPromise = new Promise((resolve) => { initialAuthResolved = resolve; });

const deviceId = (() => {
  let value = localStorage.getItem(DEVICE_ID_KEY);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, value);
  }
  return value;
})();

function emit(patch = {}) {
  Object.assign(state, patch);
  renderState();
  listeners.forEach((listener) => { try { listener({ ...state }); } catch (error) { console.error(error); } });
}

function messageFor(error) {
  console.error("Cloud sync:", error);
  if (!navigator.onLine) return "オフライン・未同期";
  if (error?.code === "permission-denied") return "同期の権限がありません。設定を確認してください";
  if (error?.code?.startsWith?.("auth/")) return "Googleログインに失敗しました";
  return error?.message ? `同期に失敗しました: ${error.message}` : "同期に失敗しました";
}

function waitForSaveApi() {
  if (window.NanikiruSaveData) return Promise.resolve(window.NanikiruSaveData);
  return new Promise((resolve) => window.addEventListener("nanikiru-app-ready", () => resolve(window.NanikiruSaveData), { once: true }));
}

function metaRef(uid) { return doc(db, "users", uid, "sync", "meta"); }
function snapshotRef(uid, id) { return doc(db, "users", uid, "snapshots", id); }
function chunksRef(uid, id) { return collection(db, "users", uid, "snapshots", id, "chunks"); }
function padIndex(index) { return String(index).padStart(6, "0"); }
function currentRevision() { return Number(localStorage.getItem(CLOUD_REVISION_KEY) || 0); }
function setRevision(value) { localStorage.setItem(CLOUD_REVISION_KEY, String(Number(value) || 0)); }

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function splitEncodedSave(text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) chunks.push(text.slice(i, i + CHUNK_SIZE));
  return chunks.length ? chunks : [""];
}

async function readMeta(uid) {
  const snap = await getDoc(metaRef(uid));
  return snap.exists() ? snap.data() : null;
}

async function downloadSnapshot(uid, meta = null) {
  const actualMeta = meta || await readMeta(uid);
  if (!actualMeta?.snapshotId || !Number.isInteger(actualMeta.chunkCount)) return null;
  const manifestSnap = await getDoc(snapshotRef(uid, actualMeta.snapshotId));
  if (!manifestSnap.exists()) throw new Error("クラウドの保存情報が見つかりません");
  const manifest = manifestSnap.data();
  if (manifest.chunkCount !== actualMeta.chunkCount || manifest.sha256 !== actualMeta.sha256) throw new Error("クラウドの保存情報が一致しません");
  const chunkSnaps = await getDocs(query(chunksRef(uid, actualMeta.snapshotId), orderBy("index")));
  const chunks = chunkSnaps.docs.map((item) => item.data()).sort((a, b) => a.index - b.index);
  if (chunks.length !== actualMeta.chunkCount || chunks.some((item, index) => item.index !== index || typeof item.payload !== "string")) {
    throw new Error("クラウドデータの一部が不足しています");
  }
  const encoded = chunks.map((item) => item.payload).join("");
  if (encoded.length !== actualMeta.charLength || encoded.length !== manifest.charLength) throw new Error("クラウドデータの長さが一致しません");
  if (await sha256(encoded) !== actualMeta.sha256) throw new Error("クラウドデータの検証に失敗しました");
  return { encoded, meta: actualMeta };
}

async function applyCloud(uid, meta = null) {
  emit({ syncing: true, status: "同期中", error: "" });
  const downloaded = await downloadSnapshot(uid, meta);
  if (!downloaded) return false;
  const api = await waitForSaveApi();
  applyingCloud = true;
  try {
    await api.applyEncodedSave(downloaded.encoded, { source: "cloud", scheduleUpload: false });
    setRevision(downloaded.meta.revision);
    localStorage.setItem(BOUND_UID_KEY, uid);
    localStorage.removeItem(DIRTY_KEY);
    emit({ dirty: false, syncing: false, status: "同期済み", lastSync: new Date() });
  } finally { applyingCloud = false; }
  return true;
}

async function removeSnapshot(uid, snapshotId) {
  if (!snapshotId) return;
  const chunks = await getDocs(chunksRef(uid, snapshotId));
  await Promise.all(chunks.docs.map((item) => deleteDoc(item.ref)));
  await deleteDoc(snapshotRef(uid, snapshotId));
}

async function uploadCurrent({ force = false } = {}) {
  if (!state.user || !db || !navigator.onLine || state.syncing) return false;
  const uid = state.user.uid;
  const api = await waitForSaveApi();
  const uploadingVersion = changeVersion;
  emit({ syncing: true, status: "同期中", error: "" });
  let createdSnapshotId = null;
  try {
    const before = await readMeta(uid);
    const localRevision = currentRevision();
    if (!force && before && Number(before.revision || 0) !== localRevision && before.updatedBy !== deviceId) {
      emit({ syncing: false, status: "他の端末でも変更されています" });
      await showConflict(before);
      return false;
    }
    const encoded = await api.encodeCurrentSave();
    const chunks = splitEncodedSave(encoded);
    const hash = await sha256(encoded);
    createdSnapshotId = `${Date.now()}-${crypto.randomUUID()}`;
    await Promise.all(chunks.map((payload, index) => setDoc(doc(chunksRef(uid, createdSnapshotId), padIndex(index)), { index, payload })));
    await setDoc(snapshotRef(uid, createdSnapshotId), {
      chunkCount: chunks.length, charLength: encoded.length, sha256: hash,
      createdAt: serverTimestamp(), createdBy: deviceId,
    });
    const nextRevision = await runTransaction(db, async (transaction) => {
      const ref = metaRef(uid);
      const currentSnap = await transaction.get(ref);
      const current = currentSnap.exists() ? currentSnap.data() : null;
      if (!force && current && Number(current.revision || 0) !== localRevision && current.updatedBy !== deviceId) {
        const error = new Error("別の端末でもデータが変更されています");
        error.code = "nanikiru/conflict";
        throw error;
      }
      const revision = Number(current?.revision || 0) + 1;
      transaction.set(ref, {
        schemaVersion: 1, saveVersion: 5, snapshotId: createdSnapshotId,
        chunkCount: chunks.length, charLength: encoded.length, sha256: hash,
        revision, updatedAt: serverTimestamp(), updatedBy: deviceId,
      });
      return revision;
    });
    setRevision(nextRevision);
    localStorage.setItem(BOUND_UID_KEY, uid);
    const changedDuringUpload = changeVersion !== uploadingVersion;
    if (!changedDuringUpload) localStorage.removeItem(DIRTY_KEY);
    emit({ dirty: changedDuringUpload, syncing: false, status: changedDuringUpload ? "未同期の変更があります" : "同期済み", lastSync: new Date() });
    if (changedDuringUpload) {
      clearTimeout(uploadTimer);
      uploadTimer = setTimeout(() => uploadCurrent(), 1800);
    }
    if (before?.snapshotId && before.snapshotId !== createdSnapshotId) removeSnapshot(uid, before.snapshotId).catch(console.error);
    return true;
  } catch (error) {
    if (createdSnapshotId) removeSnapshot(uid, createdSnapshotId).catch(console.error);
    if (error.code === "nanikiru/conflict") {
      emit({ syncing: false, status: "他の端末でも変更されています" });
      await showConflict(await readMeta(uid));
    } else {
      emit({ syncing: false, status: navigator.onLine ? "同期に失敗しました" : "オフライン・未同期", error: messageFor(error), dirty: true });
    }
    return false;
  }
}

function scheduleUpload(reason = "変更") {
  if (applyingCloud || !state.user) return;
  changeVersion++;
  clearTimeout(uploadTimer);
  localStorage.setItem(DIRTY_KEY, "1");
  emit({ dirty: true, status: navigator.onLine ? "未同期の変更があります" : "オフライン・未同期", error: "" });
  uploadTimer = setTimeout(() => uploadCurrent(), 1800);
}

async function syncNow() {
  if (!state.user) return;
  if (!navigator.onLine) return emit({ status: "オフライン・未同期", dirty: true });
  if (state.dirty) return uploadCurrent();
  const meta = await readMeta(state.user.uid);
  if (meta && Number(meta.revision || 0) > currentRevision()) return applyCloud(state.user.uid, meta);
  emit({ status: "同期済み", lastSync: new Date() });
}

async function signIn() {
  if (!auth) return;
  const provider = new GoogleAuthProvider();
  const mobile = matchMedia("(max-width: 700px)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  try {
    if (mobile) return signInWithRedirect(auth, provider);
    await signInWithPopup(auth, provider);
  } catch (error) {
    if (["auth/popup-blocked", "auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/operation-not-supported-in-this-environment"].includes(error.code)) {
      return signInWithRedirect(auth, provider);
    }
    emit({ error: messageFor(error) });
  }
}

function cacheFor(uid) { return `nanikiru-user-cache-v1:${uid}`; }
function cacheActive(uid) {
  if (!uid) return;
  const values = {};
  ACTIVE_KEYS.forEach((key) => { const value = localStorage.getItem(key); if (value !== null) values[key] = value; });
  localStorage.setItem(cacheFor(uid), JSON.stringify(values));
}
function clearActive() { ACTIVE_KEYS.forEach((key) => localStorage.removeItem(key)); }
async function restoreCachedActive(uid) {
  let values = {};
  try { values = JSON.parse(localStorage.getItem(cacheFor(uid)) || "{}"); } catch { values = {}; }
  clearActive();
  ACTIVE_KEYS.forEach((key) => { if (typeof values[key] === "string") localStorage.setItem(key, values[key]); });
  await window.NanikiruSaveData.reload();
}

async function signOut() {
  if (!auth || !state.user) return;
  cacheActive(state.user.uid);
  clearActive();
  setRevision(0);
  await firebaseSignOut(auth);
  location.reload();
}

async function deleteCloudData() {
  if (!state.user) return;
  const uid = state.user.uid;
  emit({ syncing: true, status: "クラウドデータを削除中", error: "" });
  try {
    const snapshots = await getDocs(collection(db, "users", uid, "snapshots"));
    await deleteDoc(metaRef(uid));
    for (const snapshot of snapshots.docs) await removeSnapshot(uid, snapshot.id);
    setRevision(0);
    localStorage.removeItem(DIRTY_KEY);
    emit({ syncing: false, dirty: false, status: "クラウドデータを削除しました", lastSync: new Date() });
  } catch (error) {
    emit({ syncing: false, status: "クラウドデータを削除できませんでした", error: messageFor(error) });
    throw error;
  }
}

function describeData(data) {
  const normalized = data || {};
  return { problems: normalized.p?.length || 0, attempts: Object.values(normalized.h || {}).reduce((sum, item) => sum + (item.attempts?.length || 0), 0) };
}

async function choiceModal({ title, body, actions, dismissible = false }) {
  const modal = document.createElement("div");
  modal.className = "cloud-modal";
  modal.innerHTML = `<div class="cloud-modal-card" role="dialog" aria-modal="true"><h2>${title}</h2><div class="cloud-modal-body">${body}</div><div class="button-row"></div></div>`;
  document.body.appendChild(modal);
  return new Promise((resolve) => {
    const row = modal.querySelector(".button-row");
    actions.forEach((action) => {
      const button = document.createElement("button");
      button.type = "button"; button.textContent = action.label; button.className = action.className || "";
      button.addEventListener("click", () => {
        if (action.confirm && !confirm(action.confirm)) return;
        modal.remove(); resolve(action.value);
      });
      row.appendChild(button);
    });
    if (dismissible) modal.addEventListener("click", (event) => { if (event.target === modal) { modal.remove(); resolve("close"); } });
  });
}

async function showInitialChoice(meta) {
  const api = await waitForSaveApi();
  const downloaded = await downloadSnapshot(state.user.uid, meta);
  const cloudData = await api.decodeSaveData(downloaded.encoded);
  const cloud = describeData(cloudData);
  const local = describeData(api.buildSaveData());
  const updated = meta.updatedAt?.toDate?.().toLocaleString("ja-JP") || "不明";
  const choice = await choiceModal({
    title: "この端末とクラウドの両方にデータがあります",
    body: `<h3>クラウドのデータ</h3><p>更新日時: ${updated}<br>問題数: ${cloud.problems}問 / 解答数: ${cloud.attempts}件</p><h3>この端末のデータ</h3><p>問題数: ${local.problems}問 / 解答数: ${local.attempts}件</p>`,
    actions: [
      { label: "クラウドのデータをこの端末へ読み込む", value: "cloud", className: "primary", confirm: "この端末だけにある変更は失われます。クラウドのデータを読み込みますか？" },
      { label: "この端末のデータをクラウドへ保存", value: "local", confirm: "クラウドのデータをこの端末の内容で置き換えますか？" },
    ],
  });
  if (choice === "cloud") await applyCloud(state.user.uid, meta);
  else { setRevision(Number(meta.revision || 0)); await uploadCurrent({ force: true }); }
}

async function showConflict(meta) {
  if (!meta) return;
  const choice = await choiceModal({
    title: "別の端末でもデータが変更されています",
    body: "<p>この端末の未同期変更と、クラウドの変更が競合しています。</p>",
    dismissible: true,
    actions: [
      { label: "クラウドの変更を読み込む", value: "cloud", className: "primary", confirm: "この端末の未同期変更は失われます。読み込みますか？" },
      { label: "この端末のデータで上書き", value: "local", confirm: "クラウドの変更は失われます。上書きしますか？" },
      { label: "いったん閉じる", value: "close" },
    ],
  });
  if (choice === "cloud") await applyCloud(state.user.uid, meta);
  if (choice === "local") { setRevision(Number(meta.revision || 0)); await uploadCurrent({ force: true }); }
}

async function handleSignedIn(user) {
  await waitForSaveApi();
  emit({ user, status: "クラウドを確認しています", error: "" });
  const bound = localStorage.getItem(BOUND_UID_KEY);
  const switchedFrom = bound && bound !== user.uid ? bound : null;
  if (bound && bound !== user.uid) {
    cacheActive(bound);
    clearActive();
    setRevision(0);
    await window.NanikiruSaveData.reload();
  }
  const meta = await readMeta(user.uid);
  const localHasData = window.NanikiruSaveData.hasMeaningfulLocalData();
  const persistedDirty = localStorage.getItem(DIRTY_KEY) === "1";
  if (persistedDirty) emit({ dirty: true });
  if (!meta && localHasData && (!bound || bound === user.uid)) await uploadCurrent({ force: true });
  else if (meta && !localHasData) await applyCloud(user.uid, meta);
  else if (meta && localHasData && (!bound || bound !== user.uid)) await showInitialChoice(meta);
  else if (meta && localHasData && bound === user.uid && persistedDirty && Number(meta.revision || 0) === currentRevision()) await uploadCurrent();
  else if (meta && localHasData && bound === user.uid && persistedDirty) await showConflict(meta);
  else if (!meta && switchedFrom) {
    const choice = await choiceModal({
      title: "このGoogleアカウントにはクラウドデータがありません",
      body: "<p>空の状態から始めます。前のアカウントで表示していたこの端末のデータを取り込むこともできます。</p>",
      actions: [
        { label: "空の状態から始める", value: "empty", className: "primary" },
        { label: "この端末の以前のデータを取り込む", value: "import", confirm: "以前のアカウントのデータを、このGoogleアカウントへ保存しますか？" },
      ],
    });
    if (choice === "import") {
      await restoreCachedActive(switchedFrom);
      setRevision(0);
      await uploadCurrent({ force: true });
    } else {
      localStorage.setItem(BOUND_UID_KEY, user.uid);
      emit({ status: "同期済み", dirty: false });
    }
  } else if (!meta) {
    localStorage.setItem(BOUND_UID_KEY, user.uid);
    emit({ status: "同期済み", dirty: false });
  } else {
    localStorage.setItem(BOUND_UID_KEY, user.uid);
    setRevision(Number(meta.revision || 0));
    emit({ status: "同期済み", dirty: false, lastSync: new Date() });
  }
  unsubscribeMeta?.();
  unsubscribeMeta = onSnapshot(metaRef(user.uid), async (snap) => {
    if (!snap.exists() || applyingCloud || state.syncing) return;
    const remote = snap.data();
    if (remote.updatedBy === deviceId || Number(remote.revision || 0) <= currentRevision()) return;
    if (state.dirty) await showConflict(remote);
    else await applyCloud(user.uid, remote).catch((error) => emit({ error: messageFor(error), status: "同期に失敗しました" }));
  }, (error) => emit({ error: messageFor(error), status: "同期に失敗しました" }));
}

function renderState() {
  const signedOut = document.getElementById("cloud-signed-out");
  const signedIn = document.getElementById("cloud-signed-in");
  const user = document.getElementById("cloud-user");
  const status = document.getElementById("cloud-status");
  const last = document.getElementById("cloud-last-sync");
  const error = document.getElementById("cloud-error");
  if (!signedOut) return;
  signedOut.classList.toggle("hidden", Boolean(state.user));
  signedIn?.classList.toggle("hidden", !state.user);
  const intro = signedOut.querySelector("p");
  const login = document.getElementById("cloud-login-button");
  if (!state.configured) {
    if (intro) intro.textContent = "クラウド同期は未設定です。";
    if (login) login.disabled = true;
  }
  if (user) user.textContent = state.user ? `${state.user.displayName || "Googleユーザー"}${state.user.email ? `（${state.user.email}）` : ""}` : "";
  if (status) status.textContent = state.status;
  if (last) last.textContent = state.lastSync ? `最終同期: ${state.lastSync.toLocaleString("ja-JP")}` : "";
  if (error) { error.textContent = state.error; error.className = `message ${state.error ? "error" : "hidden"}`; }
}

function bindUi() {
  document.getElementById("cloud-login-button")?.addEventListener("click", signIn);
  document.getElementById("cloud-logout-button")?.addEventListener("click", signOut);
  document.getElementById("cloud-sync-now")?.addEventListener("click", () => syncNow().catch((error) => emit({ error: messageFor(error) })));
  renderState();
}

async function initialize() {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindUi, { once: true });
  else bindUi();
  if (!isFirebaseConfigured()) {
    emit({ ready: true, configured: false, status: "クラウド同期は未設定です" });
    initialAuthResolved();
    return;
  }
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app); db = getFirestore(app);
    await setPersistence(auth, browserLocalPersistence);
    await getRedirectResult(auth).catch((error) => emit({ error: messageFor(error) }));
    emit({ configured: true, status: "ログインしていません" });
    onAuthStateChanged(auth, async (user) => {
      try {
        if (user) await handleSignedIn(user);
        else { unsubscribeMeta?.(); unsubscribeMeta = null; emit({ user: null, dirty: false, syncing: false, status: "ログインしていません" }); }
      } catch (error) { emit({ user, syncing: false, error: messageFor(error), status: "同期に失敗しました" }); }
      if (!state.ready) { emit({ ready: true }); initialAuthResolved(); }
    });
  } catch (error) {
    emit({ ready: true, configured: false, error: messageFor(error), status: "クラウド同期は未設定です" });
    initialAuthResolved();
  }
}

window.addEventListener("offline", () => emit({ status: state.user ? "オフライン・未同期" : state.status }));
window.addEventListener("online", () => { if (state.user) syncNow().catch((error) => emit({ error: messageFor(error) })); });

window.NanikiruCloud = {
  signIn, signOut, syncNow, scheduleUpload, deleteCloudData,
  getState: () => ({ ...state }),
  subscribe(listener) { listeners.add(listener); listener({ ...state }); return () => listeners.delete(listener); },
};
window.NANIKIRU_CLOUD_READY = initialAuthPromise;
initialize();
