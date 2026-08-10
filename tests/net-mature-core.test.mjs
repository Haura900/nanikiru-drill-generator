import test from "node:test";
import assert from "node:assert/strict";

await import("../docs/net-mature-core.js");

const { buildNetMatureStats, sanitizeMatureIntervalDays } = globalThis.NetMatureCore;
const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse("2026-08-11T03:00:00Z");

function problem(id, createdAt = "2026-01-15T03:00:00Z") {
  return { id, created_at: createdAt };
}

function state(attempts, currentIntervalDays) {
  const lastAt = attempts.at(-1)?.at || now;
  return { attempts, dueAt: lastAt + currentIntervalDays * DAY };
}

test("Mature判定日数の初期値は28日", () => {
  assert.equal(sanitizeMatureIntervalDays(undefined), 28);
  assert.equal(sanitizeMatureIntervalDays(35), 35);
  assert.equal(sanitizeMatureIntervalDays(0), 28);
});

test("日次のmature化と若返りをNet変化と累積値へ反映する", () => {
  const p1Gain = now - 21 * DAY;
  const p1Loss = now - 6 * DAY;
  const p2Gain = now - 10 * DAY;
  const result = buildNetMatureStats({
    problems: [problem("p1"), problem("p2")],
    history: {
      p1: state([
        { at: p1Gain, correct: true, intervalDays: 28 },
        { at: p1Loss, correct: false, intervalDays: 0 },
      ], 0),
      p2: state([{ at: p2Gain, correct: true, intervalDays: 28 }], 28),
    },
    settings: { mature_interval_days: 28 },
    periodDays: 31,
    now,
  });
  assert.equal(result.points.length, 31);
  assert.equal(result.startingMature, 0);
  assert.equal(result.currentMature, 1);
  assert.equal(result.netChange, 1);
  assert.equal(result.points.reduce((sum, point) => sum + point.net, 0), 1);
  assert.equal(result.points.at(-1).cumulative, 1);
});

test("期間開始前にmatureだった問題を開始値へ入れる", () => {
  const gainedAt = now - 50 * DAY;
  const result = buildNetMatureStats({
    problems: [problem("p1")],
    history: { p1: state([{ at: gainedAt, correct: true, intervalDays: 28 }], 28) },
    settings: { mature_interval_days: 28 },
    periodDays: 31,
    now,
  });
  assert.equal(result.startingMature, 1);
  assert.equal(result.currentMature, 1);
  assert.equal(result.netChange, 0);
});

test("全期間は最初の問題登録月から月次で並べる", () => {
  const result = buildNetMatureStats({
    problems: [problem("p1", "2026-01-15T03:00:00Z")],
    history: { p1: state([{ at: now - 10 * DAY, correct: true, intervalDays: 28 }], 28) },
    settings: { mature_interval_days: 28 },
    periodDays: 0,
    now,
  });
  assert.equal(result.bucketUnit, "month");
  assert.equal(result.firstProblemDate, "2026-01-15");
  assert.equal(result.points[0].key, "2026-01");
  assert.equal(result.points.at(-1).key, "2026-08");
  assert.equal(result.points.at(-1).cumulative, 1);
});

test("設定したMature判定日数を現在値と系列へ使う", () => {
  const attemptAt = now - 5 * DAY;
  const input = {
    problems: [problem("p1")],
    history: { p1: state([{ at: attemptAt, correct: true, intervalDays: 21 }], 21) },
    periodDays: 31,
    now,
  };
  assert.equal(buildNetMatureStats({ ...input, settings: { mature_interval_days: 28 } }).currentMature, 0);
  assert.equal(buildNetMatureStats({ ...input, settings: { mature_interval_days: 14 } }).currentMature, 1);
});

test("古い履歴は当時の回答列から間隔を復元する", () => {
  const attemptAt = now - 7 * DAY;
  const result = buildNetMatureStats({
    problems: [problem("p1")],
    history: { p1: state([{ at: attemptAt, correct: true }], 28) },
    settings: { first_correct_days: 28, mature_interval_days: 28 },
    periodDays: 31,
    now,
  });
  assert.equal(result.currentMature, 1);
  assert.equal(result.netChange, 1);
});
