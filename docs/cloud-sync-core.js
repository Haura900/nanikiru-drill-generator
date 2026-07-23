export const CLOUD_CHUNK_SIZE = 600000;
export const CLOUD_MAX_CHUNKS = 64;
export const CLOUD_MAX_CHAR_LENGTH = CLOUD_CHUNK_SIZE * CLOUD_MAX_CHUNKS;
export const CLOUD_SCHEMA_VERSION = 2;
export const MAX_PROBLEMS_PER_USER = 10000;
export const MAX_PROBLEM_PAYLOAD_CHARS = 750000;
export const MAX_PROGRESS_PAYLOAD_CHARS = 200000;
export const DEFAULT_ADMIN_COUNT = 3;

export function compareMutationVersion(left, right, timeField = "modifiedAt") {
  const leftTime = Number(left?.[timeField] || 0);
  const rightTime = Number(right?.[timeField] || 0);
  if (leftTime !== rightTime) return leftTime > rightTime ? 1 : -1;
  const leftMutation = String(left?.mutationId || "");
  const rightMutation = String(right?.mutationId || "");
  return leftMutation === rightMutation ? 0 : (leftMutation > rightMutation ? 1 : -1);
}

function chooseState(local, remote, timeField) {
  if (!local) return remote || null;
  if (!remote) return local;
  return compareMutationVersion(local, remote, timeField) >= 0 ? local : remote;
}

export function chooseProblemState(local, remote) {
  return chooseState(local, remote, "modifiedAt");
}

export function chooseProgressState(local, remote) {
  return chooseState(local, remote, "answeredAt");
}

export function chooseSettingsState(local, remote) {
  return chooseState(local, remote, "modifiedAt");
}

export function nextMutationVersion(previous, timeField = "modifiedAt", now = Date.now()) {
  // LWWは端末時計を基準にする。同一端末では時計が戻っても、直前の変更時刻より必ず1ms進める。
  const time = Math.max(Number(now) || 0, Number(previous?.[timeField] || 0) + 1);
  return { [timeField]: time, mutationId: `${time}-${crypto.randomUUID()}` };
}

export function mergeStateMaps(localMap, remoteMap, chooser) {
  const merged = {};
  new Set([...Object.keys(localMap || {}), ...Object.keys(remoteMap || {})]).forEach((id) => {
    merged[id] = chooser(localMap?.[id], remoteMap?.[id]);
  });
  return merged;
}

export function decomposeLegacySave(save) {
  const problems = Array.isArray(save?.p) ? save.p : [];
  const history = save?.h && typeof save.h === "object" && !Array.isArray(save.h) ? save.h : {};
  if (problems.length > MAX_PROBLEMS_PER_USER) throw new Error("旧クラウドデータが10,000問を超えています");
  return {
    problems,
    history,
    settings: { reviewSettings: save?.s || {}, adminCount: Number(save?.a) || DEFAULT_ADMIN_COUNT, genreOrder: Array.isArray(save?.g) ? save.g : [] },
  };
}

export function decideStartupSync({ hasCloud, hasLocal, dirty, localRevision = 0, cloudRevision = 0, isInitialBinding = false }) {
  if (!hasCloud) return hasLocal ? "upload" : "synced";
  if (!hasLocal) return "download";
  if (isInitialBinding) return "choose";
  if (dirty) return localRevision === cloudRevision ? "upload" : "conflict";
  if (cloudRevision > localRevision) return "download";
  if (cloudRevision === localRevision) return "synced";
  return "conflict";
}

export function splitEncodedSave(text) {
  if (typeof text !== "string" || text.length <= 0 || text.length > CLOUD_MAX_CHAR_LENGTH) {
    throw new Error(`セーブデータは1～${CLOUD_MAX_CHAR_LENGTH}文字である必要があります`);
  }
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += CLOUD_CHUNK_SIZE) chunks.push(text.slice(offset, offset + CLOUD_CHUNK_SIZE));
  if (chunks.length > CLOUD_MAX_CHUNKS) throw new Error("セーブデータのチャンク数が上限を超えています");
  return chunks;
}

export async function joinAndValidateChunks(chunks, manifest, hashFunction) {
  if (!manifest || !Number.isInteger(manifest.chunkCount) || manifest.chunkCount < 1 || manifest.chunkCount > CLOUD_MAX_CHUNKS) {
    throw new Error("クラウドのチャンク数が不正です");
  }
  if (!Number.isInteger(manifest.charLength) || manifest.charLength < 1 || manifest.charLength > CLOUD_MAX_CHAR_LENGTH) {
    throw new Error("クラウドデータの長さが不正です");
  }
  if (!Array.isArray(chunks) || chunks.length !== manifest.chunkCount) throw new Error("クラウドデータの一部が不足しています");
  const sorted = [...chunks].sort((left, right) => left.index - right.index);
  if (sorted.some((item, index) => item.index !== index || typeof item.payload !== "string" || item.payload.length > CLOUD_CHUNK_SIZE)) {
    throw new Error("クラウドデータのチャンクが不正です");
  }
  const encoded = sorted.map((item) => item.payload).join("");
  if (encoded.length !== manifest.charLength) throw new Error("クラウドデータの長さが一致しません");
  if (await hashFunction(encoded) !== manifest.sha256) throw new Error("クラウドデータの検証に失敗しました");
  return encoded;
}

export function shouldCacheActiveData(values) {
  return Object.values(values || {}).some((value) => typeof value === "string" && value.length > 0 && value !== "{}" && value !== "[]");
}
