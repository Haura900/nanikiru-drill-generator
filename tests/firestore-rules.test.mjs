import test, { before, after, beforeEach } from "node:test";
import fs from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp, runTransaction } from "firebase/firestore";
import { chooseProgressState } from "../docs/cloud-sync-core.js";

let env;
before(async () => { env = await initializeTestEnvironment({ projectId: "nanikiru-rules-test", firestore: { rules: fs.readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 } }); });
after(async () => env?.cleanup());
beforeEach(async () => env.clearFirestore());
const catalog = (ids) => ({ schemaVersion: 2, problemIds: ids, updatedAt: serverTimestamp(), updatedBy: "device-12345678" });
const problem = (id, overrides = {}) => ({ schemaVersion: 2, problemId: id, payload: '{"hand":"123m"}', modifiedAt: 10, mutationId: "10-12345678-1234-1234-1234-123456789012", updatedAt: serverTimestamp(), updatedBy: "device-12345678", deleted: false, ...overrides });
const progress = (id, overrides = {}) => ({ schemaVersion: 2, problemId: id, payload: '{"attempts":[],"dueAt":1}', answeredAt: 10, mutationId: "10-12345678-1234-1234-1234-123456789012", updatedAt: serverTimestamp(), updatedBy: "device-12345678", deleted: false, ...overrides });

test("未認証と他人のUIDを拒否", async () => {
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "users/a/sync/catalog")));
  await assertFails(setDoc(doc(env.authenticatedContext("a").firestore(), "users/b/sync/catalog"), catalog(["p1"])));
});

test("catalog登録済みproblemとprogressを許可", async () => {
  const db = env.authenticatedContext("a").firestore();
  await assertSucceeds(setDoc(doc(db, "users/a/sync/catalog"), catalog(["p1"])));
  await assertSucceeds(setDoc(doc(db, "users/a/problems/p1"), problem("p1")));
  await assertSucceeds(setDoc(doc(db, "users/a/progress/p1"), progress("p1")));
});

test("catalog未登録IDと未定義パスを拒否", async () => {
  const db = env.authenticatedContext("a").firestore();
  await assertFails(setDoc(doc(db, "users/a/problems/p1"), problem("p1")));
  await assertFails(setDoc(doc(db, "users/a/other/x"), { value: 1 }));
});

test("catalog 10001件、重複、既存ID削除を拒否", async () => {
  const db = env.authenticatedContext("a").firestore(); const ref = doc(db, "users/a/sync/catalog");
  await assertFails(setDoc(ref, catalog(Array.from({ length: 10001 }, (_, i) => `p${i}`))));
  await assertFails(setDoc(ref, catalog(["p1", "p1"])));
  await assertSucceeds(setDoc(ref, catalog(["p1", "p2"])));
  await assertFails(setDoc(ref, catalog(["p2"])));
});

test("payload上限と不正tombstoneを拒否", async () => {
  const db = env.authenticatedContext("a").firestore(); await assertSucceeds(setDoc(doc(db, "users/a/sync/catalog"), catalog(["p1"])));
  await assertFails(setDoc(doc(db, "users/a/problems/p1"), problem("p1", { payload: "x".repeat(750001) })));
  await assertFails(setDoc(doc(db, "users/a/progress/p1"), progress("p1", { payload: "x".repeat(200001) })));
  await assertFails(setDoc(doc(db, "users/a/problems/p1"), problem("p1", { deleted: true, payload: "残存" })));
  await assertSucceeds(setDoc(doc(db, "users/a/problems/p1"), problem("p1", { deleted: true, payload: "" })));
});

test("物理削除を拒否", async () => {
  const db = env.authenticatedContext("a").firestore(); await assertSucceeds(setDoc(doc(db, "users/a/sync/catalog"), catalog(["p1"]))); const ref = doc(db, "users/a/problems/p1");
  await assertSucceeds(setDoc(ref, problem("p1"))); await assertFails(deleteDoc(ref));
});

test("移行完了後は任意snapshot作成を拒否", async () => {
  const db = env.authenticatedContext("a").firestore();
  await assertSucceeds(setDoc(doc(db, "users/a/snapshots/legacy"), { any: "legacy" }));
  await assertSucceeds(setDoc(doc(db, "users/a/migration/state"), { schemaVersion: 2, completed: true, problemCount: 0, progressCount: 0, updatedAt: serverTimestamp(), updatedBy: "device-12345678" }));
  await assertFails(setDoc(doc(db, "users/a/snapshots/arbitrary"), { any: "blocked" }));
});

test("Transaction競合でも問題単位LWWになる", async () => {
  const db = env.authenticatedContext("a").firestore();
  await assertSucceeds(setDoc(doc(db, "users/a/sync/catalog"), catalog(["p1", "p2"])));
  const sync = async (id, record) => runTransaction(db, async (transaction) => {
    const ref = doc(db, `users/a/progress/${id}`); const snapshot = await transaction.get(ref);
    const remote = snapshot.exists() ? snapshot.data() : null;
    if (chooseProgressState(record, remote) === record) transaction.set(ref, record);
  });
  const oldP1 = progress("p1", { answeredAt: 20, mutationId: "20-old-1234567890123456", payload: '{"source":"PC"}' });
  const newP1 = progress("p1", { answeredAt: 30, mutationId: "30-new-1234567890123456", payload: '{"source":"スマホ"}' });
  const p2 = progress("p2", { answeredAt: 25, mutationId: "25-pc2-1234567890123456", payload: '{"source":"PC2"}' });
  await Promise.all([sync("p1", newP1), sync("p1", oldP1), sync("p2", p2)]);
  const [savedP1, savedP2] = await Promise.all([getDoc(doc(db, "users/a/progress/p1")), getDoc(doc(db, "users/a/progress/p2"))]);
  if (savedP1.data().answeredAt !== 30 || savedP2.data().answeredAt !== 25) throw new Error("問題単位LWWに失敗");
});
