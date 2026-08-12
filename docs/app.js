const DAY = 24 * 60 * 60 * 1000;
const HISTORY_KEY = "nanikiru-learning-v1";
const PROBLEMS_KEY = "nanikiru-problems-v1";
const BACKUP_PROMPT_KEY = "nanikiru-backup-prompt-v1";
const REVIEW_SETTINGS_KEY = "nanikiru-review-settings-v1";
const ADMIN_COUNT_KEY = "nanikiru-admin-count-v1";
const DEFAULT_ADMIN_COUNT = 3;
const GENRE_ORDER_KEY = "nanikiru-genre-order-v1";
const SUIT_PERMUTATIONS = Object.freeze([
  Object.freeze({ m: "m", p: "p", s: "s" }),
  Object.freeze({ m: "m", p: "s", s: "p" }),
  Object.freeze({ m: "p", p: "m", s: "s" }),
  Object.freeze({ m: "p", p: "s", s: "m" }),
  Object.freeze({ m: "s", p: "m", s: "p" }),
  Object.freeze({ m: "s", p: "p", s: "m" }),
]);
const MAX_BACKUP_FILE_BYTES = 20 * 1024 * 1024;
const MAX_DECOMPRESSED_BACKUP_BYTES = 100 * 1024 * 1024;
const MAX_BACKUP_TEXT_CHARS = MAX_DECOMPRESSED_BACKUP_BYTES;
const MAX_BACKUP_BASE64_CHARS = Math.ceil(MAX_BACKUP_FILE_BYTES * 4 / 3) + 16;
const MANAGEMENT_PAGE_SIZE = 200;
let suppressCloudUpload = false;
const DEFAULT_OTHER_WIN_HAZARD_PERCENT = Object.freeze([
  0.02, 0.08, 0.29, 0.78, 1.70, 3.05, 4.67, 6.44, 8.23,
  9.75, 11.08, 12.12, 12.76, 13.12, 13.23, 13.09, 11.70, 11.70,
]);
const DEFAULT_REVIEW_SETTINGS = Object.freeze({
  first_correct_days: 7,
  wrong_retry_days: 0,
  wrong_then_correct_days: 1,
  repeat_multiplier: 3,
  suspension_wrong_transitions: 8,
  quiz_random_transform: true,
  daily_new_problem_limit: 10,
  day_boundary_minutes: 0,
  mature_interval_days: 28,
  simulator_enable_reddora: true,
  simulator_enable_uradora: true,
  simulator_enable_shanten_down: true,
  simulator_enable_tegawari: true,
  simulator_auto_disable_deep_search: true,
  simulator_enable_riichi: true,
  simulator_enable_calls: true,
  simulator_enable_other_win_stop: true,
  simulator_tsumo_win_share_percent: 30,
  simulator_other_win_hazard_percent: DEFAULT_OTHER_WIN_HAZARD_PERCENT,
});
let problems = [];
let currentProblem = null;
let currentPresentedProblem = null;
let currentView = "quiz";
let currentQuizContext = null;
let filteredManagementProblems = [];
let wasmWorker;
let wasmRequestId = 0;
let wasmWorkerUseCount = 0;
let wasmWorkerGeneration = 0;
let wasmQueue = Promise.resolve();
const wasmRequests = new Map();
const WASM_ASSET_VERSION = "engine-v0.9.13";
const WASM_RECYCLE_AFTER = 24;
const WASM_REQUEST_TIMEOUT = 240000;
const WASM_DEFAULT_FLAGS = Object.freeze({
  enable_shanten_down: true,
  enable_tegawari: true,
});
const YAKU_NAMES = Object.freeze([
  "門前清自摸和", "立直", "一発", "断么九", "平和", "一盃口", "槍槓", "嶺上開花",
  "海底摸月", "河底撈魚", "ドラ", "裏ドラ", "赤ドラ", "白", "發", "中",
  "自風 東", "自風 南", "自風 西", "自風 北", "場風 東", "場風 南", "場風 西", "場風 北",
  "ダブル立直", "七対子", "対々和", "三暗刻", "三色同刻", "三色同順", "混老頭", "一気通貫",
  "混全帯么九", "小三元", "三槓子", "混一色", "純全帯么九", "二盃口", "流し満貫", "清一色",
  "天和", "地和", "人和", "緑一色", "大三元", "小四喜", "字一色", "国士無双",
  "九蓮宝燈", "四暗刻", "清老頭", "四槓子", "四暗刻単騎", "大四喜", "純正九蓮宝燈",
  "国士無双十三面", "抜きドラ",
]);
const YAKU_SHORT_NAMES = Object.freeze([
  "自摸", "立", "一", "断", "平", "一盃", "槍", "嶺", "海", "河", "ド", "裏", "赤", "白", "發", "中",
  "自東", "自南", "自西", "自北", "場東", "場南", "場西", "場北", "W立", "七対", "対々", "三暗",
  "三刻", "三色", "混老", "一通", "混全", "小三", "三槓", "混一", "純全", "二盃", "流満", "清一",
  "天", "地", "人", "緑", "大三", "小四", "字一", "国士", "九蓮", "四暗", "清老", "四槓",
  "四単", "大四", "純九", "国十三", "抜",
]);
const APP_BUILD_VERSION = typeof window !== "undefined" ? window.NANIKIRU_BUILD_VERSION || "local" : "local";
let pendingMeldTiles = [];
let reviewSkippedThisSession = false;
let activeAnswerUndo = null;
let managementSort = { key: "created_at", direction: "desc" };
let managementSortBound = false;
let selectedManagedProblemId = null;
let managementPage = 0;
const selectedManagementIds = new Set();
let wasmActiveRequestKey = null;
let wasmActiveRequestMode = {
  degraded: false,
  fallbackReason: "",
  requestedFlags: { ...WASM_DEFAULT_FLAGS },
  flags: { ...WASM_DEFAULT_FLAGS },
};
let lastWasmMode = null;
let netMaturePeriodDays = 31;

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  bindNavigation();
  bindQuiz();
  bindStats();
  bindAdmin();
  bindExport();
  buildTilePicker();
  renderAdminCount();
  renderReviewSettings();
  renderBuildVersion();
  await loadProblems();
  exposeSaveDataApi();
  window.dispatchEvent(new CustomEvent("nanikiru-app-ready"));
  document.getElementById("nav").classList.remove("hidden");
  showView("quiz");
  maybeShowBackupPrompt();
});

function bindNavigation() {
  document.querySelectorAll("#nav button").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });
}

function showView(name) {
  currentView = name;
  document.querySelectorAll(".view").forEach((el) => el.classList.add("hidden"));
  const view = $(`${name}-view`);
  if (view) view.classList.remove("hidden");
  document.querySelectorAll("#nav button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === name);
  });
  if (name === "stats") renderStats();
  if (name === "quiz") {
    const due = dueReviewProblems();
    if (due.length && !reviewSkippedThisSession) {
      showReviewQuestion();
    } else {
      showGenreSelection();
    }
  }
  if (name === "manage") renderAdminProblems();
}

function bindQuiz() {
  $("review-question").addEventListener("click", () => {
    reviewSkippedThisSession = true;
    showReviewQuestion();
  });
  $("random-question").addEventListener("click", () => {
    reviewSkippedThisSession = true;
    startRandomQuestion();
  });
  $("skip-review-question").addEventListener("click", () => {
    reviewSkippedThisSession = true;
    showGenreSelection();
  });
}

function renderBuildVersion() {
  const target = $("build-version");
  if (!target) return;
  target.textContent = APP_BUILD_VERSION;
}

function showGenreSelection() {
  const selection = $("quiz-genre-selection");
  const question = $("question-card");
  const empty = $("quiz-empty");
  if (selection) selection.classList.remove("hidden");
  if (question) question.classList.add("hidden");
  if (empty) empty.classList.add("hidden");
  currentQuizContext = { mode: "genre" };
  renderGenreQuizTable();
}

function showReviewQuestion() {
  showQuestionLayout();
  startReviewQuestion();
}

function refreshGenres() {
  if (currentView === "quiz") renderGenreQuizTable();
  const suggestions = $("genre-suggestions");
  if (suggestions) {
    suggestions.innerHTML = genresInRegistrationOrder()
      .map((genre) => `<option value="${escapeHtml(genre)}"></option>`)
      .join("");
  }
}

function genresInRegistrationOrder() {
  const firstSeen = new Map();
  problems.forEach((problem) => {
    const genre = problem.genre || "未分類";
    if (!firstSeen.has(genre)) firstSeen.set(genre, firstSeen.size);
  });
  const stored = loadGenreOrder();
  return [...stored.filter((genre) => firstSeen.has(genre)), ...[...firstSeen.keys()].filter((genre) => !stored.includes(genre))];
}

function loadGenreOrder() {
  try {
    const value = JSON.parse(localStorage.getItem(GENRE_ORDER_KEY) || "[]");
    return Array.isArray(value) ? [...new Set(value.filter((genre) => typeof genre === "string" && genre.length <= 100))] : [];
  } catch { return []; }
}

function saveGenreOrder(order, markDirty = true) {
  localStorage.setItem(GENRE_ORDER_KEY, JSON.stringify(order));
  if (markDirty) markSettingsDirty("ジャンル順を保存");
}

function renderGenreQuizTable() {
  const target = $("genre-quiz-rows");
  if (!target) return;
  const history = loadHistory();
  const summaries = new Map();
  problems.forEach((problem) => {
    const genre = problem.genre || "未分類";
    const summary = summaries.get(genre) || { total: 0, unseen: 0, attempts: 0, correct: 0 };
    const attempts = history[problem.id]?.attempts || [];
    summary.total += 1;
    if (!attempts.length) summary.unseen += 1;
    summary.attempts += attempts.length;
    summary.correct += attempts.reduce((count, attempt) => count + (attempt.correct ? 1 : 0), 0);
    summaries.set(genre, summary);
  });
  const genreRows = genresInRegistrationOrder().map((genre) => {
    const summary = summaries.get(genre) || { total: 0, unseen: 0, attempts: 0, correct: 0 };
    const accuracy = summary.attempts ? `${Math.round(summary.correct / summary.attempts * 100)}%` : "未回答";
    return `<tr>
      <td>
        <strong>${escapeHtml(genre)}</strong>
        <small>全${summary.total}問</small>
      </td>
      <td><b>${summary.unseen}</b>問</td>
      <td>${accuracy}<small>${summary.attempts ? `${summary.correct}/${summary.attempts}` : ""}</small></td>
      <td><button type="button" class="primary start-genre" data-genre="${escapeHtml(genre)}">出題</button></td>
    </tr>`;
  }).join("");
  const totalUnseen = [...summaries.values()].reduce((total, summary) => total + summary.unseen, 0);
  target.innerHTML = genreRows
    ? `${genreRows}<tr class="genre-total-row">
        <td><strong>合計</strong><small>全${problems.length}問</small></td>
        <td><b>${totalUnseen}</b>問</td>
        <td></td>
        <td></td>
      </tr>`
    : `<tr><td colspan="4">登録済みの問題がありません。</td></tr>`;
  document.querySelectorAll(".start-genre").forEach((button) => {
    button.addEventListener("click", () => startGenreQuestion(button.dataset.genre));
  });
  const due = dueReviewProblems(history);
  const reviewCounts = reviewQuestionCounts(history);
  $("review-due-count").textContent = `復習 ${due.length}問 + 新規 ${reviewCounts.newProblems}問`;
  $("review-question").disabled = due.length === 0;
  $("random-question").disabled = totalUnseen === 0;
}

function startGenreQuestion(genre) {
  const history = loadHistory();
  const matching = problems.filter((problem) => (problem.genre || "未分類") === genre);
  const unseen = matching.filter((problem) => !history[problem.id]?.attempts?.length);
  currentQuizContext = { mode: "genre", genre };
  showQuestionFromPool(unseen, false);
}

function unseenProblems(history = loadHistory()) {
  return problems.filter((problem) => !history[problem.id]?.attempts?.length);
}

function startRandomQuestion() {
  currentQuizContext = { mode: "random" };
  showQuestionFromPool(unseenProblems(), false);
}

function dueReviewProblems(history = loadHistory()) {
  const now = Date.now();
  return problems
    .filter((problem) => {
      const item = history[problem.id];
      return item?.attempts?.length && !isProblemSuspended(item) && Number(item.dueAt || 0) <= now;
    })
    .sort((a, b) => history[a.id].dueAt - history[b.id].dueAt);
}

function localDayRange(now = Date.now(), boundaryMinutes = loadReviewSettings().day_boundary_minutes) {
  const [year, month, day] = jstDayKey(now, boundaryMinutes).split("-").map(Number);
  const start = Date.UTC(year, month - 1, day) - 9 * 60 * 60 * 1000 + boundaryMinutes * 60 * 1000;
  return { start, end: start + DAY };
}

function normalizeReviewDelayDays(value) {
  const parsed = Math.max(0, Number(value) || 0);
  const nearestInteger = Math.round(parsed);
  const tolerance = Number.EPSILON * Math.max(1, parsed) * 16;
  return Math.abs(parsed - nearestInteger) <= tolerance ? nearestInteger : Math.ceil(parsed);
}

function reviewDueAt(answeredAt, delayDays, boundaryMinutes = loadReviewSettings().day_boundary_minutes) {
  const { start } = localDayRange(answeredAt, boundaryMinutes);
  return start + normalizeReviewDelayDays(delayDays) * DAY;
}

function newProblemsAnsweredToday(history = loadHistory(), now = Date.now()) {
  const { start, end } = localDayRange(now);
  return Object.values(history).reduce((count, state) => {
    const firstAttemptAt = Number(state?.attempts?.[0]?.at || 0);
    return count + Number(firstAttemptAt >= start && firstAttemptAt < end);
  }, 0);
}

function remainingDailyNewProblemCount(history = loadHistory(), now = Date.now()) {
  const limit = loadReviewSettings().daily_new_problem_limit;
  return Math.max(0, limit - newProblemsAnsweredToday(history, now));
}

function reviewQuestionCounts(history = loadHistory(), now = Date.now()) {
  const due = dueReviewProblems(history).length;
  const newProblems = Math.min(unseenProblems(history).length, remainingDailyNewProblemCount(history, now));
  return { due, newProblems, total: due + newProblems };
}

function reviewRemainingQuestionCounts(problem, state, history = loadHistory(), now = Date.now()) {
  const counts = reviewQuestionCounts(history, now);
  const currentIsNew = !state?.attempts?.length;
  const due = Math.max(0, counts.due - Number(!currentIsNew));
  const newProblems = Math.max(0, counts.newProblems - Number(currentIsNew));
  return { due, newProblems, total: due + newProblems };
}

function sampleRandomProblems(values, count, random = Math.random) {
  const candidates = [...values];
  for (let index = candidates.length - 1; index > 0; index--) {
    const other = Math.min(index, Math.floor(Math.max(0, random()) * (index + 1)));
    [candidates[index], candidates[other]] = [candidates[other], candidates[index]];
  }
  return candidates.slice(0, Math.max(0, count));
}

function reviewQuestionPool(history = loadHistory(), random = Math.random, now = Date.now()) {
  const due = dueReviewProblems(history).slice(0, 8);
  const newProblems = sampleRandomProblems(
    unseenProblems(history),
    remainingDailyNewProblemCount(history, now),
    random
  );
  return [...due, ...newProblems];
}

function startReviewQuestion() {
  const pool = reviewQuestionPool();
  currentQuizContext = { mode: "review" };
  showQuestionFromPool(pool, true);
}

function showQuestionLayout() {
  const selection = $("quiz-genre-selection");
  if (selection) selection.classList.add("hidden");
  const empty = $("quiz-empty");
  if (empty) empty.classList.add("hidden");
}

function showQuestionFromPool(pool, reviewMode) {
  showQuestionLayout();
  if (!pool.length) {
    $("question-card").classList.add("hidden");
    $("quiz-empty").classList.remove("hidden");
    $("quiz-empty").textContent = currentQuizContext?.mode === "random"
      ? "未回答の問題がありません。"
      : reviewMode
        ? "現在、復習問題・本日の新規問題はありません。"
        : "このジャンルには未回答の問題がありません。";
    return;
  }
  currentProblem = pool[Math.floor(Math.random() * pool.length)];
  const history = loadHistory();
  renderQuestion(currentProblem, history[currentProblem.id]);
}

function renderQuestion(problem, state) {
  activeAnswerUndo = null;
  currentPresentedProblem = buildQuizProblemPresentation(problem, loadReviewSettings());
  const presentedProblem = currentPresentedProblem;
  $("quiz-empty").classList.add("hidden");
  $("question-card").classList.remove("hidden");
  $("question-genre").textContent = "";
  $("question-genre").classList.add("hidden");
  $("question-status").innerHTML = renderQuestionStatus(problem, state);
  $("question-winds").innerHTML = renderQuestionWinds(presentedProblem.settings || {});
  $("question-winds").classList.toggle("hidden", !$("question-winds").innerHTML);
  $("question-next-cta").classList.add("hidden");
  $("answer-result").className = "result hidden";
  $("answer-result").innerHTML = "";
  $("quiz-simulator-result").className = "simulator-result hidden";
  $("quiz-simulator-result").innerHTML = "";
  $("question-prompt-note").textContent = presentedProblem.prompt_note || "";
  $("question-prompt-note").classList.toggle("hidden", !presentedProblem.prompt_note);
  $("skip-review-question").classList.toggle("hidden", currentQuizContext?.mode !== "review");
  $("skip-review-question").classList.toggle("hidden", currentQuizContext?.mode !== "review");
  const doraIndicators = presentedProblem.settings?.dora_indicators || [];
  const doraHtml = doraIndicators.length
    ? `<div class="question-dora"><span>ドラ表示牌</span><div class="concealed-hand">${doraIndicators.map((tile) => `
        <span class="dora-tile">${tileImage(tile)}</span>
      `).join("")}</div></div>`
    : "";
  const meldHtml = renderMelds(presentedProblem.melds || []);
  const { concealedTiles, drawnTile } = selectDrawnTileForQuestion(parseMpsz(presentedProblem.hand));
  $("hand").innerHTML = `<div class="question-topline">${doraHtml}</div><div class="question-hand-row"><div class="concealed-hand">${concealedTiles.map((tile) => `
    ${renderQuestionTile(tile, presentedProblem.settings || {})}
  `).join("")}${drawnTile ? renderQuestionTile(drawnTile, presentedProblem.settings || {}, true) : ""}</div>${meldHtml ? `<div class="question-melds">${meldHtml}</div>` : ""}</div>`;
  $("hand").querySelectorAll("button.tile[data-tile]").forEach((button) => {
    button.addEventListener("click", () => answerQuestion(button.dataset.tile, button));
  });
}

function renderQuestionTile(tile, settings = {}, isDrawn = false) {
  const markers = questionTileMarkers(tile, settings);
  const classes = ["tile", markers.includes("ド") ? "hand-dora" : "", isDrawn ? "drawn-tile" : ""].filter(Boolean).join(" ");
  const markerHtml = markers.length
    ? `<span class="tile-marker-row">${markers.map((marker) => `<span class="tile-marker ${marker === "ド" ? "dora-marker" : "wind-marker"}">${marker}</span>`).join("")}</span>`
    : `<span class="tile-marker-row empty-marker" aria-hidden="true"></span>`;
  return `<button class="${classes}" data-tile="${tile}" title="${isDrawn ? `ツモ牌: ${tile}` : tile}">
      ${tileImage(tile)}
      ${markerHtml}
    </button>`;
}

function questionTileMarkers(tile, settings = {}) {
  const markers = [];
  const doraTiles = (settings.dora_indicators || []).map(doraIndicatorToDora);
  if (doraTiles.some((dora) => samePhysicalTile(dora, tile))) markers.push("ド");
  if (settings.round_wind && samePhysicalTile(settings.round_wind, tile)) markers.push("場");
  if (settings.seat_wind && samePhysicalTile(settings.seat_wind, tile)) markers.push("自");
  return markers;
}

function renderQuestionStatus(problem, state) {
  const attemptText = state?.attempts?.length ? `出題 ${state.attempts.length}回目` : "初見";
  if (currentQuizContext?.mode === "random") {
    const remaining = Math.max(0, unseenProblems().filter((item) => item.id !== problem.id).length);
    return `${escapeHtml(attemptText)} <span class="question-remaining">/ 残り ${remaining}問</span>`;
  }
  if (currentQuizContext?.mode !== "review") return escapeHtml(attemptText);
  const remaining = reviewRemainingQuestionCounts(problem, state);
  return `${escapeHtml(attemptText)} <span class="question-remaining">/ 残り ${remaining.total}問（復習 ${remaining.due}問・新規 ${remaining.newProblems}問）</span>`;
}

function answerQuestion(tile, clickedButton) {
  if (!currentProblem) return;
  const presentedProblem = currentPresentedProblem || currentProblem;
  const answers = presentedProblem.answers || [presentedProblem.primary_answer];
  const correct = answers.some((answer) => samePhysicalTile(answer, tile));
  $("hand").querySelectorAll("button.tile[data-tile]").forEach((button) => {
    button.disabled = true;
    if (answers.some((answer) => samePhysicalTile(answer, button.dataset.tile))) {
      button.classList.add("correct");
    }
  });
  if (!correct) clickedButton.classList.add("wrong");
  const recorded = recordAttempt(currentProblem, correct);
  const dueAt = recorded.dueAt;
  activeAnswerUndo = recorded.undo;
  const result = $("answer-result");
  result.className = `result ${correct ? "correct" : "wrong"}`;
  const answerText = answers.join("・");
  const dueText = recorded.suspendedNow
    ? `誤答カウントが${recorded.suspensionThreshold}回に達したため休止しました`
    : dueAt <= Date.now() + 1000
      ? "すぐに復習対象になります"
      : `次回: ${new Date(dueAt).toLocaleString("ja-JP")}`;
  const postReviewText = currentQuizContext?.mode === "review"
    ? renderPostReviewInfo(currentProblem.id)
    : "";
  $("question-genre").textContent = currentProblem.genre || "未分類";
  $("question-genre").classList.remove("hidden");
  result.innerHTML = `<strong>${correct ? "正解" : "不正解"}</strong>
    <p>ジャンル: ${escapeHtml(currentProblem.genre || "未分類")}</p>
    <p>正解として設定された打牌: ${escapeHtml(answerText)} ／ ${escapeHtml(dueText)}</p>
    ${postReviewText ? `<p>${postReviewText}</p>` : ""}
    ${presentedProblem.note ? `<p>${renderTextWithTiles(presentedProblem.note)}</p>` : ""}
    <div class="result-actions">
      <button id="undo-current-answer" type="button">解答取消</button>
      <button id="edit-current-problem" type="button">問題編集</button>
      <button id="continue-question" type="button" class="primary">次の問題</button>
    </div>`;
  $("undo-current-answer").addEventListener("click", undoCurrentAnswer);
  $("edit-current-problem").addEventListener("click", () => openProblemInManager(currentProblem.id));
  $("continue-question").addEventListener("click", continueQuestion);
  $("continue-question-inline").addEventListener("click", continueQuestion);
  $("question-next-cta").classList.remove("hidden");
  renderSimulatorTable(
    $("quiz-simulator-result"),
    presentedProblem.simulator,
    answers,
    tile
  );
  refreshQuizSimulatorStats(presentedProblem, answers, tile);
  renderGenreQuizTable();
  if (recorded.suspendedNow) {
    alert(`この問題は「正解後の不正解」が${recorded.suspensionThreshold}回に達したため休止しました。\n問題一覧から休止を解除できます。`);
  }
}

function renderPostReviewInfo(currentProblemId) {
  const remaining = dueReviewProblems().filter((problem) => problem.id !== currentProblemId);
  if (!remaining.length) return "後難問なし";
  const byGenre = remaining.reduce((counts, problem) => {
    const genre = problem.genre || "未分類";
    counts[genre] = (counts[genre] || 0) + 1;
    return counts;
  }, {});
  const summary = Object.entries(byGenre)
    .map(([genre, count]) => `${escapeHtml(genre)}:${count}問`)
    .join(" / ");
  return `後難問あり: ${remaining.length}問${summary ? ` (${summary})` : ""}`;
}

function renderQuestionWinds(settings) {
  const roundWind = windLabel(settings.round_wind);
  const seatWind = windLabel(settings.seat_wind);
  const items = [];
  if (roundWind) {
    items.push(`<span class="question-wind-item" title="場風">場風${tileImage(settings.round_wind)}</span>`);
  }
  if (seatWind) {
    items.push(`<span class="question-wind-item" title="自風">自風${tileImage(settings.seat_wind)}</span>`);
  }
  return items.join("");
}

function windLabel(tile) {
  return ({ "1z": "東", "2z": "南", "3z": "西", "4z": "北" })[tile] || "";
}

function continueQuestion() {
  if (currentQuizContext?.mode === "genre") {
    startGenreQuestion(currentQuizContext.genre);
  } else if (currentQuizContext?.mode === "random") {
    startRandomQuestion();
  } else if (currentQuizContext?.mode === "review") {
    startReviewQuestion();
  } else if (currentProblem) {
    startGenreQuestion(currentProblem.genre || "未分類");
  }
  $("question-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

function recordAttempt(problem, correct) {
  const history = loadHistory();
  const reviewSettings = loadReviewSettings();
  const now = Date.now();
  const hadPreviousState = Object.prototype.hasOwnProperty.call(history, problem.id);
  const previousState = hadPreviousState
    ? JSON.parse(JSON.stringify(history[problem.id]))
    : null;
  const state = history[problem.id] || { attempts: [] };
  const previous = state.attempts[state.attempts.length - 1];
  const previousWrongTransitionCount = wrongTransitionCount(state);
  const countsAsWrongTransition = !correct && previous?.correct === true;
  const nextWrongTransitionCount = previousWrongTransitionCount + (countsAsWrongTransition ? 1 : 0);
  const suspensionThreshold = reviewSettings.suspension_wrong_transitions;
  const suspendedNow = !isProblemSuspended(state) && nextWrongTransitionCount >= suspensionThreshold;
  const intervalDays = calculateNextReviewDelayDays(state.attempts, correct, now, reviewSettings);
  const dueAt = reviewDueAt(now, intervalDays, reviewSettings.day_boundary_minutes);
  state.attempts.push({ at: now, correct, genre: problem.genre || "未分類", intervalDays });
  state.dueAt = dueAt;
  state.wrongTransitionCount = nextWrongTransitionCount;
  if (suspendedNow) {
    state.suspended = true;
    state.suspendedAt = now;
  }
  history[problem.id] = state;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  markProgressDirty(problem.id, "学習履歴を保存");
  return {
    dueAt,
    suspendedNow,
    suspensionThreshold,
    undo: {
      problemId: problem.id,
      attemptAt: now,
      correct,
      attemptsLength: state.attempts.length,
      previousState,
    },
  };
}

function calculateNextReviewDueAt(attempts, correct, answeredAt, settings = loadReviewSettings()) {
  return reviewDueAt(
    answeredAt,
    calculateNextReviewDelayDays(attempts, correct, answeredAt, settings),
    settings.day_boundary_minutes,
  );
}

function calculateNextReviewDelayDays(attempts, correct, answeredAt, settings = loadReviewSettings()) {
  return NetMatureCore.calculateReviewDelayDays(attempts, correct, answeredAt, settings);
}

function wrongTransitionCount(state) {
  if (Object.prototype.hasOwnProperty.call(state || {}, "wrongTransitionCount")) {
    const stored = Number(state.wrongTransitionCount);
    return Number.isFinite(stored) && stored >= 0 ? Math.floor(stored) : 0;
  }
  const attempts = state?.attempts || [];
  return attempts.reduce((count, attempt, index) => (
    index > 0 && attempt.correct === false && attempts[index - 1]?.correct === true ? count + 1 : count
  ), 0);
}

function isProblemSuspended(state) {
  return state?.suspended === true;
}

function reconcileSuspendedProblems({ notify = false } = {}) {
  const history = loadHistory();
  const threshold = loadReviewSettings().suspension_wrong_transitions;
  const newlySuspended = [];
  const newlyResumed = [];
  activeHistoryEntries(history).forEach(([problemId, state]) => {
    const count = wrongTransitionCount(state);
    if (!isProblemSuspended(state) && count >= threshold) {
      state.wrongTransitionCount = count;
      state.suspended = true;
      state.suspendedAt = state.attempts?.[state.attempts.length - 1]?.at || Date.now();
      newlySuspended.push(problemId);
    } else if (isProblemSuspended(state) && count < threshold) {
      state.suspended = false;
      delete state.suspendedAt;
      newlyResumed.push(problemId);
    }
  });
  const changedIds = [...newlySuspended, ...newlyResumed];
  if (!changedIds.length) return { newlySuspended, newlyResumed };
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  changedIds.forEach((problemId) => markProgressDirty(problemId, "休止判定を保存"));
  if (notify) setTimeout(() => {
    if (newlySuspended.length) alert(`${newlySuspended.length}問が「正解後の不正解」${threshold}回に達していたため休止になりました。\n問題一覧から休止を解除できます。`);
  }, 0);
  return { newlySuspended, newlyResumed };
}

function undoCurrentAnswer() {
  const undo = activeAnswerUndo;
  if (!undo || !currentProblem || currentProblem.id !== undo.problemId) return;
  const history = loadHistory();
  const state = history[undo.problemId];
  const last = state?.attempts?.[state.attempts.length - 1];
  const isRecordedAnswer = state?.attempts?.length === undo.attemptsLength
    && last?.at === undo.attemptAt
    && Boolean(last?.correct) === undo.correct;
  if (!isRecordedAnswer) {
    activeAnswerUndo = null;
    const button = $("undo-current-answer");
    if (button) button.disabled = true;
    return;
  }

  if (undo.previousState) history[undo.problemId] = undo.previousState;
  else delete history[undo.problemId];
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  markProgressDirty(undo.problemId, "解答を取り消し", !undo.previousState);

  const restoredState = undo.previousState;
  activeAnswerUndo = null;
  renderQuestion(currentProblem, restoredState);
  renderGenreQuizTable();
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}"); }
  catch { return {}; }
}

function repairReviewHistoryDueDates() {
  const history = loadHistory();
  const reviewSettings = loadReviewSettings();
  const changedIds = new Set();
  activeHistoryEntries(history).forEach(([problemId, state]) => {
    const attempts = state?.attempts || [];
    const last = attempts[attempts.length - 1];
    if (!last) return;
    let nextDueAt = Number(state.dueAt || 0);

    if (attempts.length >= 2) {
      const previous = attempts[attempts.length - 2];
      const elapsedDays = Math.max(0, calendarDaysDiffJst(previous.at, last.at, reviewSettings.day_boundary_minutes));
      const currentDelayDays = (nextDueAt - last.at) / DAY;
      if (last.correct && !previous.correct && elapsedDays > 0
        && Math.abs(currentDelayDays - reviewSettings.wrong_then_correct_days) <= 0.01) {
        const fixedDelayDays = (elapsedDays + reviewSettings.wrong_then_correct_days) * reviewSettings.repeat_multiplier;
        nextDueAt = reviewDueAt(last.at, fixedDelayDays, reviewSettings.day_boundary_minutes);
      }
    }

    const preservedDelayDays = normalizeReviewDelayDays((nextDueAt - last.at) / DAY);
    nextDueAt = reviewDueAt(last.at, preservedDelayDays, reviewSettings.day_boundary_minutes);
    if (Number.isFinite(nextDueAt) && nextDueAt !== Number(state.dueAt || 0)) {
      state.dueAt = nextDueAt;
      changedIds.add(problemId);
    }
  });
  if (changedIds.size) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    changedIds.forEach((problemId) => markProgressDirty(problemId, "復習予定を日付境界に調整"));
  }
  return [...changedIds];
}

function loadReviewSettings() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(REVIEW_SETTINGS_KEY) || "{}");
  } catch {
    stored = {};
  }
  return sanitizeReviewSettings(stored);
}

function sanitizeReviewSettings(stored = {}) {
  return {
    first_correct_days: sanitizeReviewSetting(stored.first_correct_days, DEFAULT_REVIEW_SETTINGS.first_correct_days),
    wrong_retry_days: sanitizeReviewSetting(stored.wrong_retry_days, DEFAULT_REVIEW_SETTINGS.wrong_retry_days),
    wrong_then_correct_days: sanitizeReviewSetting(stored.wrong_then_correct_days, DEFAULT_REVIEW_SETTINGS.wrong_then_correct_days),
    repeat_multiplier: sanitizeReviewSetting(stored.repeat_multiplier, DEFAULT_REVIEW_SETTINGS.repeat_multiplier),
    suspension_wrong_transitions: sanitizeSuspensionThreshold(stored.suspension_wrong_transitions),
    quiz_random_transform: sanitizeBooleanSetting(stored.quiz_random_transform, DEFAULT_REVIEW_SETTINGS.quiz_random_transform),
    daily_new_problem_limit: sanitizeDailyNewProblemLimit(stored.daily_new_problem_limit),
    day_boundary_minutes: sanitizeDayBoundaryMinutes(stored.day_boundary_minutes),
    mature_interval_days: sanitizeMatureIntervalDays(stored.mature_interval_days),
    simulator_enable_reddora: sanitizeBooleanSetting(stored.simulator_enable_reddora, DEFAULT_REVIEW_SETTINGS.simulator_enable_reddora),
    simulator_enable_uradora: sanitizeBooleanSetting(stored.simulator_enable_uradora, DEFAULT_REVIEW_SETTINGS.simulator_enable_uradora),
    simulator_enable_shanten_down: sanitizeBooleanSetting(stored.simulator_enable_shanten_down, DEFAULT_REVIEW_SETTINGS.simulator_enable_shanten_down),
    simulator_enable_tegawari: sanitizeBooleanSetting(stored.simulator_enable_tegawari, DEFAULT_REVIEW_SETTINGS.simulator_enable_tegawari),
    simulator_auto_disable_deep_search: sanitizeBooleanSetting(stored.simulator_auto_disable_deep_search, DEFAULT_REVIEW_SETTINGS.simulator_auto_disable_deep_search),
    simulator_enable_riichi: sanitizeBooleanSetting(stored.simulator_enable_riichi, DEFAULT_REVIEW_SETTINGS.simulator_enable_riichi),
    simulator_enable_calls: sanitizeBooleanSetting(stored.simulator_enable_calls, DEFAULT_REVIEW_SETTINGS.simulator_enable_calls),
    simulator_enable_other_win_stop: sanitizeBooleanSetting(stored.simulator_enable_other_win_stop, DEFAULT_REVIEW_SETTINGS.simulator_enable_other_win_stop),
    simulator_tsumo_win_share_percent: sanitizePercentSetting(stored.simulator_tsumo_win_share_percent, DEFAULT_REVIEW_SETTINGS.simulator_tsumo_win_share_percent),
    simulator_other_win_hazard_percent: sanitizeOtherWinHazard(stored.simulator_other_win_hazard_percent),
  };
}

function sanitizeReviewSetting(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function sanitizeSuspensionThreshold(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1000) return DEFAULT_REVIEW_SETTINGS.suspension_wrong_transitions;
  return Math.floor(parsed);
}

function sanitizeDailyNewProblemLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1000) return DEFAULT_REVIEW_SETTINGS.daily_new_problem_limit;
  return Math.floor(parsed);
}

function sanitizeDayBoundaryMinutes(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 24 * 60) return DEFAULT_REVIEW_SETTINGS.day_boundary_minutes;
  return Math.floor(parsed);
}

function sanitizeMatureIntervalDays(value) {
  return NetMatureCore.sanitizeMatureIntervalDays(value, DEFAULT_REVIEW_SETTINGS.mature_interval_days);
}

function parseDayBoundaryTime(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ""));
  if (!match) return DEFAULT_REVIEW_SETTINGS.day_boundary_minutes;
  return sanitizeDayBoundaryMinutes(Number(match[1]) * 60 + Number(match[2]));
}

function formatDayBoundaryTime(value) {
  const minutes = sanitizeDayBoundaryMinutes(value);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function sanitizeBooleanSetting(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function sanitizePercentSetting(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, parsed));
}

function sanitizeOtherWinHazard(value) {
  const source = Array.isArray(value) ? value : DEFAULT_OTHER_WIN_HAZARD_PERCENT;
  const result = DEFAULT_OTHER_WIN_HAZARD_PERCENT.map((fallback, index) =>
    sanitizePercentSetting(source[index], fallback));
  result[17] = result[16];
  return result;
}

function saveReviewSettings(settings) {
  localStorage.setItem(REVIEW_SETTINGS_KEY, JSON.stringify(sanitizeReviewSettings(settings)));
  markSettingsDirty("設定を保存");
  repairReviewHistoryDueDates();
  reconcileSuspendedProblems({ notify: true });
  if (currentView === "manage") renderAdminProblems();
  if (currentView === "quiz") renderGenreQuizTable();
  if (currentView === "stats") renderStats();
}

function renderReviewSettings() {
  const settings = loadReviewSettings();
  const bindings = {
    "review-first-correct-days": settings.first_correct_days,
    "review-wrong-retry-days": settings.wrong_retry_days,
    "review-wrong-then-correct-days": settings.wrong_then_correct_days,
    "review-repeat-multiplier": settings.repeat_multiplier,
    "review-suspension-wrong-transitions": settings.suspension_wrong_transitions,
    "review-daily-new-problem-limit": settings.daily_new_problem_limit,
    "review-day-boundary-time": formatDayBoundaryTime(settings.day_boundary_minutes),
    "review-mature-interval-days": settings.mature_interval_days,
  };
  Object.entries(bindings).forEach(([id, value]) => {
    const input = $(id);
    if (input) input.value = String(value);
  });
  const randomTransform = $("quiz-random-transform");
  if (randomTransform) randomTransform.checked = settings.quiz_random_transform;
  const simulatorCheckboxes = {
    "simulator-enable-reddora": settings.simulator_enable_reddora,
    "simulator-enable-uradora": settings.simulator_enable_uradora,
    "simulator-enable-shanten-down": settings.simulator_enable_shanten_down,
    "simulator-enable-tegawari": settings.simulator_enable_tegawari,
    "simulator-auto-disable-deep-search": settings.simulator_auto_disable_deep_search,
    "simulator-enable-riichi": settings.simulator_enable_riichi,
    "simulator-enable-calls": settings.simulator_enable_calls,
    "simulator-enable-other-win-stop": settings.simulator_enable_other_win_stop,
  };
  Object.entries(simulatorCheckboxes).forEach(([id, checked]) => {
    const input = $(id);
    if (input) input.checked = checked;
  });
  const tsumoShare = $("simulator-tsumo-win-share-percent");
  if (tsumoShare) tsumoShare.value = String(settings.simulator_tsumo_win_share_percent);
  const hazardGrid = $("simulator-other-win-hazard-grid");
  if (hazardGrid) {
    hazardGrid.innerHTML = Array.from({ length: 6 }, (_, row) =>
      [row + 1, row + 7, row + 13].map((turn) => `
        <td>${turn}</td><td><input data-hazard-turn="${turn}" type="number" min="0" max="100" step="0.01"
          value="${Number(settings.simulator_other_win_hazard_percent[turn - 1]).toFixed(2)}"${turn === 18 ? " readonly" : ""}></td>
      `).join("")
    ).map((cells) => `<tr>${cells}</tr>`).join("");
  }
}

function readReviewSettingsForm() {
  const current = loadReviewSettings();
  const hazards = [...current.simulator_other_win_hazard_percent];
  document.querySelectorAll("#simulator-other-win-hazard-grid [data-hazard-turn]").forEach((input) => {
    hazards[Number(input.dataset.hazardTurn) - 1] = input.value;
  });
  hazards[17] = hazards[16];
  return {
    first_correct_days: $("review-first-correct-days").value,
    wrong_retry_days: $("review-wrong-retry-days").value,
    wrong_then_correct_days: $("review-wrong-then-correct-days").value,
    repeat_multiplier: $("review-repeat-multiplier").value,
    suspension_wrong_transitions: $("review-suspension-wrong-transitions").value,
    daily_new_problem_limit: $("review-daily-new-problem-limit").value,
    day_boundary_minutes: parseDayBoundaryTime($("review-day-boundary-time").value),
    mature_interval_days: $("review-mature-interval-days").value,
    quiz_random_transform: $("quiz-random-transform").checked,
    simulator_enable_reddora: $("simulator-enable-reddora").checked,
    simulator_enable_uradora: $("simulator-enable-uradora").checked,
    simulator_enable_shanten_down: $("simulator-enable-shanten-down").checked,
    simulator_enable_tegawari: $("simulator-enable-tegawari").checked,
    simulator_auto_disable_deep_search: $("simulator-auto-disable-deep-search").checked,
    simulator_enable_riichi: $("simulator-enable-riichi").checked,
    simulator_enable_calls: $("simulator-enable-calls").checked,
    simulator_enable_other_win_stop: $("simulator-enable-other-win-stop").checked,
    simulator_tsumo_win_share_percent: $("simulator-tsumo-win-share-percent").value,
    simulator_other_win_hazard_percent: hazards,
  };
}

function loadAdminCount() {
  const value = Number(localStorage.getItem(ADMIN_COUNT_KEY));
  return Number.isFinite(value) && value >= 1 && value <= 100 ? Math.floor(value) : DEFAULT_ADMIN_COUNT;
}

function saveAdminCount() {
  const input = $("admin-count");
  if (!input) return;
  const value = Math.max(1, Math.min(100, Math.floor(Number(input.value) || DEFAULT_ADMIN_COUNT)));
  input.value = String(value);
  localStorage.setItem(ADMIN_COUNT_KEY, String(value));
  markSettingsDirty("類題作成数を保存");
}

function renderAdminCount() {
  const input = $("admin-count");
  if (!input) return;
  input.value = String(loadAdminCount());
}

function bindStats() {
  $("reset-history").addEventListener("click", () => {
    if (confirm("この端末の学習履歴をすべて削除しますか？")) {
      const deletedProgressIds = Object.keys(loadHistory());
      localStorage.removeItem(HISTORY_KEY);
      deletedProgressIds.forEach((problemId) => markProgressDirty(problemId, "学習履歴を削除", true));
      renderStats();
    }
  });
  $("net-mature-periods")?.addEventListener("change", (event) => {
    const input = event.target.closest('input[name="net-mature-period"]');
    if (!input) return;
    netMaturePeriodDays = Number(input.value) || 0;
    drawNetMatureReport(loadHistory());
  });
}

function renderStats() {
  const history = loadHistory();
  const byGenre = {};
  const attempts = [];
  activeHistoryEntries(history).forEach(([, state]) => {
    (state.attempts || []).forEach((attempt) => {
      const genre = attempt.genre || "未分類";
      byGenre[genre] ||= { total: 0, correct: 0 };
      byGenre[genre].total++;
      if (attempt.correct) byGenre[genre].correct++;
      attempts.push(attempt);
    });
  });
  $("stats-summary").innerHTML = genresInRegistrationOrder()
    .filter((genre) => byGenre[genre])
    .map((genre) => {
      const data = byGenre[genre];
      return `
    <div class="stat-row">
      <span>${escapeHtml(genre)}</span>
      <strong>${Math.round(data.correct / data.total * 100)}%</strong>
      <small>${data.correct} / ${data.total} 正解</small>
    </div>`;
  }).join("") || "<p>まだ解答履歴がありません。</p>";
  attempts.sort((a, b) => a.at - b.at);
  const firstDailyAttempts = buildFirstAttemptsByProblemDay(history);
  const firstProblemAttempts = buildFirstAttemptsByProblem(history);
  drawOverallChart(attempts, firstDailyAttempts, firstProblemAttempts);
  renderGenreChartFilters(attempts);
  drawDailyChart(attempts, firstDailyAttempts, firstProblemAttempts);
  drawHardSolveChart(history);
  drawProblemAdditionChart();
  drawReviewScheduleChart(history);
  drawReviewIntervalChart(history);
  drawNetMatureReport(history);
}

function drawNetMatureReport(history) {
  const settings = loadReviewSettings();
  const stats = NetMatureCore.buildNetMatureStats({
    problems,
    history,
    settings,
    periodDays: netMaturePeriodDays,
  });
  const periodLabel = stats.periodDays === 31
    ? "直近1か月・日次"
    : stats.periodDays === 90
      ? "直近3か月・日次"
      : stats.periodDays === 365
        ? "直近1年・日次"
        : "全期間・月次";
  const registration = !stats.periodDays && stats.firstProblemDate
    ? `・最初の問題登録 ${stats.firstProblemDate}`
    : "";
  $("net-mature-meta").textContent = `復習間隔 ≥ ${stats.thresholdDays}日・${periodLabel}${registration}`;
  $("net-mature-current").textContent = stats.currentMature.toLocaleString("ja-JP");
  const change = $("net-mature-change");
  change.textContent = `${stats.netChange > 0 ? "+" : ""}${stats.netChange.toLocaleString("ja-JP")}`;
  change.classList.toggle("positive", stats.netChange > 0);
  change.classList.toggle("negative", stats.netChange < 0);
  $("net-mature-start").textContent = stats.startingMature.toLocaleString("ja-JP");
  $("net-mature-values-body").innerHTML = stats.points.slice(-12).reverse().map((point) => `
    <tr>
      <td>${escapeHtml(point.key)}</td>
      <td class="${point.net > 0 ? "positive" : point.net < 0 ? "negative" : ""}">${point.net > 0 ? "+" : ""}${point.net.toLocaleString("ja-JP")}</td>
      <td>${point.cumulative.toLocaleString("ja-JP")}</td>
    </tr>`).join("");
  drawNetMatureCanvas($("net-mature-chart"), stats.points);
}

function drawNetMatureCanvas(canvas, points) {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const { width, height } = canvas;
  const left = 68;
  const right = width - 76;
  const top = 32;
  const bottom = height - 58;
  const chartWidth = right - left;
  const chartHeight = bottom - top;
  const data = Array.isArray(points) && points.length ? points : [{ key: "", label: "", net: 0, cumulative: 0 }];
  const maxNet = Math.max(1, ...data.map((point) => Math.abs(Number(point.net) || 0)));
  let minCumulative = Math.min(...data.map((point) => Number(point.cumulative) || 0));
  let maxCumulative = Math.max(...data.map((point) => Number(point.cumulative) || 0));
  if (minCumulative === maxCumulative) {
    minCumulative -= 1;
    maxCumulative += 1;
  } else {
    const padding = Math.max(1, (maxCumulative - minCumulative) * 0.08);
    minCumulative -= padding;
    maxCumulative += padding;
  }
  const xFor = (index) => left + (index + 0.5) * chartWidth / data.length;
  const yForCumulative = (value) => bottom - (value - minCumulative) / (maxCumulative - minCumulative) * chartHeight;
  const netZeroY = top + chartHeight / 2;
  const netScale = (chartHeight / 2 - 8) / maxNet;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fffdf8";
  context.fillRect(0, 0, width, height);
  context.font = "12px sans-serif";
  context.lineWidth = 1;
  for (let tick = 0; tick <= 4; tick++) {
    const y = top + chartHeight * tick / 4;
    context.strokeStyle = tick === 2 ? "#a9b4ae" : "#e4dfd5";
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(right, y);
    context.stroke();
    const cumulativeValue = maxCumulative - (maxCumulative - minCumulative) * tick / 4;
    context.fillStyle = "#66716b";
    context.textAlign = "left";
    context.fillText(Math.round(cumulativeValue).toLocaleString("ja-JP"), right + 10, y + 4);
  }

  const slotWidth = chartWidth / data.length;
  const barWidth = Math.max(1, Math.min(14, slotWidth * 0.72));
  data.forEach((point, index) => {
    const net = Number(point.net) || 0;
    if (!net) return;
    const barHeight = Math.max(1, Math.abs(net) * netScale);
    context.fillStyle = net > 0 ? "#3ba66b" : "#d05a62";
    context.fillRect(xFor(index) - barWidth / 2, net > 0 ? netZeroY - barHeight : netZeroY, barWidth, barHeight);
  });

  context.strokeStyle = "#5f84ff";
  context.lineWidth = 3;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  data.forEach((point, index) => {
    const x = xFor(index);
    const y = yForCumulative(Number(point.cumulative) || 0);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();

  const labelIndexes = [...new Set([0, Math.floor((data.length - 1) / 3), Math.floor((data.length - 1) * 2 / 3), data.length - 1])];
  context.fillStyle = "#66716b";
  context.font = "12px sans-serif";
  labelIndexes.forEach((index) => {
    context.textAlign = index === 0 ? "left" : index === data.length - 1 ? "right" : "center";
    context.fillText(data[index].label, xFor(index), bottom + 28);
  });
  context.save();
  context.translate(18, top + chartHeight / 2);
  context.rotate(-Math.PI / 2);
  context.textAlign = "center";
  context.fillText("Net / 期間", 0, 0);
  context.restore();
  context.save();
  context.translate(width - 18, top + chartHeight / 2);
  context.rotate(Math.PI / 2);
  context.textAlign = "center";
  context.fillText("累積 Mature", 0, 0);
  context.restore();
}

function buildFirstAttemptsByProblemDay(history) {
  const attempts = [];
  activeHistoryEntries(history).forEach(([problemId, state]) => {
    (state?.attempts || []).forEach((attempt) => {
      attempts.push({ ...attempt, problemId });
    });
  });
  attempts.sort((a, b) => a.at - b.at);
  const firstAttempts = [];
  const seen = new Set();
  const boundaryMinutes = loadReviewSettings().day_boundary_minutes;
  attempts.forEach((attempt) => {
    const problemAttempts = history[attempt.problemId]?.attempts || [];
    if (!problemAttempts.length || problemAttempts[0].at === attempt.at) return;
    const key = `${attempt.problemId}:${jstDayKey(attempt.at, boundaryMinutes)}`;
    if (seen.has(key)) return;
    seen.add(key);
    firstAttempts.push(attempt);
  });
  return firstAttempts;
}

function buildFirstAttemptsByProblem(history) {
  const firstAttempts = [];
  activeHistoryEntries(history).forEach(([, state]) => {
    const first = state?.attempts?.[0];
    if (first) firstAttempts.push(first);
  });
  return firstAttempts.sort((a, b) => a.at - b.at);
}

function drawOverallChart(attempts, firstDailyAttempts, firstProblemAttempts) {
  const points = attempts.map((attempt, index) => {
    const window = attempts.slice(Math.max(0, index - 299), index + 1);
    const correct = window.filter((item) => item.correct).length;
    return { label: String(index + 1), value: correct / window.length };
  });
  const firstDailyPoints = firstDailyAttempts.map((attempt, index) => {
    const window = firstDailyAttempts.slice(Math.max(0, index - 299), index + 1);
    const correct = window.filter((item) => item.correct).length;
    return { label: String(index + 1), value: correct / window.length };
  });
  const firstProblemPoints = firstProblemAttempts.map((attempt, index) => {
    const window = firstProblemAttempts.slice(Math.max(0, index - 299), index + 1);
    const correct = window.filter((item) => item.correct).length;
    return { label: String(index + 1), value: correct / window.length };
  });
  drawLineChart($("overall-chart"), [
    { name: "直近300解答", color: "#23745a", points },
    { name: "復習問題のその日最初", color: "#386fa4", points: firstDailyPoints },
    { name: "初見の問題", color: "#8a5b3d", points: firstProblemPoints },
  ], false);
}

function renderGenreChartFilters(attempts) {
  const genres = genresInRegistrationOrder();
  const target = $("genre-chart-filters");
  const existing = new Set(
    [...target.querySelectorAll("input:checked")].map((input) => input.value)
  );
  target.innerHTML = genres.map((genre, index) => `
    <label><input type="checkbox" value="${escapeHtml(genre)}" ${existing.size ? (existing.has(genre) ? "checked" : "") : (index < 6 ? "checked" : "")}>${escapeHtml(genre)}</label>
  `).join("");
  target.querySelectorAll("input").forEach((input) =>
    input.addEventListener("change", () => drawGenreChart(attempts))
  );
  drawGenreChart(attempts);
}

function drawGenreChart(attempts) {
  const selected = new Set(
    [...$("genre-chart-filters").querySelectorAll("input:checked")].map((input) => input.value)
  );
  const colors = ["#23745a", "#a23a31", "#386fa4", "#c48b24", "#7b4ab5", "#388b8b", "#8a5b3d"];
  const series = genresInRegistrationOrder().filter((genre) => selected.has(genre)).map((genre, index) => {
    const items = attempts.filter((attempt) => (attempt.genre || "未分類") === genre);
    let correct = 0;
    return {
      name: genre,
      color: colors[index % colors.length],
      points: items.map((attempt, itemIndex) => {
        if (attempt.correct) correct++;
        return { label: String(itemIndex + 1), value: correct / (itemIndex + 1) };
      }),
    };
  });
  drawLineChart($("genre-chart"), series, false);
}

function drawDailyChart(attempts, firstDailyAttempts, firstProblemAttempts) {
  const daily = {};
  const boundaryMinutes = loadReviewSettings().day_boundary_minutes;
  attempts.forEach((attempt) => {
    const date = jstDayKey(attempt.at, boundaryMinutes);
    daily[date] ||= { total: 0, correct: 0 };
    daily[date].total++;
    if (attempt.correct) daily[date].correct++;
  });
  const points = Object.entries(daily).sort().map(([date, value]) => ({
    label: date.slice(5),
    value: value.correct / value.total,
  }));
  const firstDaily = {};
  firstDailyAttempts.forEach((attempt) => {
    const date = jstDayKey(attempt.at, boundaryMinutes);
    firstDaily[date] ||= { total: 0, correct: 0 };
    firstDaily[date].total++;
    if (attempt.correct) firstDaily[date].correct++;
  });
  const firstPoints = Object.entries(firstDaily).sort().map(([date, value]) => ({
    label: date.slice(5),
    value: value.correct / value.total,
  }));
  const firstProblemDaily = {};
  firstProblemAttempts.forEach((attempt) => {
    const date = jstDayKey(attempt.at, boundaryMinutes);
    firstProblemDaily[date] ||= { total: 0, correct: 0 };
    firstProblemDaily[date].total++;
    if (attempt.correct) firstProblemDaily[date].correct++;
  });
  const firstProblemPoints = Object.entries(firstProblemDaily).sort().map(([date, value]) => ({
    label: date.slice(5),
    value: value.correct / value.total,
  }));
  drawLineChart($("daily-chart"), [
    { name: "日付別", color: "#386fa4", points },
    { name: "復習問題のその日最初", color: "#8a5b3d", points: firstPoints },
    { name: "初見の問題", color: "#a23a31", points: firstProblemPoints },
  ], false);
}

function drawHardSolveChart(history) {
  drawBarChart($("hard-solve-chart"), buildSolveActivityPoints(history), "#8a5b3d");
}

function buildSolveActivityPoints(history) {
  const daily = {};
  const boundaryMinutes = loadReviewSettings().day_boundary_minutes;
  activeHistoryEntries(history).forEach(([, state]) => {
    (state.attempts || []).forEach((attempt) => {
      const date = jstDayKey(attempt.at, boundaryMinutes);
      daily[date] ||= { total: 0 };
      daily[date].total++;
    });
  });
  const points = Object.entries(daily).sort().map(([date, value]) => ({
    label: date.slice(5),
    value: value.total,
  }));
  return points;
}

function drawProblemAdditionChart() {
  const stats = buildProblemAdditionStats(problems);
  $("problem-add-average").textContent = stats.total
    ? `平均 ${stats.averagePerDay.toFixed(2)}問／日`
    : "まだ登録記録がありません";
  drawBarChart($("problem-add-chart"), stats.total ? stats.buckets : [], "#c48b24");
}

function buildProblemAdditionStats(items, now = Date.now()) {
  const counts = new Map();
  const createdTimes = [];
  const boundaryMinutes = loadReviewSettings().day_boundary_minutes;
  (items || []).forEach((problem) => {
    const createdAt = Date.parse(problem?.created_at || "");
    if (!Number.isFinite(createdAt)) return;
    createdTimes.push(createdAt);
    const daysAgo = Math.max(0, calendarDaysDiffJst(createdAt, now, boundaryMinutes));
    const key = daysAgo >= 31 ? "31日以上前" : `${daysAgo}日前`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const buckets = [];
  for (let day = 0; day <= 30; day++) {
    const label = `${day}日前`;
    buckets.push({ label, value: counts.get(label) || 0 });
  }
  buckets.push({ label: "31日以上前", value: counts.get("31日以上前") || 0 });
  const total = createdTimes.length;
  const firstCreatedAt = total ? Math.min(...createdTimes) : null;
  const elapsedDays = firstCreatedAt === null
    ? 0
    : Math.max(1, calendarDaysDiffJst(firstCreatedAt, now, boundaryMinutes) + 1);
  return {
    buckets,
    total,
    elapsedDays,
    averagePerDay: elapsedDays ? total / elapsedDays : 0,
  };
}

function drawReviewScheduleChart(history) {
  const buckets = buildReviewScheduleBuckets(history);
  drawBarChart($("review-schedule-chart"), buckets, "#23745a");
}

function drawReviewIntervalChart(history) {
  const buckets = buildReviewIntervalBuckets(history);
  drawBarChart($("review-interval-chart"), buckets, "#386fa4");
}

function buildReviewScheduleBuckets(history) {
  const now = Date.now();
  const counts = new Map();
  const boundaryMinutes = loadReviewSettings().day_boundary_minutes;
  activeHistoryEntries(history).forEach(([, state]) => {
    if (!state?.attempts?.length || isProblemSuspended(state)) return;
    const dueAt = Number(state.dueAt || 0);
    if (!dueAt) return;
    const days = Math.max(0, calendarDaysDiffJst(now, dueAt, boundaryMinutes));
    const key = days >= 31 ? "31日以上" : `${days}日後`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const buckets = [];
  for (let day = 0; day <= 30; day++) {
    const label = `${day}日後`;
    buckets.push({ label, value: counts.get(label) || 0 });
  }
  buckets.push({ label: "31日以上", value: counts.get("31日以上") || 0 });
  return buckets;
}

function buildReviewIntervalBuckets(history) {
  const now = Date.now();
  const boundaryMinutes = loadReviewSettings().day_boundary_minutes;
  const buckets = [
    { label: "今日", min: 0, max: 0, value: 0 },
    { label: "1日", min: 1, max: 1, value: 0 },
    { label: "2-3日", min: 2, max: 3, value: 0 },
    { label: "4-7日", min: 4, max: 7, value: 0 },
    { label: "8-14日", min: 8, max: 14, value: 0 },
    { label: "15-30日", min: 15, max: 30, value: 0 },
    { label: "31日以上", min: 31, max: Infinity, value: 0 },
  ];
  activeHistoryEntries(history).forEach(([, state]) => {
    if (!state?.attempts?.length || isProblemSuspended(state)) return;
    const dueAt = Number(state.dueAt || 0);
    if (!dueAt) return;
    const days = Math.max(0, calendarDaysDiffJst(now, dueAt, boundaryMinutes));
    const bucket = buckets.find((item) => days >= item.min && days <= item.max);
    if (bucket) bucket.value++;
  });
  return buckets.map(({ label, value }) => ({ label, value }));
}

function activeHistoryEntries(history) {
  const problemIds = new Set(problems.map((problem) => problem.id));
  return Object.entries(history || {}).filter(([problemId]) => problemIds.has(problemId));
}

function calendarDaysDiffJst(fromMs, toMs, boundaryMinutes = loadReviewSettings().day_boundary_minutes) {
  const fromDate = jstDateUtcMs(fromMs, boundaryMinutes);
  const toDate = jstDateUtcMs(toMs, boundaryMinutes);
  return Math.round((toDate - fromDate) / DAY);
}

function jstDateUtcMs(ms, boundaryMinutes = loadReviewSettings().day_boundary_minutes) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Number(ms) - sanitizeDayBoundaryMinutes(boundaryMinutes) * 60 * 1000));
  const year = Number(parts.find((part) => part.type === "year")?.value || 0);
  const month = Number(parts.find((part) => part.type === "month")?.value || 1);
  const day = Number(parts.find((part) => part.type === "day")?.value || 1);
  return Date.UTC(year, month - 1, day);
}

function jstDayKey(ms, boundaryMinutes = loadReviewSettings().day_boundary_minutes) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Number(ms) - sanitizeDayBoundaryMinutes(boundaryMinutes) * 60 * 1000));
  const year = parts.find((part) => part.type === "year")?.value || "0000";
  const month = parts.find((part) => part.type === "month")?.value || "00";
  const day = parts.find((part) => part.type === "day")?.value || "00";
  return `${year}-${month}-${day}`;
}

function drawBarChart(canvas, items, barColor) {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const data = Array.isArray(items) ? items : [];
  const { width, height } = canvas;
  const left = 62;
  const right = width - 24;
  const top = 26;
  const bottom = height - 54;
  const chartWidth = right - left;
  const chartHeight = bottom - top;
  const maxValue = Math.max(1, ...data.map((item) => Number(item.value) || 0));
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fffdf8";
  context.fillRect(0, 0, width, height);
  context.font = "13px sans-serif";
  context.textAlign = "right";
  context.fillStyle = "#66716b";
  context.lineWidth = 1;
  for (let tick = 0; tick <= 4; tick++) {
    const value = maxValue * tick / 4;
    const y = bottom - value / maxValue * chartHeight;
    context.strokeStyle = "#d8d1c3";
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(right, y);
    context.stroke();
    context.fillText(formatBarValue(value), left - 8, y + 4);
  }
  context.strokeStyle = "#cfc7b8";
  context.beginPath();
  context.moveTo(left, top);
  context.lineTo(left, bottom);
  context.lineTo(right, bottom);
  context.stroke();
  if (!data.length) {
    context.fillStyle = "#7a7469";
    context.textAlign = "center";
    context.font = "600 15px sans-serif";
    context.fillText("記録がありません", (left + right) / 2, (top + bottom) / 2);
    context.textAlign = "left";
    context.fillStyle = "#66716b";
    context.fillText("件数", left, height - 14);
    return;
  }
  const gap = 8;
  const barWidth = Math.max(8, Math.min(48, (chartWidth - gap * (data.length - 1)) / data.length));
  const totalWidth = data.length * barWidth + (data.length - 1) * gap;
  const offset = left + Math.max(0, (chartWidth - totalWidth) / 2);
  data.forEach((item, index) => {
    const x = offset + index * (barWidth + gap);
    const value = Number(item.value) || 0;
    const barHeight = value / maxValue * chartHeight;
    const y = bottom - barHeight;
    context.fillStyle = barColor;
    context.fillRect(x, y, barWidth, barHeight);
    context.fillStyle = "#355348";
    context.textAlign = "center";
    context.fillText(String(value), x + barWidth / 2, y - 6);
    context.save();
    context.translate(x + barWidth / 2, bottom + 18);
    context.rotate(-Math.PI / 4);
    context.fillText(item.label, 0, 0);
    context.restore();
  });
  context.textAlign = "left";
  context.fillStyle = "#66716b";
  context.fillText("件数", left, height - 14);
}

function formatBarValue(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

async function loadProblems() {
  problems = [];
  try {
    const stored = localStorage.getItem(PROBLEMS_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      if (Array.isArray(data)) {
        problems = data;
      } else if (Array.isArray(data.problems)) {
        problems = data.problems;
      }
      const loadedIds = new Set();
      problems = problems.map((problem) => validateProblemObject(problem, loadedIds));
    }
  } catch (error) {
    console.error("Failed to load problems:", error);
    problems = [];
  }
  if (!localStorage.getItem(GENRE_ORDER_KEY)) {
    const ordered = [...problems]
      .sort((left, right) => Number(left.genre_order ?? Number.MAX_SAFE_INTEGER) - Number(right.genre_order ?? Number.MAX_SAFE_INTEGER))
      .map((problem) => problem.genre || "未分類");
    saveGenreOrder([...new Set(ordered)], false);
  }
  problems.forEach((problem) => delete problem.genre_order);
  refreshGenres();
  repairReviewHistoryDueDates();
  reconcileSuspendedProblems({ notify: true });
}

async function saveProblems({ changedIds = [], deletedIds = [] } = {}) {
  if (!Array.isArray(changedIds) || !Array.isArray(deletedIds) || (!changedIds.length && !deletedIds.length)) {
    throw new Error("saveProblemsにはchangedIdsまたはdeletedIdsの指定が必要です。");
  }
  localStorage.setItem(PROBLEMS_KEY, JSON.stringify(problems));
  changedIds.forEach((problemId) => markProblemDirty(problemId, "問題を保存"));
  deletedIds.forEach((problemId) => markProblemDirty(problemId, "問題を削除", true));
}

function restoreLocalStorageSnapshot(snapshot) {
  Object.keys(localStorage)
    .filter((key) => key.startsWith("nanikiru-"))
    .forEach((key) => localStorage.removeItem(key));
  Object.entries(snapshot || {}).forEach(([key, value]) => {
    if (typeof value === "string" && key.startsWith("nanikiru-")) {
      localStorage.setItem(key, value);
    }
  });
}

function drawLineChart(canvas, series, showInterval) {
  const context = canvas.getContext("2d");
  const { width, height } = canvas;
  const left = 62, right = width - 22, top = 28, bottom = height - 48;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fffdf8";
  context.fillRect(0, 0, width, height);
  context.font = "13px sans-serif";
  context.textAlign = "right";
  for (let percent = 0; percent <= 100; percent += 20) {
    const y = bottom - percent / 100 * (bottom - top);
    context.strokeStyle = "#d8d1c3";
    context.beginPath(); context.moveTo(left, y); context.lineTo(right, y); context.stroke();
    context.fillStyle = "#66716b"; context.fillText(`${percent}%`, left - 8, y + 4);
  }
  const maxPoints = Math.max(1, ...series.map((item) => item.points.length));
  series.forEach((item) => {
    if (!item.points.length) return;
    if (showInterval && item.points.some((point) => point.low !== undefined)) {
      context.fillStyle = "rgba(35,116,90,.14)";
      context.beginPath();
      item.points.forEach((point, index) => {
        const x = left + index / Math.max(1, maxPoints - 1) * (right - left);
        const y = bottom - point.high * (bottom - top);
        index ? context.lineTo(x, y) : context.moveTo(x, y);
      });
      [...item.points].reverse().forEach((point, reverseIndex) => {
        const index = item.points.length - 1 - reverseIndex;
        const x = left + index / Math.max(1, maxPoints - 1) * (right - left);
        context.lineTo(x, bottom - point.low * (bottom - top));
      });
      context.closePath(); context.fill();
    }
    context.strokeStyle = item.color; context.lineWidth = 3; context.beginPath();
    item.points.forEach((point, index) => {
      const x = left + index / Math.max(1, maxPoints - 1) * (right - left);
      const y = bottom - point.value * (bottom - top);
      index ? context.lineTo(x, y) : context.moveTo(x, y);
    });
    context.stroke();
  });
  const labelSource = series.find((item) => item.points.length)?.points || [];
  if (labelSource.length) {
    context.fillStyle = "#66716b";
    context.textAlign = "center";
    const labelIndexes = [...new Set([0, Math.floor((labelSource.length - 1) / 2), labelSource.length - 1])];
    labelIndexes.forEach((index) => {
      const x = left + index / Math.max(1, maxPoints - 1) * (right - left);
      context.fillText(labelSource[index].label, x, bottom + 20);
    });
  }
  context.textAlign = "left";
  series.forEach((item, index) => {
    context.fillStyle = item.color;
    context.fillRect(left + index * 170, height - 23, 16, 4);
    context.fillText(item.name, left + 22 + index * 170, height - 17);
  });
}

function bindAdmin() {
  $("problem-form").addEventListener("submit", (event) => event.preventDefault());
  $("verify-button").addEventListener("click", verifyWithWasm);
  $("save-button").addEventListener("click", saveCurrentProblem);
  $("generate-button").addEventListener("click", generateWithWasm);
  $("admin-count").addEventListener("input", saveAdminCount);
  ["manage-genre-filter", "manage-date-from", "manage-date-to", "manage-source-filter", "manage-text-filter"]
    .forEach((id) => $(id).addEventListener("input", () => { managementPage = 0; renderAdminProblems(); }));
  $("select-filtered-button").addEventListener("click", selectFilteredProblems);
  $("bulk-delete-button").addEventListener("click", bulkDeleteProblems);
  $("bulk-genre-button").addEventListener("click", bulkChangeGenre);
  ["admin-hand", "admin-melds", "admin-dora", "admin-answer"].forEach((id) =>
    $(id).addEventListener("input", () => {
      if (id === "admin-melds") pendingMeldTiles = [];
      renderAllInputPreviews();
    })
  );
  bindManagementSortControls();
  $("management-prev")?.addEventListener("click", () => { managementPage = Math.max(0, managementPage - 1); renderAdminProblems(); });
  $("management-next")?.addEventListener("click", () => { managementPage += 1; renderAdminProblems(); });
}

function bindManagementSortControls() {
  if (managementSortBound) return;
  const table = $("management-table") || document.querySelector(".management-table");
  if (!table) return;
  managementSortBound = true;
  table.addEventListener("click", (event) => {
    const button = event.target.closest(".sort-th");
    if (!button || !table.contains(button)) return;
    const key = button.dataset.sort;
    if (managementSort.key === key) {
      managementSort.direction = managementSort.direction === "asc" ? "desc" : "asc";
    } else {
      managementSort.key = key;
      managementSort.direction = key === "created_at" ? "desc" : "asc";
    }
    renderAdminProblems();
  });
}

function bindExport() {
  const dumpBtn = $("dump-button");
  const restoreInput = $("restore-file");
  const copyBtn = $("copy-base64");
  const resetAllBtn = $("reset-all-data");
  const promptDumpBtn = $("backup-prompt-download");
  const promptLaterBtn = $("backup-prompt-later");
  
  if (dumpBtn) dumpBtn.addEventListener("click", dumpProblems);
  if (restoreInput) restoreInput.addEventListener("change", restoreDump);
  if (copyBtn) copyBtn.addEventListener("click", copyBase64);
  if (resetAllBtn) resetAllBtn.addEventListener("click", resetAllData);
  [
    "review-first-correct-days",
    "review-wrong-retry-days",
    "review-wrong-then-correct-days",
    "review-repeat-multiplier",
    "review-suspension-wrong-transitions",
    "review-daily-new-problem-limit",
    "review-day-boundary-time",
    "review-mature-interval-days",
    "quiz-random-transform",
    "simulator-enable-reddora",
    "simulator-enable-uradora",
    "simulator-enable-shanten-down",
    "simulator-enable-tegawari",
    "simulator-auto-disable-deep-search",
    "simulator-enable-riichi",
    "simulator-enable-calls",
    "simulator-enable-other-win-stop",
    "simulator-tsumo-win-share-percent",
  ].forEach((id) => {
    const input = $(id);
    if (!input) return;
    input.addEventListener("input", () => {
      saveReviewSettings(readReviewSettingsForm());
    });
  });
  const hazardGrid = $("simulator-other-win-hazard-grid");
  if (hazardGrid) hazardGrid.addEventListener("input", (event) => {
    const input = event.target.closest("[data-hazard-turn]");
    if (!input) return;
    if (input.dataset.hazardTurn === "17") {
      const turn18 = hazardGrid.querySelector('[data-hazard-turn="18"]');
      if (turn18) turn18.value = input.value;
    }
    saveReviewSettings(readReviewSettingsForm());
  });
  if (promptDumpBtn) {
    promptDumpBtn.addEventListener("click", async () => {
      hideBackupPrompt();
      await dumpProblems();
    });
  }
  if (promptLaterBtn) promptLaterBtn.addEventListener("click", hideBackupPrompt);
}

function openProblemInManager(problemId) {
  selectedManagedProblemId = problemId;
  ["manage-genre-filter", "manage-date-from", "manage-date-to", "manage-source-filter", "manage-text-filter"]
    .forEach((id) => {
      const input = $(id);
      if (input) input.value = "";
    });
  showView("manage");
  previewProblem(problemId);
  const checkbox = document.querySelector(`.problem-select[value="${CSS.escape(problemId)}"]`);
  if (checkbox) checkbox.checked = true;
  requestAnimationFrame(() => {
    $("problem-preview")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function todayKeyJst() {
  return jstDayKey(Date.now());
}

function maybeShowBackupPrompt() {
  const today = todayKeyJst();
  const lastShown = localStorage.getItem(BACKUP_PROMPT_KEY);
  if (!lastShown) {
    localStorage.setItem(BACKUP_PROMPT_KEY, today);
    return;
  }
  if (lastShown === today) return;
  localStorage.setItem(BACKUP_PROMPT_KEY, today);
  const prompt = $("backup-prompt");
  if (prompt) prompt.classList.remove("hidden");
}

function hideBackupPrompt() {
  const prompt = $("backup-prompt");
  if (prompt) prompt.classList.add("hidden");
}

async function saveCurrentProblem() {
  try {
    const verification = await runWasmVerification();
    const problem = manualProblemFromForm(verification);
    await registerProblem(problem);
    setAdminMessage("問題を保存しました。", "ok");
    resetSingleUseFields();
  } catch (error) {
    setAdminMessage(error.message, "error");
  }
}

function manualProblemFromForm(verification = null) {
  const payload = adminPayload();
  const answers = parseAnswerTiles(payload.answers);
  const melds = parseMeldsClient(payload.melds);
  const handTiles = parseMpsz(payload.hand);
  const expectedTiles = 14 - melds.length * 3;
  if (!payload.genre.trim() || !payload.hand.trim() || !answers.length) {
    throw new Error("ジャンル、手牌、指定解答は必須です。");
  }
  if (handTiles.length !== expectedTiles) {
    throw new Error(`副露${melds.length}組では手牌を${expectedTiles}枚にしてください。`);
  }
  if (answers.some((answer) => !handTiles.some((tile) => samePhysicalTile(tile, answer)))) {
    throw new Error("指定解答は手牌に含まれる牌を指定してください。");
  }
  return {
    id: crypto.randomUUID(),
    genre: payload.genre.trim(),
    hand: payload.hand.replace(/\s+/g, ""),
    melds,
    melds_text: payload.melds.trim(),
    answers: [...new Set(answers)],
    primary_answer: answers[0],
    tolerance_percent: verification?.required_tolerance_percent || 0,
    note: payload.note,
    prompt_note: payload.prompt_note,
    source_id: null,
    transform: null,
    created_at: new Date().toISOString(),
    settings: {
      turn: payload.turn,
      round_wind: payload.round_wind,
      seat_wind: payload.seat_wind,
      dora_indicators: parseMpsz(payload.dora),
      objective: 2,
    },
    answer_gaps: verification?.answer_gaps || {},
    similarity_conditions: verification?.similarity_conditions || null,
    simulator: verification?.simulation || null,
    unverified: !verification,
  };
}

async function verifyWithWasm() {
  setAdminMessage("シミュレーターを実行しています。", "busy");
  try {
    const verification = await runWasmVerification();
    renderVerification(verification);
    setAdminMessage(
      verification.is_optimal
        ? "指定解答はすべて最適解です。"
        : `最適解からの最大乖離は${formatPercent(verification.required_tolerance_percent)}%です。`,
      "ok"
    );
    return verification;
  } catch (error) {
    setAdminMessage(error.message, "error");
    throw error;
  }
}

async function runWasmVerification() {
  const payload = adminPayload();
  const hand = parseMpsz(payload.hand);
  const melds = parseMeldsClient(payload.melds);
  const expected = 14 - melds.length * 3;
  if (hand.length !== expected) throw new Error(`手牌は${expected}枚必要です。`);
  validateCombinedTileCounts(hand, melds);
  const answers = parseAnswerTiles(payload.answers);
  if (!answers.length) throw new Error("指定解答を入力してください。");
  if (answers.some((answer) => !hand.some((tile) => samePhysicalTile(tile, answer)))) {
    throw new Error("指定解答は手牌に含まれる牌を指定してください。");
  }
  const simulation = await analyzeWithWasm(payload.hand, melds, payload);
  const answerGaps = calculateAnswerGaps(simulation, answers);
  const required = Math.max(...Object.values(answerGaps));
  const answerConditions = calculateAnswerConditions(simulation, answers);
  const similarityConditions = {
    tolerance_percent: required,
    max_rank: answerConditions.max_rank,
    next_worse_rank: answerConditions.max_rank + 1,
    next_worse_gap_percent: answerConditions.next_worse_gap_percent,
  };
  return {
    hand: tilesToMpszClient(hand),
    answers,
    answer: answers[0],
    blocks: describeBlocksClient(hand),
    melds,
    melds_text: melds.map((meld) => meld.mpsz).join(" "),
    is_optimal: required <= 1e-9,
    is_accepted: true,
    answer_gaps: answerGaps,
    required_tolerance_percent: required,
    allowed_tolerance_percent: required,
    similarity_conditions: similarityConditions,
    simulation,
  };
}

async function analyzeWithWasm(handText, melds, payload) {
  const settings = loadReviewSettings();
  const requestedFlags = {
    enable_shanten_down: settings.simulator_enable_shanten_down,
    enable_tegawari: settings.simulator_enable_tegawari,
  };
  const requestKey = buildWasmRequestKey(handText, melds, payload, settings);
  const mode = wasmModeForRequest(requestKey, requestedFlags);
  const raw = await wasmAnalyze(buildSimulatorEnginePayload(handText, melds, payload, settings, mode, requestKey));
  if (!raw?.success) throw new Error(raw?.err_msg || "シミュレーターが失敗を返しました。");
  if (raw.engine_version !== "0.9.13" || raw.api_version !== 1) {
    throw new Error(`シミュレーターの版が一致しません: ${raw.engine_version || "不明"}/API ${raw.api_version ?? "不明"}`);
  }
  const simulation = summarizeWasmResult(raw, payload.turn);
  simulation.settings_signature = simulatorSettingsSignature(settings);
  return simulation;
}

function simulatorSettingsSignature(settings = loadReviewSettings()) {
  return JSON.stringify({
    enable_reddora: settings.simulator_enable_reddora,
    enable_uradora: settings.simulator_enable_uradora,
    enable_shanten_down: settings.simulator_enable_shanten_down,
    enable_tegawari: settings.simulator_enable_tegawari,
    auto_disable_deep_search: settings.simulator_auto_disable_deep_search,
    enable_riichi: settings.simulator_enable_riichi,
    enable_calls: settings.simulator_enable_calls,
    enable_other_win_stop: settings.simulator_enable_other_win_stop,
    tsumo_win_share_percent: settings.simulator_tsumo_win_share_percent,
    other_win_hazard_percent: settings.simulator_other_win_hazard_percent,
  });
}

function simulatorStatsNeedRefresh(simulation, settings = loadReviewSettings()) {
  if (!simulation?.rows?.length) return true;
  if (simulation.settings_signature !== simulatorSettingsSignature(settings)) return true;
  return simulation.rows.some((row) => !Array.isArray(row.yaku_contributions));
}

async function refreshQuizSimulatorStats(presentedProblem, answers, selectedTile) {
  if (!simulatorStatsNeedRefresh(presentedProblem?.simulator)) return;
  const container = $("quiz-simulator-result");
  if (!container) return;
  const problemId = presentedProblem.id;
  const notice = document.createElement("p");
  notice.className = "sim-refresh-status busy";
  notice.textContent = "現在の設定で役別Shapley・副露結果を計算しています。";
  container.prepend(notice);
  try {
    const simulation = await analyzeWithWasm(
      presentedProblem.hand,
      presentedProblem.melds || [],
      problemPayload(presentedProblem)
    );
    presentedProblem.simulator = simulation;
    if (!presentedProblem.quiz_transform) {
      const storedProblem = problems.find((problem) => problem.id === problemId);
      if (storedProblem) {
        storedProblem.simulator = simulation;
        await saveProblems({ changedIds: [problemId] });
      }
    }
    if (currentProblem?.id === problemId && currentPresentedProblem === presentedProblem) {
      renderSimulatorTable(container, simulation, answers, selectedTile);
    }
  } catch (error) {
    notice.className = "sim-refresh-status error";
    notice.textContent = `役別Shapley・副露結果を更新できませんでした: ${error.message || error}`;
  }
}

function buildSimulatorEnginePayload(handText, melds, payload, settings, mode, requestKey) {
  return {
    __wasmRequestKey: requestKey,
    round_wind: tileIndex(payload.round_wind),
    seat_wind: tileIndex(payload.seat_wind),
    dora_indicators: parseMpsz(payload.dora).map(tileIndex),
    hand: parseMpsz(handText).map(tileIndex),
    melds: melds.map((meld) => ({
      type: meld.type,
      tiles: meld.tiles.map(tileIndex),
    })),
    game_mode: 1,
    enable_reddora: settings.simulator_enable_reddora,
    enable_uradora: settings.simulator_enable_uradora,
    enable_shanten_down: mode.flags.enable_shanten_down,
    enable_tegawari: mode.flags.enable_tegawari,
    auto_disable_deep_search: settings.simulator_auto_disable_deep_search,
    enable_riichi: settings.simulator_enable_riichi,
    enable_calls: settings.simulator_enable_calls,
    enable_other_win_stop: settings.simulator_enable_other_win_stop,
    other_win_hazard: settings.simulator_other_win_hazard_percent.map((value) => value / 100),
    enable_turn_yaku: true,
    calc_stats: true,
    calc_yaku_stats: true,
    calc_shapley_stats: true,
    ron_rate: 1 - settings.simulator_tsumo_win_share_percent / 100,
    remaining_tiles: Math.min(70, Math.max(0, (18 - Math.min(18, Math.max(1, Number(payload.turn) || 1))) * 4)),
    version: "0.9.13",
  };
}

function calculateAnswerGaps(simulation, answers) {
  const best = simulation.rows[0]?.metric || 0;
  const answerGaps = {};
  answers.forEach((answer) => {
    const matchingRows = simulation.rows.filter((row) => samePhysicalTile(row.tile, answer));
    if (!matchingRows.length) throw new Error(`打牌候補にありません: ${answer}`);
    const answerMetric = Math.max(...matchingRows.map((row) => row.metric));
    answerGaps[answer] = Math.max(0, (best - answerMetric) / Math.max(Math.abs(best), 1e-12) * 100);
  });
  return answerGaps;
}

function rankedDiscardRows(simulation) {
  const byTile = new Map();
  (simulation?.rows || []).forEach((row) => {
    const tile = normalizePhysicalTile(row.tile);
    const current = byTile.get(tile);
    if (!current || Number(row.metric) > Number(current.metric)) byTile.set(tile, { ...row, tile });
  });
  const rows = [...byTile.values()].sort((left, right) => Number(right.metric) - Number(left.metric));
  let rank = 0;
  let previousMetric = null;
  return rows.map((row, index) => {
    const metric = Number(row.metric);
    const tied = previousMetric !== null
      && Math.abs(metric - previousMetric) <= Math.max(1e-9, Math.abs(previousMetric) * 1e-10);
    if (!tied) rank += 1;
    previousMetric = metric;
    return { ...row, rank, position: index + 1 };
  });
}

function calculateAnswerConditions(simulation, answers, boundaryRank = null) {
  const ranked = rankedDiscardRows(simulation);
  const answerRows = answers.map((answer) => {
    const row = ranked.find((item) => samePhysicalTile(item.tile, answer));
    if (!row) throw new Error(`打牌候補にありません: ${answer}`);
    return row;
  });
  const maxRank = Math.max(...answerRows.map((row) => row.rank));
  const comparisonRank = boundaryRank || maxRank + 1;
  // 解答順位は同率を同じ順位として扱う一方、乖離の比較先は
  // 「上から何番目の打牌か」で固定する。同率の打牌を飛ばしてはならない。
  const boundary = ranked.find((row) => row.position === comparisonRank) || null;
  const worstAnswerMetric = Math.min(...answerRows.map((row) => Number(row.metric)));
  const nextWorseGap = boundary
    ? Math.max(0, (worstAnswerMetric - Number(boundary.metric)) / Math.max(Math.abs(worstAnswerMetric), 1e-12) * 100)
    : null;
  return {
    max_rank: maxRank,
    comparison_rank: comparisonRank,
    next_worse_gap_percent: nextWorseGap,
    boundary_tile: boundary?.tile || null,
  };
}

function evaluateSimilarProblem(simulation, answers, sourceConditions) {
  const answerGaps = calculateAnswerGaps(simulation, answers);
  const maxGap = Math.max(...Object.values(answerGaps));
  const conditions = calculateAnswerConditions(simulation, answers, sourceConditions.next_worse_rank);
  const toleranceAccepted = maxGap <= sourceConditions.tolerance_percent + 1e-9;
  const rankAccepted = conditions.max_rank <= sourceConditions.max_rank;
  const separationAccepted = sourceConditions.next_worse_gap_percent == null
    || conditions.next_worse_gap_percent == null
    || conditions.next_worse_gap_percent + 1e-9 >= sourceConditions.next_worse_gap_percent;
  return {
    accepted: toleranceAccepted && rankAccepted && separationAccepted,
    answer_gaps: answerGaps,
    max_gap_percent: maxGap,
    conditions,
    tolerance_accepted: toleranceAccepted,
    rank_accepted: rankAccepted,
    separation_accepted: separationAccepted,
  };
}

function buildWasmRequestKey(handText, melds, payload, settings = loadReviewSettings()) {
  return JSON.stringify({
    hand: String(handText || ""),
    melds: (melds || []).map((meld) => meld.mpsz || tilesToMpszClient(meld.tiles || [])).join(" "),
    turn: Number(payload?.turn || 0),
    round_wind: payload?.round_wind || "",
    seat_wind: payload?.seat_wind || "",
    dora: String(payload?.dora || ""),
    objective: Number(payload?.objective || 2),
    simulator: {
      enable_reddora: settings.simulator_enable_reddora,
      enable_uradora: settings.simulator_enable_uradora,
      enable_shanten_down: settings.simulator_enable_shanten_down,
      enable_tegawari: settings.simulator_enable_tegawari,
      auto_disable_deep_search: settings.simulator_auto_disable_deep_search,
      enable_riichi: settings.simulator_enable_riichi,
      enable_calls: settings.simulator_enable_calls,
      enable_other_win_stop: settings.simulator_enable_other_win_stop,
      tsumo_win_share_percent: settings.simulator_tsumo_win_share_percent,
      other_win_hazard_percent: settings.simulator_other_win_hazard_percent,
    },
  });
}

function wasmModeForRequest(requestKey, requestedFlags = WASM_DEFAULT_FLAGS) {
  if (wasmActiveRequestKey !== requestKey) {
    wasmActiveRequestKey = requestKey;
    wasmActiveRequestMode = {
      degraded: false,
      fallbackReason: "",
      requestedFlags: { ...requestedFlags },
      flags: { ...requestedFlags },
    };
  }
  return wasmActiveRequestMode;
}

function createWasmWorker() {
  const generation = ++wasmWorkerGeneration;
  wasmWorker = new Worker(`wasm/worker.js?v=${WASM_ASSET_VERSION}`, { type: "module" });
  wasmWorkerUseCount = 0;
  wasmWorker.onmessage = (event) => {
    if (generation !== wasmWorkerGeneration) return;
    const pending = wasmRequests.get(event.data.id);
    if (!pending) return;
    wasmRequests.delete(event.data.id);
    clearTimeout(pending.timer);
    wasmWorkerUseCount++;
    event.data.error ? pending.reject(new Error(event.data.error)) : pending.resolve(event.data.result);
  };
  wasmWorker.onerror = (event) => {
    if (generation !== wasmWorkerGeneration) return;
    const error = new Error(event.message || "シミュレーターが停止しました。");
    resetWasmWorker(error);
  };
  wasmWorker.onmessageerror = () => {
    if (generation !== wasmWorkerGeneration) return;
    resetWasmWorker(new Error("シミュレーターとの通信に失敗しました。"));
  };
  return wasmWorker;
}

function resetWasmWorker(error = null) {
  const worker = wasmWorker;
  wasmWorker = null;
  wasmWorkerUseCount = 0;
  wasmWorkerGeneration++;
  if (worker) worker.terminate();
  if (error) {
    wasmRequests.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(error);
    });
    wasmRequests.clear();
  }
}

function isRecoverableWasmError(error) {
  return /memory access out of bounds|out of memory|RuntimeError|Aborted|Maximum call stack size exceeded|シミュレーターが停止|通信に失敗/i
    .test(error?.message || "");
}

function wasmFallbackCandidates(requestedFlags) {
  const shantenDown = Boolean(requestedFlags.enable_shanten_down);
  const tegawari = Boolean(requestedFlags.enable_tegawari);
  if (shantenDown && tegawari) {
    return [
      { enable_shanten_down: true, enable_tegawari: false },
      { enable_shanten_down: false, enable_tegawari: true },
      { enable_shanten_down: false, enable_tegawari: false },
    ];
  }
  return shantenDown || tegawari
    ? [{ enable_shanten_down: false, enable_tegawari: false }]
    : [];
}

function sameWasmFlags(left, right) {
  return Boolean(left?.enable_shanten_down) === Boolean(right?.enable_shanten_down)
    && Boolean(left?.enable_tegawari) === Boolean(right?.enable_tegawari);
}

function nextWasmFallbackFlags(mode) {
  const candidates = wasmFallbackCandidates(mode.requestedFlags);
  const currentIndex = candidates.findIndex((candidate) => sameWasmFlags(candidate, mode.flags));
  return candidates[currentIndex + 1] || null;
}

function sendWasmRequest(requestPayload) {
  return new Promise((resolve, reject) => {
    const id = ++wasmRequestId;
    const timer = setTimeout(() => {
      wasmRequests.delete(id);
      resetWasmWorker();
      reject(new Error("シミュレーターの計算が時間内に完了しませんでした。"));
    }, WASM_REQUEST_TIMEOUT);
    wasmRequests.set(id, { resolve, reject, timer });
    wasmWorker.postMessage({ id, payload: requestPayload });
  });
}

async function runWasmRequest(payload) {
  if (!wasmWorker || wasmWorkerUseCount >= WASM_RECYCLE_AFTER) {
    resetWasmWorker();
    createWasmWorker();
  }
  const requestKey = payload.__wasmRequestKey || null;
  const requestedFlags = {
    enable_shanten_down: payload.enable_shanten_down ?? WASM_DEFAULT_FLAGS.enable_shanten_down,
    enable_tegawari: payload.enable_tegawari ?? WASM_DEFAULT_FLAGS.enable_tegawari,
  };
  const mode = requestKey
    ? wasmModeForRequest(requestKey, requestedFlags)
    : { degraded: false, fallbackReason: "", requestedFlags, flags: { ...requestedFlags } };
  if (!requestKey) {
    wasmActiveRequestMode = mode;
  }
  const { __wasmRequestKey: _requestKey, ...enginePayload } = payload;
  for (;;) {
    const requestPayload = {
      ...enginePayload,
      enable_shanten_down: mode.flags.enable_shanten_down,
      enable_tegawari: mode.flags.enable_tegawari,
    };
    try {
      return await sendWasmRequest(requestPayload);
    } catch (error) {
      const nextFlags = isRecoverableWasmError(error) ? nextWasmFallbackFlags(mode) : null;
      if (!nextFlags) throw error;
      mode.degraded = true;
      mode.fallbackReason = error?.message || String(error);
      mode.flags = nextFlags;
      wasmActiveRequestMode = mode;
      resetWasmWorker();
      createWasmWorker();
    }
  }
}

function wasmAnalyze(payload) {
  const queued = wasmQueue.then(() => runWasmRequest(payload));
  wasmQueue = queued.catch(() => {});
  return queued;
}

function summarizeWasmResult(raw, turn) {
  lastWasmMode = wasmActiveRequestMode || {
    degraded: false,
    fallbackReason: "",
    requestedFlags: { ...WASM_DEFAULT_FLAGS },
    flags: { ...WASM_DEFAULT_FLAGS },
  };
  const code = (index) => {
    if (index < 9) return `${index + 1}m`;
    if (index < 18) return `${index - 8}p`;
    if (index < 27) return `${index - 17}s`;
    if (index < 34) return `${index - 26}z`;
    return `0${"mps"[index - 34]}`;
  };
  const at = (values) => {
    if (!Array.isArray(values) || !values.length) return 0;
    return Number(values[Math.min(Math.max(1, turn), values.length - 1)] || 0);
  };
  const rows = (raw.stats || []).filter((stat) => stat.tile >= 0).map((stat) => {
    const callProbability = at(stat.call_prob);
    const yakuContributions = (stat.yaku_stats || []).map((entry) => {
      const name = yakuName(entry.yaku);
      return {
        yaku: Number(entry.yaku),
        name,
        short_name: yakuShortName(entry.yaku, name),
        occurrence: at(entry.occurrence_prob),
        shapley: at(entry.shapley_score),
      };
    }).filter((entry) => entry.occurrence > 1e-12 || Math.abs(entry.shapley) > 1e-9)
      .sort((a, b) => b.shapley - a.shapley);
    const calledYakuContributions = callProbability > 1e-12
      ? (stat.yaku_stats || []).map((entry) => {
        const name = yakuName(entry.yaku);
        return {
          yaku: Number(entry.yaku),
          name,
          short_name: yakuShortName(entry.yaku, name),
          occurrence: at(entry.called_occurrence_prob) / callProbability,
          shapley: at(entry.called_shapley_score) / callProbability,
        };
      }).filter((entry) => entry.occurrence > 1e-12 || Math.abs(entry.shapley) > 1e-9)
        .sort((a, b) => b.shapley - a.shapley)
      : [];
    const callTileRates = callProbability > 1e-12
      ? (stat.call_tile_stats || []).map((entry) => ({
        tile: code(entry.tile),
        probability: at(entry.probability),
        conditional_probability: at(entry.probability) / callProbability,
      })).filter((entry) => entry.probability > 1e-12)
        .sort((a, b) => b.probability - a.probability)
      : [];
    const expectedScore = at(stat.exp_score);
    const shapleyTotal = yakuContributions.reduce((sum, entry) => sum + entry.shapley, 0);
    return {
      tile: code(stat.tile),
      metric: expectedScore,
      expected_score: expectedScore,
      win_probability: at(stat.win_prob),
      tenpai_probability: at(stat.tenpai_prob),
      call_probability: callProbability,
      call_win_probability: at(stat.call_win_prob),
      call_tile_rates: callTileRates,
      yaku_contributions: yakuContributions,
      called_yaku_contributions: calledYakuContributions,
      yaku_chart_contributions: aggregateYakuContributions(yakuContributions),
      shapley_total: shapleyTotal,
      shapley_residual: expectedScore - shapleyTotal,
      ukeire: (stat.necessary_tiles || []).reduce((sum, item) => sum + item.count, 0),
      necessary_tiles: (stat.necessary_tiles || []).map((item) => ({ tile: code(item.tile), count: item.count })),
      shanten: stat.shanten,
    };
  }).sort((a, b) => b.metric - a.metric);
  const best = rows[0]?.metric || 0;
  return {
    version: raw.engine_version,
    turn,
    objective: 2,
    shanten: raw.shanten,
    best_discards: rows.filter((row) => Math.abs(row.metric - best) <= Math.max(1e-9, Math.abs(best) * 1e-10)).map((row) => row.tile),
    rows,
    searched: raw.searched,
    time: raw.time,
    solver_mode: lastWasmMode,
  };
}

function wasmFallbackWarning(mode) {
  if (!mode?.degraded) return "";
  const disabled = [];
  if (mode.requestedFlags?.enable_shanten_down && !mode.flags?.enable_shanten_down) disabled.push("シャンテン戻し");
  if (mode.requestedFlags?.enable_tegawari && !mode.flags?.enable_tegawari) disabled.push("手替わり");
  const detail = disabled.length ? `${disabled.join("・")}だけを無効化` : "軽量化";
  return `ブラウザ版の計算停止を避けるため、${detail}して計算しています。`;
}

function yakuBitIndex(value) {
  const numeric = Number(value);
  const index = Math.log2(numeric);
  return Number.isInteger(index) ? index : -1;
}

function yakuName(value) {
  const index = yakuBitIndex(value);
  return YAKU_NAMES[index] || `役 ${Number(value)}`;
}

function yakuShortName(value, name = yakuName(value)) {
  const index = yakuBitIndex(value);
  return YAKU_SHORT_NAMES[index] || Array.from(String(name || "役")).slice(0, 2).join("");
}

function aggregateYakuContributions(entries, limit = 5) {
  const ranked = (entries || []).filter((entry) => Number(entry.shapley) > 1e-9)
    .slice().sort((a, b) => Number(b.shapley) - Number(a.shapley));
  const visible = ranked.slice(0, limit);
  const hidden = ranked.slice(limit);
  if (!hidden.length) return visible;
  return [...visible, {
    yaku: null,
    name: "その他",
    short_name: "他",
    shapley: hidden.reduce((sum, entry) => sum + Number(entry.shapley || 0), 0),
    count: hidden.length,
  }];
}

function tileIndex(tile) {
  if (tile[0] === "0") return ({ m: 34, p: 35, s: 36 })[tile[1]];
  const rank = Number(tile[0]) - 1;
  return ({ m: 0, p: 9, s: 18, z: 27 })[tile[1]] + rank;
}

function adminPayload() {
  return {
    hand: $("admin-hand").value,
    melds: $("admin-melds").value,
    answers: $("admin-answer").value,
    genre: $("admin-genre").value,
    turn: Number($("admin-turn").value),
    round_wind: $("admin-round-wind").value,
    seat_wind: $("admin-seat-wind").value,
    dora: $("admin-dora").value,
    count: Number($("admin-count").value),
    note: $("admin-note").value,
    prompt_note: $("admin-prompt-note").value,
    objective: 2,
  };
}

async function registerProblem(problem) {
  const key = canonicalProblemKey(problem);
  if (problems.some((item) => item.id !== problem.id && canonicalProblemKey(item) === key)) {
    throw new Error("同じ手牌と副露の問題はすでに登録されています。");
  }
  await registerProblems([problem]);
  return problem;
}

async function registerProblems(records) {
  const existing = new Set(problems.map(canonicalProblemKey));
  const changedIds = [];
  records.forEach((record) => {
    const key = canonicalProblemKey(record);
    if (!existing.has(key)) {
      problems.push(record);
      existing.add(key);
      changedIds.push(record.id);
    }
  });
  if (changedIds.length) await saveProblems({ changedIds });
  if (currentView === "manage") renderAdminProblems();
  refreshGenres();
}

async function generateWithWasm() {
  setAdminMessage("シミュレーターで類題候補を検証しています。", "busy");
  try {
    const sourceVerification = await runWasmVerification();
    const payload = adminPayload();
    const sourceConditions = sourceVerification.similarity_conditions;
    const sourceKey = canonicalProblemKey({
      hand: sourceVerification.hand,
      melds_text: sourceVerification.melds_text,
    });
    let sourceProblem = problems.find((problem) => canonicalProblemKey(problem) === sourceKey);
    const pending = [];
    if (!sourceProblem) {
      sourceProblem = manualProblemFromForm(sourceVerification);
      pending.push(sourceProblem);
    }
    const requested = Math.max(1, Math.min(100, payload.count || DEFAULT_ADMIN_COUNT));
    const specs = enumerateTransformSpecs(sourceVerification.hand, transformAuxiliaryTiles(payload));
    shuffleArray(specs);
    const seen = new Set(problems.map(canonicalProblemKey));
    seen.add(sourceKey);
    const candidates = [];
    let skippedDuplicates = 0;
    for (const spec of specs) {
      try {
        const transformed = transformProblem(
          sourceVerification.hand,
          sourceVerification.answers,
          sourceVerification.melds,
          spec,
          {
            dora: payload.dora,
            note: payload.note,
            prompt_note: payload.prompt_note,
          }
        );
        const key = canonicalProblemKey(transformed);
        if (seen.has(key)) {
          skippedDuplicates++;
          continue;
        }
        validateCombinedTileCounts(parseMpsz(transformed.hand), transformed.melds);
        seen.add(key);
        candidates.push({ ...transformed, spec });
      } catch {}
    }
    const qualified = [];
    let fallbackUsed = Boolean(sourceVerification.simulation?.solver_mode?.degraded);
    for (let index = 0; index < candidates.length; index++) {
      setAdminMessage(
        `シミュレーターで類題候補を検証しています（${index + 1}/${candidates.length}）`,
        "busy"
      );
      const candidate = candidates[index];
      try {
        const simulation = await analyzeWithWasm(
          candidate.hand,
          candidate.melds,
          { ...payload, dora: candidate.dora }
        );
        if (simulation?.solver_mode?.degraded) fallbackUsed = true;
        const evaluation = evaluateSimilarProblem(simulation, candidate.answers, sourceConditions);
        if (!evaluation.accepted) continue;
        qualified.push({
          id: crypto.randomUUID(),
          hand: candidate.hand,
          answers: candidate.answers,
          primary_answer: candidate.answers[0],
          tolerance_percent: sourceConditions.tolerance_percent,
          answer_gaps: evaluation.answer_gaps,
          similarity_conditions: {
            ...sourceConditions,
            actual_max_rank: evaluation.conditions.max_rank,
            actual_next_worse_gap_percent: evaluation.conditions.next_worse_gap_percent,
          },
          melds: candidate.melds,
          melds_text: candidate.melds.map((meld) => meld.mpsz).join(" "),
          genre: payload.genre.trim() || "未分類",
          note: candidate.note.trim(),
          prompt_note: candidate.prompt_note.trim(),
          source_id: sourceProblem.id,
          transform: candidate.spec,
          created_at: new Date().toISOString(),
          settings: {
            turn: payload.turn,
            round_wind: payload.round_wind,
            seat_wind: payload.seat_wind,
            dora_indicators: parseMpsz(candidate.dora),
            objective: 2,
          },
          simulator: simulation,
        });
        if (qualified.length >= requested) break;
      } catch {}
    }
    shuffleArray(qualified);
    const accepted = qualified.slice(0, requested);
    pending.push(...accepted);
    await registerProblems(pending);
    const degrees = degreeCounts(accepted.map((problem) => problem.transform));
    const degreeText = Object.entries(degrees)
      .map(([degree, count]) => `加工度${degree}:${count}`)
      .join(" / ");
    setAdminMessage(
      `${candidates.length}候補を検証し、条件を満たした${qualified.length}問からランダムに${accepted.length}問を登録しました。元問題も登録済みです。許容乖離率${formatPercent(sourceConditions.tolerance_percent)}%以下・${sourceConditions.max_rank}位以内・${sourceConditions.next_worse_rank}位との乖離${formatOptionalPercent(sourceConditions.next_worse_gap_percent)}。${degreeText}。重複除外: ${skippedDuplicates}問。${fallbackUsed ? "一部の候補はWeb版の軽量モードで検証しました。" : ""}`,
      "ok"
    );
    renderVerification(sourceVerification);
    renderGeneratedResults(accepted);
    resetSingleUseFields();
  } catch (error) {
    setAdminMessage(error.message, "error");
  }
}

function renderVerification(data) {
  const gaps = Object.entries(data.answer_gaps || {})
    .map(([tile, gap]) => `${tile}: ${formatPercent(gap)}%`)
    .join(" / ");
  const conditions = data.similarity_conditions || {};
  $("verification-result").innerHTML = `
    <h3>${data.is_optimal ? "指定解答は最適解" : "指定解答の乖離を確認"}</h3>
    <p>ブロック: ${(data.blocks || []).map(escapeHtml).join(" / ")}</p>
    <p>副露: ${data.melds_text ? escapeHtml(data.melds_text) : "なし"}</p>
    <p>最適打: ${(data.simulation?.best_discards || []).join("・")}</p>
    <p>指定解答の乖離率: ${escapeHtml(gaps)}</p>
    <p><b>類題の採用条件</b>: 許容乖離率 ${formatPercent(conditions.tolerance_percent || 0)}%以下 / ${Number(conditions.max_rank || 1)}位以内 / ${Number(conditions.next_worse_rank || 2)}位との乖離 ${formatOptionalPercent(conditions.next_worse_gap_percent)}</p>
    <div id="admin-simulator-table"></div>
  `;
  renderSimulatorTable(
    $("admin-simulator-table"),
    data.simulation,
    data.answers || [],
    null
  );
}

function renderGeneratedResults(items) {
  const target = $("generated-results");
  if (!items.length) {
    target.classList.add("hidden");
    target.innerHTML = "";
    return;
  }
  target.classList.remove("hidden");
  target.innerHTML = `<h3>今回登録した類題</h3>${items.map((problem, index) => {
    const rows = problem.simulator?.rows || [];
    const best = rows[0];
    const answers = problem.answers || [];
    const answerSummary = answers.map((answer) => {
      const row = rows
        .filter((item) => samePhysicalTile(item.tile, answer))
        .sort((a, b) => b.metric - a.metric)[0];
      const gap = Number(problem.answer_gaps?.[answer] || 0);
      return `${answer}: 期待値 ${formatNumber(row?.expected_score)} / 乖離 ${formatPercent(gap)}%`;
    }).join("<br>");
    const conditions = problem.similarity_conditions || {};
    return `<details class="generated-result">
      <summary><span class="generated-summary">
        <span class="generated-hand">${parseMpsz(problem.hand).map(tileImage).join("")}${renderMelds(problem.melds || [])}</span>
        <span class="generated-metrics">
          <b>解答 ${answers.map(escapeHtml).join("・")}</b><br>
          1位 ${escapeHtml(best?.tile || "-")}: 期待値 ${formatNumber(best?.expected_score)}<br>
          ${answerSummary}<br>
          実順位 ${Number(conditions.actual_max_rank || 1)}位 / ${Number(conditions.next_worse_rank || 2)}位との乖離 ${formatOptionalPercent(conditions.actual_next_worse_gap_percent)}
        </span>
      </span></summary>
      <div id="generated-simulator-${index}"></div>
    </details>`;
  }).join("")}`;
  items.forEach((problem, index) =>
    renderSimulatorTable($(`generated-simulator-${index}`), problem.simulator, problem.answers || [], null)
  );
}

function resetSingleUseFields() {
  $("admin-note").value = "";
  $("admin-prompt-note").value = "";
}

function genreOrderFor(genre) {
  const index = genresInRegistrationOrder().indexOf(String(genre || "").trim());
  return index >= 0 ? index : genresInRegistrationOrder().length;
}

function renderAdminProblems() {
  const history = loadHistory();
  const suspensionThreshold = loadReviewSettings().suspension_wrong_transitions;
  const problemById = new Map(problems.map((problem) => [problem.id, problem]));
  const problemCount = $("create-problem-count");
  if (problemCount) problemCount.textContent = `${problems.length}問`;
  const manageProblemCount = $("manage-problem-count");
  if (manageProblemCount) manageProblemCount.textContent = `${problems.length}問`;
  const genres = genresInRegistrationOrder();
  const genreFilter = $("manage-genre-filter");
  if (!genreFilter) return;
  const previousGenre = genreFilter.value;
  genreFilter.innerHTML = [
    `<option value="">すべてのジャンル</option>`,
    ...genres.map((genre) => `<option value="${escapeHtml(genre)}">${escapeHtml(genre)}</option>`),
  ].join("");
  if ([...genreFilter.options].some((option) => option.value === previousGenre)) {
    genreFilter.value = previousGenre;
  }
  const sourceFilter = $("manage-source-filter");
  const previousSource = sourceFilter.value;
  const sources = problems.filter((problem) => !problem.source_id);
  sourceFilter.innerHTML = `<option value="">すべて</option><option value="original">元問題のみ</option>` +
    sources.map((problem) => `<option value="${problem.id}">${escapeHtml(problem.hand)}</option>`).join("");
  if ([...sourceFilter.options].some((option) => option.value === previousSource)) sourceFilter.value = previousSource;
  const text = $("manage-text-filter").value.trim().toLowerCase();
  const dateFrom = $("manage-date-from").value;
  const dateTo = $("manage-date-to").value;
  const managementRows = $("management-rows");
  if (!managementRows) return;
  filteredManagementProblems = sortManagementProblems(problems.filter((problem) => {
    if (genreFilter.value && (problem.genre || "未分類") !== genreFilter.value) return false;
    const createdDate = String(problem.created_at || "").slice(0, 10);
    if ((dateFrom || dateTo) && !createdDate) return false;
    if (dateFrom && createdDate < dateFrom) return false;
    if (dateTo && createdDate > dateTo) return false;
    if (sourceFilter.value === "original" && problem.source_id) return false;
    if (sourceFilter.value && sourceFilter.value !== "original" && problem.source_id !== sourceFilter.value) return false;
    const haystack = `${problem.hand} ${(problem.answers || []).join(" ")} ${problem.genre} ${problem.note || ""} ${problem.prompt_note || ""}`.toLowerCase();
    return !text || haystack.includes(text);
  }), history, problemById);
  const pageCount = Math.max(1, Math.ceil(filteredManagementProblems.length / MANAGEMENT_PAGE_SIZE));
  managementPage = Math.min(managementPage, pageCount - 1);
  const visibleProblems = filteredManagementProblems.slice(managementPage * MANAGEMENT_PAGE_SIZE, (managementPage + 1) * MANAGEMENT_PAGE_SIZE);
  managementRows.innerHTML = visibleProblems.map((problem) => {
    const source = problemById.get(problem.source_id);
    const selected = problem.id === selectedManagedProblemId;
    const state = history[problem.id];
    const transitionCount = wrongTransitionCount(state);
    const suspended = isProblemSuspended(state);
    return `<tr data-id="${problem.id}" class="${selected ? "selected-problem-row" : ""}">
      <td><input class="problem-select" type="checkbox" value="${problem.id}" ${selectedManagementIds.has(problem.id) ? "checked" : ""}></td>
      <td><button class="problem-link" type="button" data-id="${problem.id}">${escapeHtml(problem.hand)}</button></td>
      <td>${escapeHtml(problem.genre || "未分類")}</td>
      <td>${formatDate(problem.created_at)}</td>
      <td>${formatDate(lastAttemptAt(state))}</td>
      <td>${formatDate(state?.dueAt)}</td>
      <td class="problem-status-cell">${suspended
        ? `<strong class="suspended-label">休止（${transitionCount}回）</strong><button type="button" class="resume-problem" data-id="${problem.id}">休止解除</button>`
        : `<span>${transitionCount}/${suspensionThreshold}</span>`}</td>
      <td>${source ? escapeHtml(source.hand) : "元問題"}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="8">登録済みの問題がありません。</td></tr>`;
  document.querySelectorAll(".problem-select").forEach((input) => input.addEventListener("change", () => {
    if (input.checked) selectedManagementIds.add(input.value); else selectedManagementIds.delete(input.value);
  }));
  document.querySelectorAll(".problem-link").forEach((button) =>
    button.addEventListener("click", () => {
      selectedManagedProblemId = button.dataset.id;
      renderAdminProblems();
      previewProblem(button.dataset.id);
    })
  );
  document.querySelectorAll(".resume-problem").forEach((button) =>
    button.addEventListener("click", () => resumeProblem(button.dataset.id))
  );
  document.querySelectorAll(".sort-th").forEach((button) => {
    const active = managementSort.key === button.dataset.sort;
    button.classList.toggle("active", active);
    button.dataset.direction = active ? managementSort.direction : "";
    button.setAttribute("aria-sort", active ? (managementSort.direction === "asc" ? "ascending" : "descending") : "none");
  });
  const pagination = $("management-pagination");
  pagination?.classList.toggle("hidden", filteredManagementProblems.length <= MANAGEMENT_PAGE_SIZE);
  if ($("management-page-info")) $("management-page-info").textContent = `${managementPage + 1} / ${pageCount}ページ（${filteredManagementProblems.length}問）`;
  if ($("management-prev")) $("management-prev").disabled = managementPage === 0;
  if ($("management-next")) $("management-next").disabled = managementPage >= pageCount - 1;
  renderGenreOrderEditor();
}

function resumeProblem(problemId) {
  const history = loadHistory();
  const state = history[problemId];
  if (!isProblemSuspended(state)) return;
  state.suspended = false;
  state.wrongTransitionCount = 0;
  delete state.suspendedAt;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  markProgressDirty(problemId, "問題の休止を解除");
  const message = $("manage-message");
  if (message) {
    message.className = "message ok";
    message.textContent = "休止を解除しました。誤答カウントは0回に戻りました。";
  }
  renderAdminProblems();
  refreshGenres();
}

function setAdminMessage(text, type) {
  $("admin-message").className = `message ${type}`;
  $("admin-message").textContent = text;
}

function selectedProblemIds() {
  return [...selectedManagementIds];
}

function selectFilteredProblems() {
  filteredManagementProblems.forEach((problem) => selectedManagementIds.add(problem.id));
  document.querySelectorAll(".problem-select").forEach((input) => input.checked = true);
}

async function bulkDeleteProblems() {
  const ids = selectedProblemIds();
  if (!ids.length || !confirm(`${ids.length}問を削除しますか？`)) return;
  await applyBulkOperation({ action: "delete", ids });
}

async function bulkChangeGenre() {
  const ids = selectedProblemIds();
  const genre = $("bulk-genre").value.trim();
  if (!ids.length || !genre) return;
  await applyBulkOperation({ action: "genre", ids, genre });
}

async function applyBulkOperation(operation) {
  const ids = new Set(operation.ids);
  if (operation.action === "delete") {
    problems = problems.filter((problem) => !ids.has(problem.id));
  } else {
    problems.forEach((problem) => {
      if (ids.has(problem.id)) {
        problem.genre = operation.genre;
        delete problem.genre_order;
      }
    });
  }
  await saveProblems(operation.action === "delete"
    ? { deletedIds: [...ids] }
    : { changedIds: [...ids] });
  if (operation.action === "delete") [...ids].forEach((problemId) => markProgressDirty(problemId, "問題削除に伴う履歴削除", true));
  ids.forEach((id) => selectedManagementIds.delete(id));
  renderAdminProblems();
  refreshGenres();
}

function renderGenreOrderEditor() {
  const target = $("genre-order-list");
  const genres = genresInRegistrationOrder();
  target.innerHTML = genres.map((genre, index) => `
    <div class="genre-order-row">
      <b>${index + 1}</b>
      <span>${escapeHtml(genre)}</span>
      <span class="genre-order-actions">
        <button type="button" data-index="${index}" data-direction="-1" ${index === 0 ? "disabled" : ""}>↑</button>
        <button type="button" data-index="${index}" data-direction="1" ${index === genres.length - 1 ? "disabled" : ""}>↓</button>
      </span>
    </div>
  `).join("") || "<p>登録済みのジャンルがありません。</p>";
  target.querySelectorAll("[data-direction]").forEach((button) =>
    button.addEventListener("click", () =>
      moveGenre(Number(button.dataset.index), Number(button.dataset.direction))
    )
  );
}

function sortManagementProblems(items, history = loadHistory(), problemById = new Map(problems.map((problem) => [problem.id, problem]))) {
  const { key, direction } = managementSort;
  const factor = direction === "asc" ? 1 : -1;
  const sortValue = (problem) => {
    if (key === "hand") return String(problem.hand || "");
    if (key === "genre") return String(problem.genre || "未分類");
    if (key === "created_at") return String(problem.created_at || "");
    if (key === "last_attempt_at") return String(lastAttemptAt(history[problem.id]) || "");
    if (key === "due_at") return String(history[problem.id]?.dueAt || "");
    if (key === "source") {
      const source = problemById.get(problem.source_id);
      return source ? String(source.hand || "") : "元問題";
    }
    return "";
  };
  return [...items].map((problem) => ({ problem, value: sortValue(problem) })).sort((a, b) => {
    const av = a.value;
    const bv = b.value;
    if (key === "created_at") return (Date.parse(av || 0) - Date.parse(bv || 0)) * factor;
    if (key === "last_attempt_at") return (Date.parse(av || 0) - Date.parse(bv || 0)) * factor;
    if (key === "due_at") return (Number(av || 0) - Number(bv || 0)) * factor;
    return av.localeCompare(bv, "ja") * factor;
  }).map(({ problem }) => problem);
}

function lastAttemptAt(state) {
  const attempts = state?.attempts || [];
  return attempts.length ? attempts[attempts.length - 1].at : "";
}

async function moveGenre(index, direction) {
  const genres = genresInRegistrationOrder();
  const destination = index + direction;
  if (destination < 0 || destination >= genres.length) return;
  [genres[index], genres[destination]] = [genres[destination], genres[index]];
  saveGenreOrder(genres);
  renderAdminProblems();
  refreshGenres();
}

function previewProblem(problemId) {
  const problem = problems.find((item) => item.id === problemId);
  if (!problem) return;
  selectedManagedProblemId = problemId;
  const preview = $("problem-preview");
  const sourceProblem = problem.source_id ? problems.find((item) => item.id === problem.source_id) : problem;
  const sourceId = sourceProblem?.id || problem.id;
  const relatedProblems = problems.filter((item) => item.source_id === sourceId);
  const isSourceProblem = problem.id === sourceId;
  preview.classList.remove("hidden");
  preview.innerHTML = `
    <div class="section-heading"><h3>問題編集</h3><button id="close-preview">閉じる</button></div>
    <div class="preview-hand">${parseMpsz(problem.hand).map(tileImage).join("")}${renderMelds(problem.melds || [])}</div>
    <p>登録日: ${formatDate(problem.created_at)}</p>
    <p>加工元: ${problem.source_id ? escapeHtml(sourceProblem?.hand || "不明") : "元問題"}</p>
    <p>同じ加工元から作られた類題: ${relatedProblems.length}問</p>
    <div class="problem-edit-form">
      ${problem.source_id && sourceProblem ? `<button id="open-source-problem" type="button">加工元と関連類題をまとめて編集</button>` : ""}
      <label>ジャンル<input id="preview-genre" value="${escapeHtml(problem.genre || "")}"></label>
      <label>手牌（mpsz形式）
        <input id="preview-hand-input" value="${escapeHtml(problem.hand || "")}">
        <small>例: 123456m789p12344s。赤牌は0m・0p・0sです。</small>
      </label>
      <label>指定解答（複数可）
        <input id="preview-answer-input" value="${escapeHtml((problem.answers || []).join(","))}">
        <small>例: 8p,9p</small>
      </label>
      <label>解説・メモ<textarea id="preview-note" rows="3">${escapeHtml(problem.note || "")}</textarea></label>
      <label>出題時補足<textarea id="preview-prompt-note" rows="2">${escapeHtml(problem.prompt_note || "")}</textarea></label>
      ${isSourceProblem && relatedProblems.length ? `<label class="inline-option"><input id="preview-update-related" type="checkbox"> この加工元から作られた類題も更新する</label>` : ""}
      <div class="button-row">
        <button id="save-preview-problem" type="button" class="primary">変更を保存</button>
        <button id="delete-preview-problem" type="button" class="danger">この問題を削除</button>
      </div>
      <div id="preview-edit-message" class="message"></div>
    </div>
    <div id="preview-simulator"></div>`;
  $("close-preview").addEventListener("click", () => {
    selectedManagedProblemId = null;
    preview.classList.add("hidden");
    renderAdminProblems();
  });
  if (problem.source_id && sourceProblem) {
    $("open-source-problem").addEventListener("click", () => previewProblem(sourceProblem.id));
  }
  $("save-preview-problem").addEventListener("click", () => saveEditedProblem(problem));
  $("delete-preview-problem").addEventListener("click", () => deleteEditedProblem(problem));
  renderSimulatorTable($("preview-simulator"), problem.simulator, problem.answers || [], null);
}

function problemPayload(problem) {
  const settings = problem.settings || {};
  return {
    turn: Number(settings.turn || problem.simulator?.turn || 6),
    round_wind: settings.round_wind || "1z",
    seat_wind: settings.seat_wind || "2z",
    dora: tilesToMpszClient(settings.dora_indicators || []),
    tolerance_percent: Number(problem.tolerance_percent || 0),
    objective: Number(settings.objective || 2),
  };
}

async function saveEditedProblem(problem) {
  const message = $("preview-edit-message");
  try {
    message.className = "message busy";
    message.textContent = "シミュレーターで変更内容を確認しています。";
    const handText = $("preview-hand-input").value.replace(/\s+/g, "");
    const hand = parseMpsz(handText);
    const melds = problem.melds || [];
    const expectedTiles = 14 - melds.length * 3;
    if (hand.length !== expectedTiles) {
      throw new Error(`副露${melds.length}組では手牌を${expectedTiles}枚にしてください。`);
    }
    validateCombinedTileCounts(hand, melds);
    const answers = parseAnswerTiles($("preview-answer-input").value);
    if (!answers.length) throw new Error("指定解答を入力してください。");
    if (answers.some((answer) => !hand.some((tile) => samePhysicalTile(tile, answer)))) {
      throw new Error("指定解答は手牌に含まれる牌を指定してください。");
    }
    const candidate = {
      ...problem,
      hand: tilesToMpszClient(hand),
      answers,
      primary_answer: answers[0],
      genre: $("preview-genre").value.trim() || "未分類",
      note: $("preview-note").value.trim(),
      prompt_note: $("preview-prompt-note").value.trim(),
    };
    const shouldUpdateRelated = !problem.source_id && Boolean($("preview-update-related")?.checked);
    const relatedProblems = shouldUpdateRelated
      ? problems.filter((item) => item.source_id === problem.id)
      : [];
    const ignoredDuplicateIds = new Set([problem.id, ...relatedProblems.map((item) => item.id)]);
    const duplicate = problems.find((item) =>
      !ignoredDuplicateIds.has(item.id) && canonicalProblemKey(item) === canonicalProblemKey(candidate)
    );
    if (duplicate) throw new Error("同じ手牌と副露の問題はすでに登録されています。");
    const payload = problemPayload(candidate);
    const simulation = await analyzeWithWasm(candidate.hand, melds, payload);
    const answerGaps = calculateAnswerGaps(simulation, answers);
    const answerConditions = calculateAnswerConditions(simulation, answers);
    candidate.tolerance_percent = Math.max(...Object.values(answerGaps));
    candidate.similarity_conditions = {
      tolerance_percent: candidate.tolerance_percent,
      max_rank: answerConditions.max_rank,
      next_worse_rank: answerConditions.max_rank + 1,
      next_worse_gap_percent: answerConditions.next_worse_gap_percent,
    };
    let relatedUpdates = [];
    if (relatedProblems.length) {
      message.textContent = `関連類題を更新しています（0/${relatedProblems.length}）`;
      relatedUpdates = await buildRelatedProblemUpdates(candidate, relatedProblems, (index, total) => {
        message.textContent = `関連類題を更新しています（${index}/${total}）`;
      });
      validateProblemSetAfterUpdates(problem.id, candidate, relatedUpdates);
    }
    Object.assign(problem, candidate, {
      simulator: simulation,
      answer_gaps: answerGaps,
      tolerance_percent: candidate.tolerance_percent,
      similarity_conditions: candidate.similarity_conditions,
      unverified: false,
    });
    relatedUpdates.forEach(({ problem: target, update }) => Object.assign(target, update));
    await saveProblems({ changedIds: [problem.id, ...relatedUpdates.map((item) => item.problem.id)] });
    refreshGenres();
    renderAdminProblems();
    previewProblem(problem.id);
    const savedMessage = $("preview-edit-message");
    savedMessage.className = "message ok";
    savedMessage.textContent = relatedUpdates.length
      ? `変更を保存し、関連類題${relatedUpdates.length}問も更新しました。`
      : "変更を保存しました。";
  } catch (error) {
    message.className = "message error";
    message.textContent = error.message;
  }
}

async function buildRelatedProblemUpdates(sourceCandidate, relatedProblems, onProgress) {
  const sourcePayload = problemPayload(sourceCandidate);
  const sourceDora = sourcePayload.dora;
  const updates = [];
  for (let index = 0; index < relatedProblems.length; index++) {
    const target = relatedProblems[index];
    onProgress?.(index + 1, relatedProblems.length);
    if (!target.transform) throw new Error(`類題の加工情報がありません: ${target.hand}`);
    const transformed = transformProblem(
      sourceCandidate.hand,
      sourceCandidate.answers,
      sourceCandidate.melds || [],
      target.transform,
      {
        dora: sourceDora,
        note: sourceCandidate.note || "",
        prompt_note: sourceCandidate.prompt_note || "",
      }
    );
    validateCombinedTileCounts(parseMpsz(transformed.hand), transformed.melds);
    const payload = { ...problemPayload(target), dora: transformed.dora };
    const simulation = await analyzeWithWasm(transformed.hand, transformed.melds, payload);
    const evaluation = evaluateSimilarProblem(simulation, transformed.answers, sourceCandidate.similarity_conditions);
    if (!evaluation.accepted) throw new Error(`更新後の類題が採用条件を満たしません: ${transformed.hand}`);
    updates.push({
      problem: target,
      update: {
        hand: transformed.hand,
        answers: transformed.answers,
        primary_answer: transformed.answers[0],
        melds: transformed.melds,
        melds_text: transformed.melds.map((meld) => meld.mpsz).join(" "),
        genre: sourceCandidate.genre,
        note: transformed.note,
        prompt_note: transformed.prompt_note,
        settings: {
          ...(target.settings || {}),
          dora_indicators: parseMpsz(transformed.dora),
        },
        simulator: simulation,
        tolerance_percent: sourceCandidate.similarity_conditions.tolerance_percent,
        answer_gaps: evaluation.answer_gaps,
        similarity_conditions: {
          ...sourceCandidate.similarity_conditions,
          actual_max_rank: evaluation.conditions.max_rank,
          actual_next_worse_gap_percent: evaluation.conditions.next_worse_gap_percent,
        },
        unverified: false,
      },
    });
  }
  return updates;
}

function validateProblemSetAfterUpdates(sourceProblemId, sourceCandidate, relatedUpdates) {
  const keys = new Map();
  problems.forEach((problem) => {
    if (problem.id === sourceProblemId || relatedUpdates.some((item) => item.problem.id === problem.id)) return;
    keys.set(canonicalProblemKey(problem), problem.hand);
  });
  const planned = [
    { id: sourceProblemId, key: canonicalProblemKey(sourceCandidate), label: sourceCandidate.hand },
    ...relatedUpdates.map(({ problem, update }) => ({
      id: problem.id,
      key: canonicalProblemKey(update),
      label: update.hand,
    })),
  ];
  planned.forEach((item) => {
    if (keys.has(item.key)) throw new Error(`同じ手牌と副露の問題がすでにあります: ${item.label}`);
    keys.set(item.key, item.label);
  });
}

async function deleteEditedProblem(problem) {
  if (!confirm("この問題を削除しますか？")) return;
  problems = problems.filter((item) => item.id !== problem.id);
  const history = loadHistory();
  delete history[problem.id];
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  markProgressDirty(problem.id, "問題と学習履歴を削除", true);
  selectedManagedProblemId = null;
  await saveProblems({ deletedIds: [problem.id] });
  $("problem-preview").classList.add("hidden");
  renderAdminProblems();
  refreshGenres();
}

async function dumpProblems() {
  try {
    const exportMsg = $("export-message");
    const base64Output = $("base64-output");
    const base64 = await encodeCurrentSave();
    if (base64Output) {
      base64Output.value = base64;
    }
    downloadText(base64, `nanikiru-export-${new Date().toISOString().slice(0, 10)}.txt`);
    if (exportMsg) {
      exportMsg.className = "message ok";
      exportMsg.textContent = "セーブデータを出力しました。";
    }
  } catch (error) {
    const exportMsg = $("export-message");
    if (exportMsg) {
      exportMsg.className = "message error";
      exportMsg.textContent = error.message;
    }
  }
}

async function resetAllData() {
  const cloud = window.NanikiruCloud;
  const signedIn = Boolean(cloud?.getState?.().user);
  const prompt = signedIn
    ? "この端末とクラウドの問題・学習記録をすべて削除します。\nこの操作は元に戻せません。"
    : "問題データと学習記録を含む、この端末の保存データをすべて削除しますか？";
  if (!confirm(prompt)) return;
  try {
    if (signedIn) await cloud.deleteCloudData();
    localStorage.clear();
    problems = [];
    location.reload();
  } catch (error) {
    const exportMsg = $("export-message");
    if (exportMsg) {
      exportMsg.className = "message error";
      exportMsg.textContent = `クラウドを削除できなかったため、初期化を中止しました: ${error.message}`;
    }
  }
}

async function restoreDump(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > MAX_BACKUP_FILE_BYTES) {
      throw new Error("バックアップファイルのサイズが上限を超えています。");
    }
    const text = await file.text();
    if (!confirm("バックアップの内容で復元します。クラウドにだけ存在する問題と履歴は削除扱いになります。続けますか？")) return;
    await applyEncodedSave(text, { source: "backup", scheduleUpload: true });
    const restoreMsg = $("restore-message");
    if (restoreMsg) {
      restoreMsg.className = "message ok";
      restoreMsg.textContent = `${problems.length}問を復元しました。`;
    }
  } catch (error) {
    const restoreMsg = $("restore-message");
    if (restoreMsg) {
      restoreMsg.className = "message error";
      restoreMsg.textContent = error.message;
    }
  } finally {
    event.target.value = "";
  }
}

function copyBase64() {
  const base64Output = $("base64-output");
  if (base64Output && base64Output.value) {
    base64Output.select();
    document.execCommand("copy");
    const btn = $("copy-base64");
    const originalText = btn.textContent;
    btn.textContent = "コピーしました";
    setTimeout(() => {
      btn.textContent = originalText;
    }, 2000);
  }
}

function downloadText(value, filename) {
  const blob = new Blob([value], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildTilePicker() {
  const tiles = [
    ..."1234567890".split("").map((rank) => `${rank}m`),
    ..."1234567890".split("").map((rank) => `${rank}p`),
    ..."1234567890".split("").map((rank) => `${rank}s`),
    ..."1234567".split("").map((rank) => `${rank}z`),
  ];
  [
    { name: "hand", input: "admin-hand", max: 14 },
    { name: "meld", input: "admin-melds", max: 12 },
    { name: "dora", input: "admin-dora", max: 5 },
    { name: "answer", input: "admin-answer", max: 14 },
  ].forEach((config) => {
    const target = $(`${config.name}-picker`);
    const selectableTiles = config.name === "answer"
      ? tiles.filter((tile) => tile[0] !== "0")
      : tiles;
    target.innerHTML = `<div class="tile-picker-actions">
      <button type="button" data-action="back">1枚戻す</button>
      <button type="button" data-action="clear">クリア</button>
    </div>${selectableTiles.map((tile) => `<button type="button" class="picker-tile" data-tile="${tile}">
      ${tileImage(tile)}
    </button>`).join("")}`;
    target.querySelectorAll(".picker-tile").forEach((button) =>
      button.addEventListener("click", () => addGuiTile(config, button.dataset.tile))
    );
    target.querySelector('[data-action="back"]').addEventListener("click", () => removeGuiTile(config));
    target.querySelector('[data-action="clear"]').addEventListener("click", () => clearGuiTiles(config));
  });
  buildTextTilePicker("note-picker", "admin-note", tiles);
  renderAllInputPreviews();
}

function buildSaveData() {
  return { v: 6, p: problems, h: loadHistory(), s: loadReviewSettings(), a: loadAdminCount(), g: loadGenreOrder() };
}

async function encodeSaveData(data) {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  return `NK3:${toBase64(await compressBytes(bytes), true)}`;
}

async function encodeCurrentSave() {
  return encodeSaveData(buildSaveData());
}

function normalizeSaveData(data) {
  if (Array.isArray(data)) return validateNormalizedSave({ v: 6, p: data, h: {}, s: DEFAULT_REVIEW_SETTINGS, a: DEFAULT_ADMIN_COUNT, g: [] });
  if (data?.localStorage && typeof data.localStorage === "object") {
    const snapshot = data.localStorage;
    let parsedProblems = [];
    try {
      const raw = JSON.parse(snapshot[PROBLEMS_KEY] || "[]");
      parsedProblems = Array.isArray(raw) ? raw : raw.problems || [];
    } catch { parsedProblems = []; }
    let parsedHistory = {};
    let parsedSettings = DEFAULT_REVIEW_SETTINGS;
    try { parsedHistory = JSON.parse(snapshot[HISTORY_KEY] || "{}"); } catch { /* legacy */ }
    try { parsedSettings = JSON.parse(snapshot[REVIEW_SETTINGS_KEY] || "{}"); } catch { /* legacy */ }
    let genreOrder = [];
    try { genreOrder = JSON.parse(snapshot[GENRE_ORDER_KEY] || "[]"); } catch { /* legacy */ }
    return validateNormalizedSave({ v: 6, p: parsedProblems, h: parsedHistory, s: parsedSettings, a: Number(snapshot[ADMIN_COUNT_KEY]) || DEFAULT_ADMIN_COUNT, g: genreOrder });
  }
  if (Array.isArray(data?.p)) {
    return validateNormalizedSave({ v: 6, p: data.p, h: data.h || {}, s: data.s || DEFAULT_REVIEW_SETTINGS, a: data.a || DEFAULT_ADMIN_COUNT, g: data.g || [] });
  }
  if (Array.isArray(data?.problems)) {
    let legacyHistory = data.history || {};
    if (typeof legacyHistory === "string") {
      try { legacyHistory = JSON.parse(legacyHistory); } catch { legacyHistory = {}; }
    }
    return validateNormalizedSave({ v: 6, p: data.problems, h: legacyHistory, s: data.settings || DEFAULT_REVIEW_SETTINGS, a: data.adminCount || DEFAULT_ADMIN_COUNT, g: data.genreOrder || [] });
  }
  throw new Error("復元できるデータではありません。");
}

function validateNormalizedSave(data) {
  if (!Array.isArray(data.p) || data.p.length > 10000) throw new Error("問題データの件数が不正です。");
  const ids = new Set();
  data.p = data.p.map((problem) => validateProblemObject(problem, ids));
  if (!data.h || typeof data.h !== "object" || Array.isArray(data.h)) throw new Error("学習履歴の形式が不正です。");
  Object.entries(data.h).forEach(([id, progress]) => {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || !progress || !Array.isArray(progress.attempts) || !Number.isFinite(Number(progress.dueAt))) throw new Error("学習履歴に不正な値があります。");
  });
  if (!Array.isArray(data.g) || data.g.some((genre) => typeof genre !== "string" || genre.length > 100)) throw new Error("ジャンル順の形式が不正です。");
  return data;
}

function validateProblemObject(problem, ids = new Set()) {
  if (!problem || typeof problem !== "object" || Array.isArray(problem)) throw new Error("問題データの形式が不正です。");
  const id = String(problem.id || "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id) || ids.has(id)) throw new Error("問題IDが不正または重複しています。");
  ids.add(id);
  const genre = String(problem.genre || "未分類"), hand = String(problem.hand || ""), note = String(problem.note || ""), promptNote = String(problem.prompt_note || "");
  if (genre.length > 100 || hand.length > 100 || note.length > 10000 || promptNote.length > 2000) throw new Error(`問題 ${id} の文字数が上限を超えています。`);
  if (!Array.isArray(problem.answers) || problem.answers.length > 34 || problem.answers.some((answer) => typeof answer !== "string" || !/^[0-9][mpsz]$/.test(answer))) throw new Error(`問題 ${id} の指定解答が不正です。`);
  if (problem.source_id != null && !/^[A-Za-z0-9_-]{1,128}$/.test(String(problem.source_id))) throw new Error(`問題 ${id} の加工元IDが不正です。`);
  if (problem.melds != null && (!Array.isArray(problem.melds) || problem.melds.length > 4 || problem.melds.some((meld) => !meld || typeof meld !== "object" || String(meld.name || "").length > 100))) throw new Error(`問題 ${id} の副露情報が不正です。`);
  return { ...problem, id, genre, hand, note, prompt_note: promptNote, answers: [...problem.answers] };
}

async function applySaveData(data, options = {}) {
  const normalized = normalizeSaveData(data);
  return withCloudUploadSuppressed(async () => {
    problems = normalized.p;
    localStorage.setItem(PROBLEMS_KEY, JSON.stringify(problems));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(normalized.h || {}));
    localStorage.setItem(REVIEW_SETTINGS_KEY, JSON.stringify(normalized.s || DEFAULT_REVIEW_SETTINGS));
    localStorage.setItem(ADMIN_COUNT_KEY, String(Math.max(1, Math.min(100, Number(normalized.a) || DEFAULT_ADMIN_COUNT))));
    saveGenreOrder(normalized.g || [], false);
    repairReviewHistoryDueDates();
    reconcileSuspendedProblems({ notify: true });
    renderReviewSettings();
    renderAdminCount();
    if (currentView === "manage") renderAdminProblems();
    refreshGenres();
    if (currentView === "stats") renderStats();
    if (currentView === "quiz") showGenreSelection();
    if (options.scheduleUpload) setTimeout(() => {
      window.NanikiruCloud?.markAllDirty?.({
        problemIds: problems.map((problem) => problem.id),
        progressIds: Object.keys(normalized.h || {}),
        reason: options.source || "データを復元",
        replaceCloud: options.source === "backup",
      });
    }, 0);
    return normalized;
  });
}

async function applyEncodedSave(text, options = {}) {
  return applySaveData(await decodeSaveData(text), options);
}

function hasMeaningfulLocalData() {
  return problems.length > 0 || Object.keys(loadHistory()).length > 0;
}

function markProblemDirty(problemId, reason, deleted = false) {
  if (!suppressCloudUpload) window.NanikiruCloud?.markProblemDirty?.(problemId, { reason, deleted });
}

function markProgressDirty(problemId, reason, deleted = false) {
  if (!suppressCloudUpload) window.NanikiruCloud?.markProgressDirty?.(problemId, { reason, deleted });
}

function markSettingsDirty(reason) {
  if (!suppressCloudUpload) window.NanikiruCloud?.markSettingsDirty?.(reason);
}

async function withCloudUploadSuppressed(callback) {
  const previous = suppressCloudUpload;
  suppressCloudUpload = true;
  try { return await callback(); }
  finally { suppressCloudUpload = previous; }
}

function clearActiveAppData() {
  [PROBLEMS_KEY, HISTORY_KEY, REVIEW_SETTINGS_KEY, ADMIN_COUNT_KEY, GENRE_ORDER_KEY].forEach((key) => localStorage.removeItem(key));
  problems = [];
}

function exposeSaveDataApi() {
  window.NanikiruSaveData = {
    buildSaveData, encodeSaveData, encodeCurrentSave, decodeSaveData, applySaveData,
    applyEncodedSave, hasMeaningfulLocalData, withCloudUploadSuppressed, clearActiveAppData,
    getProblem: (problemId) => problems.find((problem) => problem.id === problemId) || null,
    getProgress: (problemId) => loadHistory()[problemId] || null,
    getSettings: () => ({ reviewSettings: loadReviewSettings(), adminCount: loadAdminCount(), genreOrder: loadGenreOrder() }),
    applyCloudRecords,
    reload: async () => { await loadProblems(); renderReviewSettings(); renderAdminCount(); },
  };
}

async function applyCloudRecords({ problemRecords = [], progressRecords = [], settingsRecord = null } = {}) {
  return withCloudUploadSuppressed(async () => {
    const history = loadHistory();
    problemRecords.forEach((record) => {
      const index = problems.findIndex((problem) => problem.id === record.problemId);
      if (record.deleted) {
        if (index >= 0) problems.splice(index, 1);
      } else {
        const value = validateProblemObject(record.value);
        if (value.id !== record.problemId) throw new Error("クラウド問題のIDが一致しません。");
        if (index >= 0) problems[index] = value;
        else problems.push(value);
      }
    });
    progressRecords.forEach((record) => {
      if (record.deleted) delete history[record.problemId];
      else history[record.problemId] = record.value;
    });
    localStorage.setItem(PROBLEMS_KEY, JSON.stringify(problems));
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    if (settingsRecord) {
      const safeSettings = sanitizeReviewSettings(settingsRecord.reviewSettings || {});
      if (!Array.isArray(settingsRecord.genreOrder) || settingsRecord.genreOrder.some((genre) => typeof genre !== "string" || genre.length > 100)) throw new Error("クラウドのジャンル順が不正です。");
      localStorage.setItem(REVIEW_SETTINGS_KEY, JSON.stringify(safeSettings));
      localStorage.setItem(ADMIN_COUNT_KEY, String(Math.max(1, Math.min(100, Number(settingsRecord.adminCount) || DEFAULT_ADMIN_COUNT))));
      saveGenreOrder(settingsRecord.genreOrder, false);
    }
    repairReviewHistoryDueDates();
    reconcileSuspendedProblems({ notify: true });
    renderReviewSettings(); renderAdminCount(); refreshGenres();
    if (currentView === "manage") renderAdminProblems();
    if (currentView === "stats") renderStats();
  });
}

function buildTextTilePicker(pickerId, inputId, tiles) {
  const target = $(pickerId);
  if (!target) return;
  target.innerHTML = tiles.map((tile) => `<button type="button" class="picker-tile" data-tile="${tile}">
    ${tileImage(tile)}
  </button>`).join("");
  target.querySelectorAll(".picker-tile").forEach((button) =>
    button.addEventListener("click", () => insertTileText(inputId, button.dataset.tile))
  );
}

function insertTileText(inputId, tile) {
  const input = $(inputId);
  if (!input) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = `${input.value.slice(0, start)}${tile}${input.value.slice(end)}`;
  const cursor = start + tile.length;
  input.focus();
  input.setSelectionRange(cursor, cursor);
}

function addGuiTile(config, tile) {
  if (config.name === "meld") {
    if (tile[0] === "0") {
      const existingRedTiles = [
        ...parseMeldsClient($("admin-melds").value).flatMap((meld) => meld.tiles),
        ...pendingMeldTiles,
      ];
      if (existingRedTiles.includes(tile)) return;
    }
    if (pendingMeldTiles.length >= 3) pendingMeldTiles = [];
    pendingMeldTiles.push(tile);
    if (pendingMeldTiles.length === 3) {
      try {
        const meld = parseMeldsClient(tilesToMpszClient(pendingMeldTiles))[0];
        const existing = parseMeldsClient($("admin-melds").value);
        if (existing.length >= 4) throw new Error("副露は4組までです。");
        $("admin-melds").value = [...existing.map((item) => item.mpsz), meld.mpsz].join(" ");
        pendingMeldTiles = [];
      } catch (error) {
        setAdminMessage(error.message, "error");
        pendingMeldTiles = [];
      }
    }
    renderAllInputPreviews();
    return;
  }
  const values = parseMpsz($(config.input).value);
  if (values.length >= config.max) return;
  if (config.name === "answer" && values.includes(tile)) return;
  if (tile[0] === "0" && values.includes(tile)) return;
  if (values.filter((value) => samePhysicalTile(value, tile)).length >= 4) return;
  values.push(tile);
  $(config.input).value = tilesToMpszClient(values);
  renderAllInputPreviews();
}

function removeGuiTile(config) {
  if (config.name === "meld") {
    if (pendingMeldTiles.length) pendingMeldTiles.pop();
    else {
      const melds = parseMeldsClient($("admin-melds").value);
      melds.pop();
      $("admin-melds").value = melds.map((meld) => meld.mpsz).join(" ");
    }
  } else {
    const values = parseMpsz($(config.input).value);
    values.pop();
    $(config.input).value = tilesToMpszClient(values);
  }
  renderAllInputPreviews();
}

function clearGuiTiles(config) {
  if (config.name === "meld") pendingMeldTiles = [];
  $(config.input).value = "";
  renderAllInputPreviews();
}

function renderAllInputPreviews() {
  renderTileInputPreview("hand-preview", "admin-hand", parseMpsz($("admin-hand").value), "手牌を選択してください", 14);
  renderTileInputPreview("dora-preview", "admin-dora", parseMpsz($("admin-dora").value), "ドラ表示牌なし");
  renderTileInputPreview("answer-preview", "admin-answer", parseMpsz($("admin-answer").value), "解答牌を選択してください");
  let melds = [];
  try { melds = parseMeldsClient($("admin-melds").value); } catch {}
  $("meld-preview").innerHTML = `${renderMelds(melds)}
    ${pendingMeldTiles.length ? `<div class="concealed-hand">${pendingMeldTiles.map(tileImage).join("")}</div>` : ""}
    ${!melds.length && !pendingMeldTiles.length ? '<span class="empty-preview">副露なし</span>' : ""}`;
}

function renderTileInputPreview(id, inputId, tiles, emptyText, slotCount = 0) {
  const target = $(id);
  const tileButtons = tiles
    .map((tile, index) => `<button type="button" class="preview-tile" data-index="${index}" title="${tile}を削除">${tileImage(tile)}</button>`)
    .join("");
  if (slotCount) {
    const emptySlots = Array.from(
      { length: Math.max(0, slotCount - tiles.length) },
      () => '<span class="preview-tile-slot" aria-hidden="true"></span>'
    ).join("");
    target.classList.add("fixed-tile-slots");
    target.innerHTML = `${tileButtons}${emptySlots}`;
  } else {
    target.classList.remove("fixed-tile-slots");
    target.innerHTML = tiles.length ? tileButtons : `<span class="empty-preview">${emptyText}</span>`;
  }
  target.querySelectorAll(".preview-tile").forEach((button) =>
    button.addEventListener("click", () => {
      const values = parseMpsz($(inputId).value);
      values.splice(Number(button.dataset.index), 1);
      $(inputId).value = tilesToMpszClient(values);
      renderAllInputPreviews();
    })
  );
}

function tileImage(tile) {
  return `<img class="tile-face" src="assets/tiles/${assetName(tile)}" alt="${tile}">`;
}

function renderTextWithTiles(text) {
  return escapeHtml(String(text || "")).replace(/[0-9]+[mpsz]/g, (match) => {
    const tiles = parseMpsz(match);
    if (!tiles.length) return match;
    return `<span class="inline-tiles">${tiles.map(tileImage).join("")}</span>`;
  });
}

function tilesToMpszClient(tiles) {
  return "mpsz".split("").map((suit) => {
    const ranks = tiles
      .filter((tile) => tile[1] === suit)
      .map((tile) => tile[0])
      .sort((a, b) => tileRank(`${a}${suit}`) - tileRank(`${b}${suit}`) || Number(a === "0") - Number(b === "0"));
    return ranks.length ? `${ranks.join("")}${suit}` : "";
  }).join("");
}

function splitBlocksClient(hand, extraTiles = []) {
  const tiles = [
    ...(Array.isArray(hand) ? parseMpsz(tilesToMpszClient(hand)) : parseMpsz(hand)),
    ...extraTiles,
  ].sort(compareTilesForBlock);
  const blocks = [];
  let index = 0;
  for (const suit of "mps") {
    const suited = tiles.filter((tile) => tile[1] === suit);
    if (!suited.length) continue;
    let current = [suited[0]];
    let previous = tileRank(suited[0]);
    suited.slice(1).forEach((tile) => {
      const rank = tileRank(tile);
      if (rank - previous <= 2) current.push(tile);
      else {
        blocks.push(makeBlock(index++, suit, current));
        current = [tile];
      }
      previous = rank;
    });
    blocks.push(makeBlock(index++, suit, current));
  }
  tiles.filter((tile) => tile[1] === "z").forEach((tile) =>
    blocks.push(makeBlock(index++, "z", [tile]))
  );
  return blocks;
}

function compareTilesForBlock(left, right) {
  const suitOrder = { m: 0, p: 1, s: 2, z: 3 };
  return suitOrder[left[1]] - suitOrder[right[1]] || tileRank(left) - tileRank(right);
}

function makeBlock(index, suit, tiles) {
  const ranks = tiles.map(tileRank);
  let slideOptions = [0];
  if (suit !== "z" && !ranks.includes(1) && !ranks.includes(9)) {
    slideOptions = [];
    for (let delta = 2 - Math.min(...ranks); delta <= 8 - Math.max(...ranks); delta++) {
      slideOptions.push(delta);
    }
  }
  return { index, suit, tiles, slideOptions };
}

function describeBlocksClient(hand) {
  return splitBlocksClient(hand).map((block) => tilesToMpszClient(block.tiles));
}

function buildQuizProblemPresentation(problem, settings = loadReviewSettings(), random = Math.random) {
  if (!settings.quiz_random_transform) return problem;
  const suitIndex = Math.min(SUIT_PERMUTATIONS.length - 1, Math.floor(Math.max(0, random()) * SUIT_PERMUTATIONS.length));
  const spec = {
    suit_map: { ...SUIT_PERMUTATIONS[suitIndex] },
    reverse: random() < 0.5,
    slides: {},
  };
  const transformed = transformProblem(
    problem.hand,
    problem.answers || [problem.primary_answer],
    problem.melds || [],
    spec,
    {
      dora: tilesToMpszClient(problem.settings?.dora_indicators || []),
      note: problem.note || "",
      prompt_note: problem.prompt_note || "",
    }
  );
  return {
    ...problem,
    ...transformed,
    primary_answer: transformed.answers[0],
    settings: {
      ...(problem.settings || {}),
      dora_indicators: parseMpsz(transformed.dora),
    },
    simulator: transformSimulatorForQuiz(problem.simulator, spec),
    quiz_transform: spec,
  };
}

function transformSimulatorForQuiz(simulator, spec) {
  if (!simulator || typeof simulator !== "object") return simulator;
  const transformTile = (tile) => typeof tile === "string" ? transformTileWithDelta(tile, spec, 0) : tile;
  return {
    ...simulator,
    best_discards: (simulator.best_discards || []).map(transformTile),
    rows: (simulator.rows || []).map((row) => ({
      ...row,
      tile: transformTile(row.tile),
      necessary_tiles: (row.necessary_tiles || []).map((item) => ({ ...item, tile: transformTile(item.tile) })),
      call_tile_rates: (row.call_tile_rates || []).map((item) => ({ ...item, tile: transformTile(item.tile) })),
    })),
  };
}

function enumerateTransformSpecs(hand, extraTiles = []) {
  const blocks = splitBlocksClient(hand, extraTiles);
  const reverseSuitSets = [
    [],
    ["m"], ["p"], ["s"],
    ["m", "p"], ["m", "s"], ["p", "s"],
  ];
  const specs = [];
  const seen = new Set();
  const movableBlocks = blocks.filter((block) => block.suit !== "z");
  const slideState = {};
  const emitSlides = (index) => {
    if (index >= movableBlocks.length) {
      reverseSuitSets.forEach((reverseSuits) => {
        const key = JSON.stringify([reverseSuits, slideState]);
        if (seen.has(key)) return;
        seen.add(key);
        const spec = {
          suit_map: { ...SUIT_PERMUTATIONS[0] },
          reverse: false,
          reverse_suits: [...reverseSuits],
          slides: { ...slideState },
        };
        if (!isBlockStructurePreserved(hand, spec)) return;
        const degree = reverseSuits.length
          + Object.values(slideState).filter((delta) => delta !== 0).length;
        if (!degree) return;
        specs.push({ ...spec, degree });
      });
      return;
    }
    const block = movableBlocks[index];
    block.slideOptions.forEach((delta) => {
      slideState[block.index] = delta;
      emitSlides(index + 1);
    });
    delete slideState[block.index];
  };
  emitSlides(0);
  return specs;
}

function isBlockStructurePreserved(hand, spec) {
  const originalBlocks = splitBlocksClient(hand);
  const expected = originalBlocks.map((block) => {
    const delta = Number(spec.slides[block.index] || 0);
    if (!block.slideOptions.includes(delta)) return null;
    return tilesToMpszClient(block.tiles.map((tile) => transformTileWithDelta(tile, spec, delta)));
  });
  if (expected.some((value) => !value)) return false;
  const actualHand = originalBlocks.flatMap((block) => {
    const delta = Number(spec.slides[block.index] || 0);
    return block.tiles.map((tile) => transformTileWithDelta(tile, spec, delta));
  });
  const actual = splitBlocksClient(actualHand).map((block) => tilesToMpszClient(block.tiles));
  return normalizedBlockSignature(expected) === normalizedBlockSignature(actual);
}

function normalizedBlockSignature(blocks) {
  return [...blocks].sort().join("|");
}

function randomTransformSpecs(hand, limit = null, extraTiles = []) {
  const specs = enumerateTransformSpecs(hand, extraTiles);
  shuffleArray(specs);
  return Number.isFinite(limit) ? specs.slice(0, limit) : specs;
}

function transformProblem(hand, answers, melds, spec, extras = {}) {
  const output = [];
  const convertedByTile = {};
  const handTiles = parseMpsz(hand);
  const handRemaining = handTiles.reduce((counts, tile) => {
    counts[tile] = (counts[tile] || 0) + 1;
    return counts;
  }, {});
  splitBlocksClient(hand, transformAuxiliaryTiles(extras)).forEach((block) => {
    const delta = Number(spec.slides[block.index] || 0);
    if (!block.slideOptions.includes(delta)) throw new Error("許可されないスライドです");
    block.tiles.forEach((tile) => {
      const converted = transformTileWithDelta(tile, spec, delta);
      if (handRemaining[tile] > 0) {
        output.push(converted);
        handRemaining[tile]--;
      }
      convertedByTile[tile] = converted;
    });
  });
  const counts = countTiles(output);
  if (Object.values(counts).some((count) => count > 4)) {
    throw new Error("変換により同じ牌が5枚以上になります");
  }
  const transformedAnswers = [...new Set(answers.map((answer) => transformMappedTile(answer, convertedByTile, spec)))];
  if (transformedAnswers.some((answer) => !answer)) throw new Error("解答牌を変換できません");
  const transformedMelds = melds.map((meld) => {
    const tiles = meld.tiles.map((tile) => {
      return transformTileWithDelta(tile, spec, 0);
    });
    const mpsz = tilesToMpszClient(tiles);
    return { type: meld.type, name: meld.type === 0 ? "ポン" : "チー", tiles: parseMpsz(mpsz), mpsz };
  });
  const transformedDoraTiles = parseMpsz(extras.dora || "")
    .map(doraIndicatorToDora)
    .map((tile) => transformMappedTile(tile, convertedByTile, spec))
    .map(doraToDoraIndicator);
  return {
    hand: tilesToMpszClient(output),
    answers: transformedAnswers,
    melds: transformedMelds,
    dora: tilesToMpszClient(transformedDoraTiles),
    note: transformTextTiles(extras.note || "", convertedByTile, spec),
    prompt_note: transformTextTiles(extras.prompt_note || "", convertedByTile, spec),
  };
}

function transformAuxiliaryTiles({ dora = "", note = "" } = {}) {
  return [
    ...parseMpsz(dora).map(doraIndicatorToDora),
    ...extractTextTiles(note),
  ];
}

function transformTileWithDelta(tile, spec, delta) {
  const wasRed = tile[0] === "0";
  let rank = tileRank(tile);
  let suit = tile[1];
  if (suit !== "z") {
    rank += delta;
    const reverse = Array.isArray(spec.reverse_suits) ? spec.reverse_suits.includes(suit) : Boolean(spec.reverse);
    if (reverse) rank = 10 - rank;
    suit = spec.suit_map[suit];
  }
  return `${wasRed && rank === 5 ? 0 : rank}${suit}`;
}

function transformMappedTile(tile, convertedByTile, spec) {
  if (convertedByTile[tile]) return convertedByTile[tile];
  const matchingSource = Object.keys(convertedByTile).find((sourceTile) => samePhysicalTile(sourceTile, tile));
  return matchingSource ? convertedByTile[matchingSource] : transformTileWithDelta(tile, spec, 0);
}

function extractTextTiles(text) {
  const tiles = [];
  String(text || "").replace(/[0-9]+[mpsz]/g, (match) => {
    tiles.push(...parseMpsz(match));
    return match;
  });
  return tiles;
}

function transformTextTiles(text, convertedByTile, spec) {
  return String(text || "").replace(/[0-9]+[mpsz]/g, (match) => {
    const transformed = parseMpsz(match).map((tile) => transformMappedTile(tile, convertedByTile, spec));
    return tilesToMpszClient(transformed);
  });
}

function doraIndicatorToDora(tile) {
  const rank = tileRank(tile);
  const suit = tile[1];
  if (suit !== "z") return `${rank === 9 ? 1 : rank + 1}${suit}`;
  if (rank <= 4) return `${rank === 4 ? 1 : rank + 1}z`;
  return `${rank === 7 ? 5 : rank + 1}z`;
}

function doraToDoraIndicator(tile) {
  const rank = tileRank(tile);
  const suit = tile[1];
  if (suit !== "z") return `${rank === 1 ? 9 : rank - 1}${suit}`;
  if (rank <= 4) return `${rank === 1 ? 4 : rank - 1}z`;
  return `${rank === 5 ? 7 : rank - 1}z`;
}

function validateCombinedTileCounts(hand, melds) {
  const allTiles = [
    ...hand,
    ...melds.flatMap((meld) => meld.tiles || []),
  ];
  const duplicatedRedTiles = ["0m", "0p", "0s"].filter(
    (redTile) => allTiles.filter((tile) => tile === redTile).length > 1
  );
  if (duplicatedRedTiles.length) {
    throw new Error(`赤牌は各種類1枚までです: ${duplicatedRedTiles.join("・")}`);
  }
  const counts = countTiles(allTiles);
  const over = Object.entries(counts).filter(([, count]) => count > 4).map(([tile]) => tile);
  if (over.length) throw new Error(`手牌と副露を合わせて同じ牌が5枚以上あります: ${over.join("・")}`);
}

function countTiles(tiles) {
  return tiles.reduce((counts, tile) => {
    const normalized = normalizePhysicalTile(tile);
    counts[normalized] = (counts[normalized] || 0) + 1;
    return counts;
  }, {});
}

function canonicalProblemKey(problem) {
  const hand = tilesToMpszClient(parseMpsz(problem.hand || ""));
  const meldText = problem.melds
    ? problem.melds.map((meld) => meld.mpsz || tilesToMpszClient(meld.tiles || [])).join(" ")
    : String(problem.melds_text || "").trim();
  return `${hand}|${meldText}`;
}

function shuffleArray(values) {
  for (let index = values.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [values[index], values[other]] = [values[other], values[index]];
  }
  return values;
}

function degreeCounts(specs) {
  return specs.reduce((counts, spec) => {
    const degree = String(spec?.degree || 0);
    counts[degree] = (counts[degree] || 0) + 1;
    return counts;
  }, {});
}

function parseMeldsClient(text) {
  if (!text.trim()) return [];
  const compact = text.toLowerCase().replace(/[\s,、・/;|]+/g, "");
  const matches = [...compact.matchAll(/([0-9]+)([mpsz])/g)];
  if (matches.map((match) => match[0]).join("") !== compact) {
    throw new Error("副露の入力形式が不正です。");
  }
  const melds = [];
  matches.forEach((match) => {
    if (match[1].length % 3) throw new Error("副露1組は3枚です。");
    for (let offset = 0; offset < match[1].length; offset += 3) {
      const tiles = match[1].slice(offset, offset + 3).split("").map((rank) => `${rank}${match[2]}`);
      const ranks = tiles.map(tileRank).sort((a, b) => a - b);
      const pong = new Set(tiles.map(normalizePhysicalTile)).size === 1;
      const chi = match[2] !== "z" && ranks[1] === ranks[0] + 1 && ranks[2] === ranks[1] + 1;
      if (!pong && !chi) throw new Error(`${tiles.join("")}はポン・チーの形ではありません。`);
      const type = pong ? 0 : 1;
      melds.push({ type, name: pong ? "ポン" : "チー", tiles, mpsz: tilesToMpszClient(tiles) });
    }
  });
  return melds;
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("ja-JP");
}

function renderSimulatorTable(container, simulation, acceptedAnswers = [], selectedTile = null) {
  if (!container || !simulation?.rows?.length) return;
  const rows = simulation.rows;
  const best = rows[0].metric;
  const commonShapleyScale = Math.max(1, ...rows.map((row) => Math.max(0,
    Number(row.shapley_total ?? (row.yaku_contributions || []).reduce((sum, entry) => sum + Number(entry.shapley || 0), 0)))));
  container.classList.remove("hidden");
  container.innerHTML = `
    <div class="simulator-heading">
      <div>
        <span class="eyebrow">何切るシミュレーター結果</span>
        <h3>何切るシミュレーター結果</h3>
      </div>
      <span>${simulation.turn}巡目・${simulation.shanten?.all ?? "-"}シャンテン</span>
    </div>
    ${simulation.solver_mode?.degraded ? `<p class="sim-warning">${escapeHtml(wasmFallbackWarning(simulation.solver_mode))}</p>` : ""}
    <div class="sim-table-wrap">
      <table class="sim-table">
        <thead>
          <tr>
            <th>切る牌</th>
            <th>必要牌</th>
            <th>聴牌率</th>
            <th>和了率</th>
            <th>副露和了率</th>
            <th>期待値</th>
            <th>役別Shapley<br><small>共通上限 ${formatNumber(commonShapleyScale)}点</small></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row, index) => {
            const classes = [
              index === 0 ? "best-row" : "",
              acceptedAnswers.some((answer) => samePhysicalTile(answer, row.tile)) ? "accepted-row" : "",
              selectedTile && samePhysicalTile(selectedTile, row.tile) ? "selected-row" : "",
            ].filter(Boolean).join(" ");
            const relative = best ? row.metric / best * 100 : 0;
            return `<tr class="${classes}">
              <td><span class="discard-cell">${tileImage(row.tile)}<span><b>${row.tile}</b><small>${row.shanten}シャンテン</small></span></span></td>
              <td>${renderNecessaryTiles(row)}</td>
              <td>${formatProbability(row.tenpai_probability)}</td>
              <td>${formatProbability(row.win_probability)}</td>
              <td>${formatProbability(row.call_win_probability)}</td>
              <td><b>${formatNumber(row.expected_score)}</b><small class="relative-score">${relative.toFixed(2)}%</small></td>
              <td class="shapley-cell">${renderYakuContributions(row, commonShapleyScale)}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
    <p class="sim-legend">上段が最良手、強調表示が指定解答です。役別グラフは全打牌で同じ点数スケールです。</p>
  `;
  applyShapleyChartStyles(container);
}

function yakuColor(entry) {
  if (entry?.yaku == null || entry?.isOther || entry?.name === "その他") return "#687386";
  let hash = 2166136261;
  for (const character of String(entry?.yaku ?? "unknown")) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  return `hsl(${hash % 360} 62% 55%)`;
}

function applyShapleyChartStyles(container) {
  container.querySelectorAll(".shapley-segment[data-shapley-width]").forEach((segment) => {
    const parsedWidth = Number(segment.dataset.shapleyWidth);
    const width = Number.isFinite(parsedWidth) ? Math.min(100, Math.max(0, parsedWidth)) : 0;
    segment.style.width = `${width}%`;
    segment.style.backgroundColor = segment.dataset.shapleyColor || "#687386";
  });
}

function renderYakuContributions(row, commonScale) {
  const entries = row.yaku_contributions || [];
  if (!entries.length) return '<span class="shapley-empty">役別データなし</span>';
  const chartEntries = row.yaku_chart_contributions || aggregateYakuContributions(entries);
  const segments = chartEntries.map((entry) => {
    const width = Math.max(0, Number(entry.shapley || 0)) / commonScale * 100;
    const suffix = entry.count ? `（${entry.count}役）` : "";
    return `<span class="shapley-segment" data-yaku="${entry.yaku ?? "other"}"
      data-shapley-width="${width.toFixed(4)}" data-shapley-color="${yakuColor(entry)}"
      title="${escapeHtml(entry.name)}${suffix}: ${formatNumber(entry.shapley)}点">${escapeHtml(entry.short_name || yakuShortName(entry.yaku, entry.name))}</span>`;
  }).join("");
  const detailRows = entries.map((entry) => `
    <tr><td>${escapeHtml(entry.name)}</td><td>${formatProbability(entry.occurrence)}</td><td>${formatNumber(entry.shapley)}</td></tr>
  `).join("");
  const shapleyTotal = Number(row.shapley_total ?? entries.reduce((sum, entry) => sum + Number(entry.shapley || 0), 0));
  const residual = Number(row.shapley_residual ?? Number(row.expected_score || 0) - shapleyTotal);
  const callDetails = renderCallContributions(row);
  return `<div class="shapley-track" aria-label="役別Shapley。共通上限${commonScale.toFixed(1)}点">${segments}</div>
    <details class="shapley-details"><summary>詳細</summary>
      <table class="shapley-detail-table">
        <thead><tr><th>役</th><th>出現率</th><th>Shapley</th></tr></thead>
        <tbody>${detailRows}</tbody>
        <tfoot><tr><th>合計</th><td>期待値 ${formatNumber(row.expected_score)}</td><td>${formatNumber(shapleyTotal)}</td></tr>
          <tr><th>残差</th><td colspan="2">${residual.toFixed(4)}</td></tr></tfoot>
      </table>${callDetails}
    </details>`;
}

function renderCallContributions(row) {
  if (Number(row.call_probability || 0) <= 1e-12) return "";
  const calledRows = (row.called_yaku_contributions || []).map((entry) => `
    <tr><td>${escapeHtml(entry.name)}</td><td>${formatProbability(entry.occurrence)}</td><td>${formatNumber(entry.shapley)}</td></tr>
  `).join("");
  const callTiles = (row.call_tile_rates || []).map((entry) => `
    <span class="call-tile-rate">${tileImage(entry.tile)}<small>全体 ${formatProbability(entry.probability)}<br>副露時 ${formatProbability(entry.conditional_probability)}</small></span>
  `).join("");
  return `<section class="call-contributions">
    <h4>副露時の内訳 <small>副露発生 ${formatProbability(row.call_probability)}</small></h4>
    <div class="call-tile-rates">${callTiles || '<span class="shapley-empty">鳴いた牌の内訳なし</span>'}</div>
    <table class="shapley-detail-table">
      <thead><tr><th>役</th><th>副露時の出現率</th><th>副露時Shapley</th></tr></thead>
      <tbody>${calledRows || '<tr><td colspan="3">該当役なし</td></tr>'}</tbody>
    </table>
  </section>`;
}

function renderNecessaryTiles(row) {
  if (!row.necessary_tiles?.length) return `<span class="ukeire-only">受入 ${row.ukeire}枚</span>`;
  return `<span class="effective-tiles">${row.necessary_tiles.map((item) => `
    <span class="effective-tile">
      ${tileImage(item.tile)}
      <small>${item.count}</small>
    </span>
  `).join("")}<b>計${row.ukeire}枚</b></span>`;
}

function renderMelds(melds) {
  if (!melds?.length) return "";
  return `<div class="meld-area">${melds.map((meld) => `
    <div class="meld" title="${escapeHtml(meld.name || (meld.type === 0 ? "ポン" : "チー"))}">
      ${(meld.tiles || []).map((tile, index) => `
        <span class="meld-tile ${index === 0 ? "sideways" : ""}">
          ${tileImage(tile)}
        </span>
      `).join("")}
    </div>
  `).join("")}</div>`;
}

function formatProbability(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("ja-JP", { maximumFractionDigits: 1 });
}

function formatPercent(value) {
  return Number(value || 0).toFixed(4).replace(/\.?0+$/, "");
}

function formatOptionalPercent(value) {
  return value == null ? "条件なし" : `${formatPercent(value)}%以上`;
}

function parseMpsz(text) {
  const output = [];
  let digits = [];
  for (const char of text) {
    if (/\d/.test(char)) digits.push(char);
    else if ("mpsz".includes(char)) {
      output.push(...digits.map((digit) => `${digit}${char}`));
      digits = [];
    }
  }
  return output;
}

function parseAnswerTiles(text) {
  return [...new Set(
    parseMpsz(String(text || "").replace(/[\s,、・/]+/g, ""))
      .map(normalizePhysicalTile)
  )];
}

function tileRank(tile) {
  return tile[0] === "0" ? 5 : Number(tile[0]);
}

function sortTilesForQuestion(tiles) {
  const suitOrder = { m: 0, p: 1, s: 2, z: 3 };
  return [...tiles].sort((left, right) =>
    (suitOrder[left[1]] ?? 99) - (suitOrder[right[1]] ?? 99)
    || tileRank(left) - tileRank(right)
    || Number(left[0] === "0") - Number(right[0] === "0")
  );
}

function selectDrawnTileForQuestion(tiles, random = Math.random) {
  const sortedTiles = sortTilesForQuestion(tiles);
  const counts = sortedTiles.reduce((result, tile) => {
    const normalized = normalizePhysicalTile(tile);
    result.set(normalized, (result.get(normalized) || 0) + 1);
    return result;
  }, new Map());
  const candidates = new Set();
  for (const suit of "mps") {
    for (let rank = 1; rank <= 7; rank++) {
      if (!counts.get(`${rank}${suit}`) || !counts.get(`${rank + 1}${suit}`) || !counts.get(`${rank + 2}${suit}`)) continue;
      candidates.add(`${rank}${suit}`);
      candidates.add(`${rank + 2}${suit}`);
    }
  }
  counts.forEach((count, tile) => {
    if (count >= 3) candidates.add(tile);
  });
  if (!candidates.size) return { concealedTiles: sortedTiles, drawnTile: null };

  const candidateTiles = [...candidates];
  const candidateIndex = Math.min(candidateTiles.length - 1, Math.floor(Math.max(0, random()) * candidateTiles.length));
  const selectedPhysicalTile = candidateTiles[candidateIndex];
  const matchingIndexes = sortedTiles
    .map((tile, index) => normalizePhysicalTile(tile) === selectedPhysicalTile ? index : -1)
    .filter((index) => index >= 0);
  const matchingIndex = matchingIndexes.length === 1
    ? matchingIndexes[0]
    : matchingIndexes[Math.min(matchingIndexes.length - 1, Math.floor(Math.max(0, random()) * matchingIndexes.length))];
  const concealedTiles = [...sortedTiles];
  const [drawnTile] = concealedTiles.splice(matchingIndex, 1);
  return { concealedTiles, drawnTile };
}

function normalizePhysicalTile(tile) {
  return tile[0] === "0" ? `5${tile[1]}` : tile;
}

function samePhysicalTile(left, right) {
  return normalizePhysicalTile(left) === normalizePhysicalTile(right);
}

function assetName(tile) {
  if (tile[0] === "0") {
    return ({ m: "aka3", p: "aka1", s: "aka2" })[tile[1]] + "-66-90-s.png";
  }
  const prefixes = { m: "man", p: "pin", s: "sou", z: "ji" };
  return `${prefixes[tile[1]]}${tile[0]}-66-90-s.png`;
}

async function decodeSaveData(text) {
  if (typeof text !== "string" || text.length > MAX_BACKUP_TEXT_CHARS) {
    throw new Error("バックアップのサイズが上限を超えています。");
  }
  const value = text.trim();
  if (value.startsWith("NK3:")) {
    const payload = value.slice(4);
    if (payload.length > MAX_BACKUP_BASE64_CHARS) throw new Error("バックアップファイルのサイズが上限を超えています。");
    const compressed = fromBase64(payload, true);
    if (compressed.byteLength > MAX_BACKUP_FILE_BYTES) throw new Error("バックアップファイルのサイズが上限を超えています。");
    const decoded = await decompressBytes(compressed);
    const json = new TextDecoder().decode(decoded);
    if (json.length > MAX_BACKUP_TEXT_CHARS) throw new Error("バックアップの展開後サイズが上限を超えています。");
    return JSON.parse(json);
  }
  try {
    return JSON.parse(value);
  } catch {
    if (value.length > MAX_BACKUP_BASE64_CHARS) throw new Error("バックアップファイルのサイズが上限を超えています。");
    const decoded = new TextDecoder().decode(fromBase64(value));
    if (decoded.length > MAX_BACKUP_TEXT_CHARS) throw new Error("バックアップの展開後サイズが上限を超えています。");
    return JSON.parse(decoded);
  }
}

async function compressBytes(bytes) {
  if (typeof CompressionStream === "undefined") {
    throw new Error("このブラウザはデータの出力に対応していません。ブラウザを最新版に更新してください。");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function decompressBytes(bytes, maxOutputBytes = MAX_DECOMPRESSED_BACKUP_BYTES) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("このブラウザはデータの復元に対応していません。ブラウザを最新版に更新してください。");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxOutputBytes) {
        await reader.cancel("decompressed backup limit exceeded");
        throw new Error("バックアップの展開後サイズが上限を超えています。");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error?.message === "バックアップの展開後サイズが上限を超えています。") throw error;
    throw new Error("バックアップデータを展開できませんでした。");
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => { output.set(chunk, offset); offset += chunk.byteLength; });
  return output;
}

function toBase64(bytes, urlSafe = false) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  const base64 = btoa(binary);
  return urlSafe ? base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : base64;
}

function fromBase64(text, urlSafe = false) {
  let normalized = text;
  if (urlSafe) {
    normalized = normalized.replace(/-/g, "+").replace(/_/g, "/");
    normalized += "=".repeat((4 - normalized.length % 4) % 4);
  }
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[char]));
}
