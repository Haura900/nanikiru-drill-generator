import test from "node:test";
import assert from "node:assert/strict";

await import("../docs/net-mature-core.js");

const {
  buildNetMatureStats,
  currentReviewIntervalDays,
  normalizeReviewState,
  sanitizeMatureIntervalDays,
} = globalThis.NetMatureCore;
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
        { at: p1Gain, correct: true, intervalDays: 32 },
        { at: p1Loss, correct: false, intervalDays: 0 },
      ], 0),
      p2: state([{ at: p2Gain, correct: true, intervalDays: 32 }], 32),
    },
    settings: { mature_interval_days: 28 },
    periodDays: 31,
    now,
  });
  assert.equal(result.points.length, 31);
  assert.equal(result.startingMature, 0);
  assert.equal(result.currentMature, 1);
  assert.equal(result.netChange, 1);
  assert.equal(result.points.reduce((sum, point) => sum + point.gained, 0), 2);
  assert.equal(result.points.reduce((sum, point) => sum + point.lost, 0), 1);
  assert.equal(result.points.reduce((sum, point) => sum + point.net, 0), 1);
  assert.equal(result.points.at(-1).cumulative, 1);
});

test("期間開始前にmatureだった問題を開始値へ入れる", () => {
  const gainedAt = now - 50 * DAY;
  const result = buildNetMatureStats({
    problems: [problem("p1")],
    history: { p1: state([{ at: gainedAt, correct: true, intervalDays: 32 }], 32) },
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
    history: { p1: state([{ at: now - 10 * DAY, correct: true, intervalDays: 32 }], 32) },
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

test("本日回答した問題数とそのうち現在Matureの問題数を返す", () => {
  const result = buildNetMatureStats({
    problems: [problem("new"), problem("mature"), problem("old")],
    history: {
      new: state([
        { at: now - 1000, correct: true, intervalDays: 7 },
        { at: now - 500, correct: true, intervalDays: 7 },
      ], 7),
      mature: state([{ at: now - 2000, correct: true, intervalDays: 32 }], 32),
      old: state([{ at: now - 2 * DAY, correct: true, intervalDays: 32 }], 32),
    },
    settings: { mature_interval_days: 28 },
    periodDays: 31,
    now,
  });
  assert.equal(result.todayAnsweredProblems, 2);
  assert.equal(result.todayMatureProblems, 1);
  assert.equal(result.currentMature, 2);
});

test("日付の切り替え時刻をNet Matureの日付と本日回答数へ反映する", () => {
  const beforeBoundary = Date.parse("2026-08-07T18:59:00Z"); // 08-08 03:59 JST
  const atBoundary = Date.parse("2026-08-07T19:00:00Z"); // 08-08 04:00 JST
  const settings = { mature_interval_days: 28, day_boundary_minutes: 4 * 60 };
  const history = {
    before: state([{ at: beforeBoundary, correct: true, intervalDays: 32 }], 32),
    after: state([{ at: atBoundary, correct: true, intervalDays: 32 }], 32),
  };
  const problems = [problem("before"), problem("after")];

  const justBefore = buildNetMatureStats({
    problems: [problem("before")],
    history: { before: history.before },
    settings,
    periodDays: 31,
    now: beforeBoundary,
  });
  assert.equal(justBefore.points.at(-1).key, "2026-08-07");
  assert.equal(justBefore.todayAnsweredProblems, 1);

  const justAfter = buildNetMatureStats({
    problems,
    history,
    settings,
    periodDays: 31,
    now: atBoundary,
  });
  assert.equal(justAfter.points.at(-1).key, "2026-08-08");
  assert.equal(justAfter.todayAnsweredProblems, 1);
  assert.equal(justAfter.points.find((point) => point.key === "2026-08-07").gained, 1);
  assert.equal(justAfter.points.find((point) => point.key === "2026-08-08").gained, 1);
});

test("古い履歴は当時の回答列から間隔を復元する", () => {
  const attemptAt = now - 7 * DAY;
  const result = buildNetMatureStats({
    problems: [problem("p1")],
    history: { p1: state([{ at: attemptAt, correct: true }], 32) },
    settings: { first_correct_days: 32, mature_interval_days: 28 },
    periodDays: 31,
    now,
  });
  assert.equal(result.currentMature, 1);
  assert.equal(result.netChange, 1);
});

test("問題一覧から欠けたIDも保存済み履歴があれば成績へ残す", () => {
  const now = Date.UTC(2026, 7, 25, 12);
  const answeredAt = now - 10 * DAY;
  const result = buildNetMatureStats({
    problems: [],
    history: {
      "missing-problem": {
        attempts: [{ at: answeredAt, correct: true, intervalDays: 32 }],
        dueAt: answeredAt + 32 * DAY,
      },
    },
    settings: { mature_interval_days: 28 },
    periodDays: 31,
    now,
  });
  assert.equal(result.currentMature, 1);
  assert.equal(result.netChange, 1);
  assert.equal(result.firstProblemDate, "2026-08-15");
});

test("28日ちょうどではなく28日を超えた回答でMatureになる", () => {
  const result = buildNetMatureStats({
    problems: [problem("exact"), problem("over")],
    history: {
      exact: state([{ at: now - 2 * DAY, correct: true, intervalDays: 28 }], 28),
      over: state([{ at: now - DAY, correct: true, intervalDays: 29 }], 29),
    },
    settings: { mature_interval_days: 28 },
    periodDays: 31,
    now,
  });
  assert.equal(result.currentMature, 1);
  assert.equal(result.points.find((point) => point.key === "2026-08-09").gained, 0);
  assert.equal(result.points.find((point) => point.key === "2026-08-10").gained, 1);
});

test("保存済みの復習間隔を正本として不一致のdueAtを修復する", () => {
  const answeredAt = now - 3 * DAY;
  const source = {
    attempts: [{ at: answeredAt, correct: false, intervalDays: 1 }],
    dueAt: answeredAt + 40 * DAY,
  };
  const normalized = normalizeReviewState(source, { day_boundary_minutes: 0 });
  assert.equal(normalized.changed, true);
  assert.equal(normalized.state.attempts[0].intervalDays, 1);
  assert.equal(currentReviewIntervalDays(normalized.state), 1);
  assert.equal(normalized.state.dueAt, Date.parse("2026-08-08T15:00:00Z"));
});

test("旧履歴はdueAtから最後の復習間隔を復元して固定する", () => {
  const answeredAt = Date.parse("2026-07-01T03:00:00Z");
  const source = {
    attempts: [{ at: answeredAt, correct: true }],
    dueAt: Date.parse("2026-08-01T15:00:00Z"),
  };
  const normalized = normalizeReviewState(source, { day_boundary_minutes: 0 });
  assert.equal(normalized.state.attempts[0].intervalDays, 32);
  assert.equal(currentReviewIntervalDays(normalized.state), 32);
  assert.equal(normalized.state.dueAt, source.dueAt);
});

test("Matureから減少した日は閲覧日が変わっても移動しない", () => {
  const gainedAt = Date.parse("2026-08-01T03:00:00Z");
  const lostAt = Date.parse("2026-08-09T03:00:00Z");
  const input = {
    problems: [problem("p1")],
    history: {
      p1: {
        attempts: [
          { at: gainedAt, correct: true, intervalDays: 32 },
          { at: lostAt, correct: false, intervalDays: 1 },
        ],
        // Deliberately inconsistent legacy/current state. The answer history wins.
        dueAt: lostAt + 32 * DAY,
      },
    },
    settings: { mature_interval_days: 28 },
    periodDays: 31,
  };
  const onAugust10 = buildNetMatureStats({ ...input, now: Date.parse("2026-08-10T03:00:00Z") });
  const onAugust11 = buildNetMatureStats({ ...input, now });
  assert.equal(onAugust10.points.find((point) => point.key === "2026-08-09").lost, 1);
  assert.equal(onAugust10.points.at(-1).lost, 0);
  assert.equal(onAugust11.points.find((point) => point.key === "2026-08-09").lost, 1);
  assert.equal(onAugust11.points.at(-1).lost, 0);
  assert.equal(onAugust11.currentMature, 0);
});
