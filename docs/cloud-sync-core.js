export const CLOUD_CHUNK_SIZE = 600000;
export const CLOUD_MAX_CHUNKS = 64;
export const CLOUD_MAX_CHAR_LENGTH = CLOUD_CHUNK_SIZE * CLOUD_MAX_CHUNKS;

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
