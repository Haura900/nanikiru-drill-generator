import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";

let env;
const projectId = "nanikiru-rules-test";
const sha = "a".repeat(64);
const meta = (revision = 1) => ({ schemaVersion: 1, saveVersion: 5, snapshotId: "snapshot-1", chunkCount: 1, charLength: 10, sha256: sha, revision, updatedAt: serverTimestamp(), updatedBy: "device-12345678" });
const snapshot = () => ({ chunkCount: 1, charLength: 10, sha256: sha, createdAt: serverTimestamp(), createdBy: "device-12345678" });

before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 } });
});
after(async () => env?.cleanup());

test("未ログインを拒否", async () => {
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "users/a/sync/meta")));
});

test("本人の正常なmeta snapshot chunkを許可", async () => {
  const db = env.authenticatedContext("a").firestore();
  await assertSucceeds(setDoc(doc(db, "users/a/snapshots/s1/chunks/000000"), { index: 0, payload: "NK3:test" }));
  await assertSucceeds(setDoc(doc(db, "users/a/snapshots/s1"), snapshot()));
  await assertSucceeds(setDoc(doc(db, "users/a/sync/meta"), meta()));
});

test("他人の領域と未定義パスを拒否", async () => {
  const db = env.authenticatedContext("a").firestore();
  await assertFails(setDoc(doc(db, "users/b/sync/meta"), meta()));
  await assertFails(setDoc(doc(db, "users/a/private/other"), { value: 1 }));
});

test("不正フィールドと不正SHAを拒否", async () => {
  const db = env.authenticatedContext("c").firestore();
  await assertFails(setDoc(doc(db, "users/c/sync/meta"), { ...meta(), extra: true }));
  await assertFails(setDoc(doc(db, "users/c/snapshots/s1"), { ...snapshot(), sha256: "bad" }));
});

test("600,000文字を超えるchunkを拒否", async () => {
  const db = env.authenticatedContext("d").firestore();
  await assertFails(setDoc(doc(db, "users/d/snapshots/s1/chunks/000000"), { index: 0, payload: "x".repeat(600001) }));
});

test("作成済snapshotとchunkの更新を拒否", async () => {
  const db = env.authenticatedContext("e").firestore();
  const chunkRef = doc(db, "users/e/snapshots/s1/chunks/000000");
  const snapshotDocument = doc(db, "users/e/snapshots/s1");
  await assertSucceeds(setDoc(chunkRef, { index: 0, payload: "a" }));
  await assertSucceeds(setDoc(snapshotDocument, snapshot()));
  await assertFails(setDoc(chunkRef, { index: 0, payload: "b" }));
  await assertFails(setDoc(snapshotDocument, snapshot()));
});

test("削除は所有者だけ許可", async () => {
  const owner = env.authenticatedContext("f").firestore();
  const other = env.authenticatedContext("g").firestore();
  const ref = doc(owner, "users/f/snapshots/s1/chunks/000000");
  await assertSucceeds(setDoc(ref, { index: 0, payload: "a" }));
  await assertFails(deleteDoc(doc(other, "users/f/snapshots/s1/chunks/000000")));
  await assertSucceeds(deleteDoc(ref));
});
