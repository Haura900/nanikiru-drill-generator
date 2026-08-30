(function exposeNetMatureCore(global) {
  "use strict";

  const DAY = 24 * 60 * 60 * 1000;
  const DEFAULT_MATURE_INTERVAL_DAYS = 28;

  function finiteNonNegative(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  function sanitizeMatureIntervalDays(value, fallback = DEFAULT_MATURE_INTERVAL_DAYS) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 1 && parsed <= 36500
      ? Math.floor(parsed)
      : fallback;
  }

  function sanitizeBoundaryMinutes(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed < 24 * 60 ? Math.floor(parsed) : 0;
  }

  function normalizeDelayDays(value) {
    const parsed = Math.max(0, Number(value) || 0);
    const nearestInteger = Math.round(parsed);
    const tolerance = Number.EPSILON * Math.max(1, parsed) * 16;
    return Math.abs(parsed - nearestInteger) <= tolerance ? nearestInteger : Math.ceil(parsed);
  }

  function logicalDayUtcMs(ms, boundaryMinutes = 0) {
    const date = new Date(Number(ms) - sanitizeBoundaryMinutes(boundaryMinutes) * 60 * 1000);
    if (!Number.isFinite(date.getTime())) return NaN;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const part = (type, fallback) => Number(parts.find((item) => item.type === type)?.value || fallback);
    return Date.UTC(part("year", 0), part("month", 1) - 1, part("day", 1));
  }

  function dayKey(ms, boundaryMinutes = 0) {
    const day = logicalDayUtcMs(ms, boundaryMinutes);
    return Number.isFinite(day) ? new Date(day).toISOString().slice(0, 10) : "";
  }

  function calendarDaysDiff(fromMs, toMs, boundaryMinutes = 0) {
    const from = logicalDayUtcMs(fromMs, boundaryMinutes);
    const to = logicalDayUtcMs(toMs, boundaryMinutes);
    return Number.isFinite(from) && Number.isFinite(to) ? Math.round((to - from) / DAY) : 0;
  }

  function storedIntervalDays(value) {
    if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? normalizeDelayDays(parsed) : null;
  }

  function reviewDueAt(answeredAt, delayDays, boundaryMinutes = 0) {
    const logicalDay = logicalDayUtcMs(answeredAt, boundaryMinutes);
    if (!Number.isFinite(logicalDay)) return NaN;
    return logicalDay - 9 * 60 * 60 * 1000
      + sanitizeBoundaryMinutes(boundaryMinutes) * 60 * 1000
      + normalizeDelayDays(delayDays) * DAY;
  }

  function normalizedSettings(settings = {}) {
    return {
      first_correct_days: finiteNonNegative(settings.first_correct_days, 7),
      wrong_retry_days: finiteNonNegative(settings.wrong_retry_days, 0),
      wrong_then_correct_days: finiteNonNegative(settings.wrong_then_correct_days, 1),
      repeat_multiplier: finiteNonNegative(settings.repeat_multiplier, 3),
      day_boundary_minutes: sanitizeBoundaryMinutes(settings.day_boundary_minutes),
      mature_interval_days: sanitizeMatureIntervalDays(settings.mature_interval_days),
    };
  }

  function calculateReviewDelayDays(attempts, correct, answeredAt, rawSettings = {}) {
    const settings = normalizedSettings(rawSettings);
    const previous = attempts?.[attempts.length - 1];
    let delayDays;
    if (!correct) {
      delayDays = settings.wrong_retry_days;
    } else if (!previous) {
      delayDays = settings.first_correct_days;
    } else {
      const elapsedDays = Math.max(0, calendarDaysDiff(
        previous.at,
        answeredAt,
        settings.day_boundary_minutes,
      ));
      delayDays = previous.correct
        ? (elapsedDays + settings.wrong_then_correct_days) * settings.repeat_multiplier
        : elapsedDays > 0
          ? (elapsedDays + settings.wrong_then_correct_days) * settings.repeat_multiplier
          : settings.wrong_then_correct_days;
    }
    return normalizeDelayDays(delayDays);
  }

  function intervalForAttempt(attempts, index, settings) {
    const attempt = attempts[index];
    const stored = storedIntervalDays(attempt?.intervalDays);
    if (stored !== null) return stored;
    return calculateReviewDelayDays(attempts.slice(0, index), Boolean(attempt?.correct), attempt?.at, settings);
  }

  function intervalFromDueAt(state, attempts, settings) {
    if (!attempts.length) return 0;
    const last = attempts[attempts.length - 1];
    const dueAt = Number(state?.dueAt);
    if (Number.isFinite(dueAt) && dueAt > 0) {
      return Math.max(0, calendarDaysDiff(last.at, dueAt, settings.day_boundary_minutes));
    }
    return null;
  }

  function normalizeReviewState(rawState, rawSettings = {}) {
    const settings = normalizedSettings(rawSettings);
    const source = rawState && typeof rawState === "object" ? rawState : {};
    const sourceAttempts = Array.isArray(source.attempts) ? source.attempts : [];
    const attempts = sourceAttempts
      .filter((attempt) => attempt && Number.isFinite(Number(attempt.at)))
      .map((attempt) => ({ ...attempt, at: Number(attempt.at) }))
      .sort((left, right) => left.at - right.at);
    const dueInterval = intervalFromDueAt(source, attempts, settings);

    attempts.forEach((attempt, index) => {
      const stored = storedIntervalDays(attempt.intervalDays);
      let intervalDays;
      if (stored !== null) {
        intervalDays = stored;
      } else if (index === attempts.length - 1 && dueInterval !== null) {
        const previous = attempts[index - 1];
        const elapsedDays = previous
          ? Math.max(0, calendarDaysDiff(previous.at, attempt.at, settings.day_boundary_minutes))
          : 0;
        // A previous release stored only the short post-error delay after a
        // later correct answer. Preserve the existing one-time repair while
        // making the repaired interval explicit in the attempt itself.
        intervalDays = attempt.correct && previous?.correct === false && elapsedDays > 0
          && dueInterval === normalizeDelayDays(settings.wrong_then_correct_days)
          ? calculateReviewDelayDays(attempts.slice(0, index), true, attempt.at, settings)
          : dueInterval;
      } else {
        intervalDays = intervalForAttempt(attempts, index, settings);
      }
      attempt.intervalDays = intervalDays;
    });

    const state = { ...source, attempts };
    if (attempts.length) {
      const last = attempts[attempts.length - 1];
      state.dueAt = reviewDueAt(last.at, last.intervalDays, settings.day_boundary_minutes);
    }
    const changed = JSON.stringify(state) !== JSON.stringify(source);
    return { state, changed };
  }

  function currentReviewIntervalDays(state, rawSettings = {}) {
    const settings = normalizedSettings(rawSettings);
    const attempts = Array.isArray(state?.attempts)
      ? state.attempts.filter((attempt) => Number.isFinite(Number(attempt?.at))).slice().sort((a, b) => Number(a.at) - Number(b.at))
      : [];
    if (!attempts.length) return 0;
    const lastInterval = storedIntervalDays(attempts[attempts.length - 1]?.intervalDays);
    if (lastInterval !== null) return lastInterval;
    const dueInterval = intervalFromDueAt(state, attempts, settings);
    return dueInterval === null
      ? intervalForAttempt(attempts, attempts.length - 1, settings)
      : dueInterval;
  }

  function monthIndex(key) {
    const [year, month] = String(key).split("-").map(Number);
    return year * 12 + month - 1;
  }

  function monthKey(index) {
    const year = Math.floor(index / 12);
    const month = index - year * 12 + 1;
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
  }

  function buildNetMatureStats({ problems = [], history = {}, settings: rawSettings = {}, periodDays = 31, now = Date.now() } = {}) {
    const settings = normalizedSettings(rawSettings);
    const thresholdDays = settings.mature_interval_days;
    const normalizedPeriodDays = [31, 90, 365].includes(Number(periodDays)) ? Number(periodDays) : 0;
    const currentDay = logicalDayUtcMs(now, settings.day_boundary_minutes);
    const minimumOffset = normalizedPeriodDays ? -normalizedPeriodDays + 1 : null;
    const events = new Map();
    let startingMature = 0;
    let currentMature = 0;
    let todayAnsweredProblems = 0;
    let todayMatureProblems = 0;
    let earliestAttempt = Infinity;

    const eventKey = (at) => {
      if (!normalizedPeriodDays) return dayKey(at, settings.day_boundary_minutes).slice(0, 7);
      const eventDay = logicalDayUtcMs(at, settings.day_boundary_minutes);
      const offset = Math.min(0, Math.round((eventDay - currentDay) / DAY));
      return offset;
    };
    const addEvent = (key, delta) => {
      const event = events.get(key) || { gained: 0, lost: 0 };
      if (delta > 0) event.gained += delta;
      if (delta < 0) event.lost += Math.abs(delta);
      events.set(key, event);
    };

    // 学習履歴は成績の正本である。問題が端末間同期の不整合や削除によって
    // 一覧から一時的に欠けても、残っている回答履歴を集計から捨てない。
    const suppliedProblems = Array.isArray(problems) ? problems : [];
    const problemById = new Map(suppliedProblems
      .filter((problem) => problem?.id)
      .map((problem) => [problem.id, problem]));
    Object.keys(history || {}).forEach((id) => {
      if (!problemById.has(id)) problemById.set(id, { id });
    });
    const currentProblems = [...problemById.values()];
    currentProblems.forEach((problem) => {
      const state = normalizeReviewState(history?.[problem?.id] || {}, settings).state;
      const attempts = state.attempts;
      let reconstructedMature = false;
      let baselineCaptured = !normalizedPeriodDays;

      attempts.forEach((attempt, index) => {
        const at = Number(attempt.at);
        earliestAttempt = Math.min(earliestAttempt, at);
        const nextMature = intervalForAttempt(attempts, index, settings) > thresholdDays;
        const offset = Math.round((logicalDayUtcMs(at, settings.day_boundary_minutes) - currentDay) / DAY);
        if (normalizedPeriodDays && offset < minimumOffset) {
          reconstructedMature = nextMature;
          return;
        }
        if (!baselineCaptured) {
          if (reconstructedMature) startingMature++;
          baselineCaptured = true;
        }
        if (nextMature !== reconstructedMature) addEvent(eventKey(at), nextMature ? 1 : -1);
        reconstructedMature = nextMature;
      });

      if (!baselineCaptured) {
        if (reconstructedMature) startingMature++;
        baselineCaptured = true;
      }

      const exactCurrentMature = reconstructedMature;
      const answeredToday = attempts.some((attempt) => logicalDayUtcMs(attempt.at, settings.day_boundary_minutes) === currentDay);
      if (answeredToday) {
        todayAnsweredProblems++;
        if (exactCurrentMature) todayMatureProblems++;
      }
      if (exactCurrentMature) currentMature++;
    });

    const creationTimes = currentProblems
      .map((problem) => Date.parse(problem?.created_at || ""))
      .filter(Number.isFinite);
    const earliestRegistration = creationTimes.length ? Math.min(...creationTimes) : earliestAttempt;
    const points = [];
    let cumulative = startingMature;

    if (normalizedPeriodDays) {
      for (let offset = minimumOffset; offset <= 0; offset++) {
        const key = new Date(currentDay + offset * DAY).toISOString().slice(0, 10);
        const event = events.get(offset) || { gained: 0, lost: 0 };
        const net = event.gained - event.lost;
        cumulative += net;
        points.push({ key, label: key.slice(5), gained: event.gained, lost: event.lost, net, cumulative });
      }
    } else {
      const currentMonth = monthIndex(dayKey(now, settings.day_boundary_minutes).slice(0, 7));
      const startKey = Number.isFinite(earliestRegistration)
        ? dayKey(earliestRegistration, settings.day_boundary_minutes).slice(0, 7)
        : monthKey(currentMonth);
      const startMonth = Math.min(monthIndex(startKey), currentMonth);
      for (let index = startMonth; index <= currentMonth; index++) {
        const key = monthKey(index);
        const event = events.get(key) || { gained: 0, lost: 0 };
        const net = event.gained - event.lost;
        cumulative += net;
        points.push({ key, label: key, gained: event.gained, lost: event.lost, net, cumulative });
      }
    }

    return {
      thresholdDays,
      periodDays: normalizedPeriodDays,
      bucketUnit: normalizedPeriodDays ? "day" : "month",
      currentMature,
      todayAnsweredProblems,
      todayMatureProblems,
      startingMature,
      netChange: currentMature - startingMature,
      adjustmentCount: 0,
      firstProblemDate: Number.isFinite(earliestRegistration)
        ? dayKey(earliestRegistration, settings.day_boundary_minutes)
        : null,
      points,
    };
  }

  global.NetMatureCore = Object.freeze({
    DEFAULT_MATURE_INTERVAL_DAYS,
    sanitizeMatureIntervalDays,
    calculateReviewDelayDays,
    currentReviewIntervalDays,
    normalizeReviewState,
    buildNetMatureStats,
  });
})(globalThis);
