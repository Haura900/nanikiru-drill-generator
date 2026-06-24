const DAY = 24 * 60 * 60 * 1000;
const HISTORY_KEY = "nanikiru-learning-v1";
const PROBLEMS_KEY = "nanikiru-problems-v1";
const BACKUP_PROMPT_KEY = "nanikiru-backup-prompt-v1";
let problems = [];
let currentProblem = null;
let currentView = "quiz";
let currentQuizContext = null;
let filteredManagementProblems = [];
let wasmWorker;
let wasmRequestId = 0;
let wasmWorkerUseCount = 0;
let wasmWorkerGeneration = 0;
let wasmQueue = Promise.resolve();
const wasmRequests = new Map();
const WASM_ASSET_VERSION = "20260623-2";
const WASM_RECYCLE_AFTER = 24;
const WASM_REQUEST_TIMEOUT = 240000;
const WASM_DEFAULT_FLAGS = Object.freeze({
  enable_shanten_down: true,
  enable_tegawari: true,
});
const APP_BUILD_VERSION = typeof window !== "undefined" ? window.NANIKIRU_BUILD_VERSION || "local" : "local";
let pendingMeldTiles = [];
let reviewSkippedThisSession = false;
let managementSort = { key: "created_at", direction: "desc" };
let selectedManagedProblemId = null;
let wasmActiveRequestKey = null;
let wasmActiveRequestMode = { degraded: false, fallbackReason: "", flags: { ...WASM_DEFAULT_FLAGS } };
let lastWasmMode = null;

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  bindNavigation();
  bindQuiz();
  bindStats();
  bindAdmin();
  bindExport();
  buildTilePicker();
  renderBuildVersion();
  await loadProblems();
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
  const selection = $("quiz-genre-selection");
  if (selection) selection.classList.add("hidden");
  startReviewQuestion();
}

function refreshGenres() {
  renderGenreQuizTable();
  const suggestions = $("genre-suggestions");
  if (suggestions) {
    suggestions.innerHTML = genresInRegistrationOrder()
      .map((genre) => `<option value="${escapeHtml(genre)}"></option>`)
      .join("");
  }
}

function genresInRegistrationOrder() {
  const firstSeen = new Map();
  const order = new Map();
  problems.forEach((problem) => {
    const genre = problem.genre || "未分類";
    if (!firstSeen.has(genre)) firstSeen.set(genre, firstSeen.size);
    const value = Number(problem.genre_order);
    if (problem.genre_order !== null && problem.genre_order !== undefined && Number.isFinite(value)) {
      order.set(genre, Math.min(order.get(genre) ?? value, value));
    }
  });
  return [...firstSeen.keys()].sort((a, b) =>
    (order.get(a) ?? firstSeen.get(a)) - (order.get(b) ?? firstSeen.get(b))
    || firstSeen.get(a) - firstSeen.get(b)
  );
}

function renderGenreQuizTable() {
  const target = $("genre-quiz-rows");
  if (!target) return;
  const history = loadHistory();
  target.innerHTML = genresInRegistrationOrder().map((genre) => {
    const matching = problems.filter((problem) => (problem.genre || "未分類") === genre);
    const unseen = matching.filter((problem) => !history[problem.id]?.attempts?.length);
    const attempts = matching.flatMap((problem) => history[problem.id]?.attempts || []);
    const correct = attempts.filter((attempt) => attempt.correct).length;
    const accuracy = attempts.length ? `${Math.round(correct / attempts.length * 100)}%` : "未回答";
    return `<tr>
      <td>
        <strong>${escapeHtml(genre)}</strong>
        <small>全${matching.length}問</small>
      </td>
      <td><b>${unseen.length}</b>問</td>
      <td>${accuracy}<small>${attempts.length ? `${correct}/${attempts.length}` : ""}</small></td>
      <td><button type="button" class="primary start-genre" data-genre="${escapeHtml(genre)}">出題</button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="4">登録済みの問題がありません。</td></tr>`;
  document.querySelectorAll(".start-genre").forEach((button) => {
    button.addEventListener("click", () => startGenreQuestion(button.dataset.genre));
  });
  const due = dueReviewProblems(history);
  $("review-due-count").textContent = `復習 ${due.length}問`;
  $("review-question").disabled = due.length === 0;
  $("random-question").disabled = problems.length === 0;
}

function startGenreQuestion(genre) {
  const history = loadHistory();
  const matching = problems.filter((problem) => (problem.genre || "未分類") === genre);
  const unseen = matching.filter((problem) => !history[problem.id]?.attempts?.length);
  currentQuizContext = { mode: "genre", genre };
  showQuestionFromPool(unseen.length ? unseen : matching, false);
}

function unseenProblems(history = loadHistory()) {
  return problems.filter((problem) => !history[problem.id]?.attempts?.length);
}

function startRandomQuestion() {
  currentQuizContext = { mode: "random" };
  showQuestionFromPool(problems, false);
}

function dueReviewProblems(history = loadHistory()) {
  const now = Date.now();
  return problems
    .filter((problem) => {
      const item = history[problem.id];
      return item?.attempts?.length && Number(item.dueAt || 0) <= now;
    })
    .sort((a, b) => history[a.id].dueAt - history[b.id].dueAt);
}

function startReviewQuestion() {
  const pool = dueReviewProblems().slice(0, 8);
  currentQuizContext = { mode: "review" };
  showQuestionFromPool(pool, true);
}

function showQuizQuestionMode() {
  const selection = $("quiz-genre-selection");
  if (selection) selection.classList.add("hidden");
}

function showQuestionFromPool(pool, reviewMode) {
  if (!pool.length) {
    $("question-card").classList.add("hidden");
    $("quiz-empty").classList.remove("hidden");
    $("quiz-empty").textContent = currentQuizContext?.mode === "random"
      ? "未回答の問題がありません。"
      : reviewMode
        ? "現在、復習期限を迎えた問題はありません。"
        : "このジャンルには問題がありません。";
    return;
  }
  currentProblem = pool[Math.floor(Math.random() * pool.length)];
  const history = loadHistory();
  renderQuestion(currentProblem, history[currentProblem.id]);
}

function renderQuestion(problem, state) {
  $("quiz-empty").classList.add("hidden");
  $("question-card").classList.remove("hidden");
  $("question-genre").textContent = "";
  $("question-genre").classList.add("hidden");
  $("question-status").textContent = state?.attempts?.length ? `出題 ${state.attempts.length}回目` : "初見";
  $("question-next-cta").classList.add("hidden");
  $("answer-result").className = "result hidden";
  $("answer-result").innerHTML = "";
  $("quiz-simulator-result").className = "simulator-result hidden";
  $("quiz-simulator-result").innerHTML = "";
  $("question-prompt-note").textContent = problem.prompt_note || "";
  $("question-prompt-note").classList.toggle("hidden", !problem.prompt_note);
  $("skip-review-question").classList.toggle("hidden", currentQuizContext?.mode !== "review");
  $("skip-review-question").classList.toggle("hidden", currentQuizContext?.mode !== "review");
  const doraIndicators = problem.settings?.dora_indicators || [];
  const doraHtml = doraIndicators.length
    ? `<div class="question-dora"><span>ドラ表示牌</span><div class="concealed-hand">${doraIndicators.map((tile) => `
        <span class="dora-tile">${tileImage(tile)}</span>
      `).join("")}</div></div>`
    : "";
  $("hand").innerHTML = `<div class="question-topline">${doraHtml}</div><div class="concealed-hand">${parseMpsz(problem.hand).map((tile) => `
    <button class="tile" data-tile="${tile}" title="${tile}">
      ${tileImage(tile)}
    </button>
  `).join("")}</div>${renderMelds(problem.melds || [])}`;
  $("hand").querySelectorAll("button.tile[data-tile]").forEach((button) => {
    button.addEventListener("click", () => answerQuestion(button.dataset.tile, button));
  });
}

function answerQuestion(tile, clickedButton) {
  if (!currentProblem) return;
  const answers = currentProblem.answers || [currentProblem.primary_answer];
  const correct = answers.some((answer) => samePhysicalTile(answer, tile));
  $("hand").querySelectorAll("button.tile[data-tile]").forEach((button) => {
    button.disabled = true;
    if (answers.some((answer) => samePhysicalTile(answer, button.dataset.tile))) {
      button.classList.add("correct");
    }
  });
  if (!correct) clickedButton.classList.add("wrong");
  const dueAt = recordAttempt(currentProblem, correct);
  const result = $("answer-result");
  result.className = `result ${correct ? "correct" : "wrong"}`;
  const answerText = answers.join("・");
  const dueText = dueAt <= Date.now() + 1000
    ? "すぐに復習対象になります"
    : `次回: ${new Date(dueAt).toLocaleString("ja-JP")}`;
  $("question-genre").textContent = currentProblem.genre || "未分類";
  $("question-genre").classList.remove("hidden");
  result.innerHTML = `<strong>${correct ? "正解" : "不正解"}</strong>
    <p>ジャンル: ${escapeHtml(currentProblem.genre || "未分類")}</p>
    <p>正解として設定された打牌: ${escapeHtml(answerText)} ／ ${escapeHtml(dueText)}</p>
    ${currentProblem.note ? `<p>${escapeHtml(currentProblem.note)}</p>` : ""}
    <div class="result-actions">
      <button id="edit-current-problem" type="button">問題編集</button>
      <button id="continue-question" type="button" class="primary">次の問題</button>
    </div>`;
  $("edit-current-problem").addEventListener("click", () => openProblemInManager(currentProblem.id));
  $("continue-question").addEventListener("click", continueQuestion);
  $("continue-question-inline").addEventListener("click", continueQuestion);
  $("question-next-cta").classList.remove("hidden");
  renderSimulatorTable(
    $("quiz-simulator-result"),
    currentProblem.simulator,
    answers,
    tile
  );
  renderGenreQuizTable();
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
  const now = Date.now();
  const state = history[problem.id] || { attempts: [] };
  const previous = state.attempts[state.attempts.length - 1];
  let dueAt;
  if (!correct) {
    dueAt = now;
  } else if (!previous) {
    dueAt = now + 7 * DAY;
  } else if (!previous.correct) {
    dueAt = now + DAY;
  } else {
    const elapsedDays = Math.max(0, (now - previous.at) / DAY);
    dueAt = now + (elapsedDays * 3 + 1) * DAY;
  }
  state.attempts.push({ at: now, correct, genre: problem.genre || "未分類" });
  state.dueAt = dueAt;
  history[problem.id] = state;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  return dueAt;
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "{}"); }
  catch { return {}; }
}

function bindStats() {
  $("reset-history").addEventListener("click", () => {
    if (confirm("この端末の学習履歴をすべて削除しますか？")) {
      localStorage.removeItem(HISTORY_KEY);
      renderStats();
    }
  });
}

function renderStats() {
  const history = loadHistory();
  const byGenre = {};
  const attempts = [];
  Object.values(history).forEach((state) => {
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
  drawOverallChart(attempts);
  renderGenreChartFilters(attempts);
  drawDailyChart(attempts);
}

function drawOverallChart(attempts) {
  const points = attempts.map((attempt, index) => {
    const window = attempts.slice(Math.max(0, index - 299), index + 1);
    const correct = window.filter((item) => item.correct).length;
    return { label: String(index + 1), value: correct / window.length };
  });
  drawLineChart($("overall-chart"), [{ name: "直近300解答", color: "#23745a", points }], false);
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

function drawDailyChart(attempts) {
  const daily = {};
  attempts.forEach((attempt) => {
    const date = new Date(attempt.at).toLocaleDateString("sv-SE");
    daily[date] ||= { total: 0, correct: 0 };
    daily[date].total++;
    if (attempt.correct) daily[date].correct++;
  });
  const points = Object.entries(daily).sort().map(([date, value]) => ({
    label: date.slice(5),
    value: value.correct / value.total,
  }));
  drawLineChart($("daily-chart"), [{ name: "日付別", color: "#386fa4", points }], false);
}

async function loadProblems() {
  try {
    const stored = localStorage.getItem(PROBLEMS_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      if (Array.isArray(data)) {
        problems = data;
      } else if (Array.isArray(data.problems)) {
        problems = data.problems;
      }
    }
  } catch (error) {
    console.error("Failed to load problems:", error);
  }
  refreshGenres();
  renderAdminProblems();
}

async function saveProblems() {
  localStorage.setItem(PROBLEMS_KEY, JSON.stringify(problems));
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
  $("admin-tolerance").addEventListener("input", updateToleranceHint);
  ["manage-genre-filter", "manage-date-from", "manage-date-to", "manage-source-filter", "manage-text-filter"]
    .forEach((id) => $(id).addEventListener("input", renderAdminProblems));
  $("select-filtered-button").addEventListener("click", selectFilteredProblems);
  $("bulk-delete-button").addEventListener("click", bulkDeleteProblems);
  $("bulk-genre-button").addEventListener("click", bulkChangeGenre);
  ["admin-hand", "admin-melds", "admin-dora", "admin-answer"].forEach((id) =>
    $(id).addEventListener("input", () => {
      if (id === "admin-melds") pendingMeldTiles = [];
      renderAllInputPreviews();
    })
  );
  updateToleranceHint();
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
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value || "0000";
  const month = parts.find((part) => part.type === "month")?.value || "00";
  const day = parts.find((part) => part.type === "day")?.value || "00";
  return `${year}-${month}-${day}`;
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
    if (!verification.is_accepted) {
      throw new Error(
        `指定解答には${formatPercent(verification.required_tolerance_percent)}%の許容乖離率が必要です。`
      );
    }
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
    tolerance_percent: payload.tolerance_percent,
    note: payload.note,
    prompt_note: payload.prompt_note,
    genre_order: genreOrderFor(payload.genre),
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
    simulator: verification?.simulation || null,
    unverified: !verification,
  };
}

async function verifyWithWasm() {
  setAdminMessage("シミュレーターを実行しています。", "busy");
  try {
    const verification = await runWasmVerification();
    $("admin-tolerance").value = toleranceInputValue(verification.required_tolerance_percent);
    updateToleranceHint();
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
  return {
    hand: tilesToMpszClient(hand),
    answers,
    answer: answers[0],
    blocks: describeBlocksClient(hand),
    melds,
    melds_text: melds.map((meld) => meld.mpsz).join(" "),
    is_optimal: required <= 1e-9,
    is_accepted: required <= payload.tolerance_percent + 1e-9,
    answer_gaps: answerGaps,
    required_tolerance_percent: required,
    allowed_tolerance_percent: payload.tolerance_percent,
    simulation,
  };
}

async function analyzeWithWasm(handText, melds, payload) {
  const requestKey = buildWasmRequestKey(handText, melds, payload);
  const mode = wasmModeForRequest(requestKey);
  const raw = await wasmAnalyze({
    __wasmRequestKey: requestKey,
    round_wind: tileIndex(payload.round_wind),
    seat_wind: tileIndex(payload.seat_wind),
    dora_indicators: parseMpsz(payload.dora).map(tileIndex),
    hand: parseMpsz(handText).map(tileIndex),
    melds: melds.map((meld) => ({
      type: meld.type,
      tiles: meld.tiles.map(tileIndex),
    })),
    enable_reddora: true,
    enable_uradora: false,
    enable_shanten_down: mode.flags.enable_shanten_down,
    enable_tegawari: mode.flags.enable_tegawari,
    objective: 2,
  });
  return summarizeWasmResult(raw, payload.turn);
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

function buildWasmRequestKey(handText, melds, payload) {
  return JSON.stringify({
    hand: String(handText || ""),
    melds: (melds || []).map((meld) => meld.mpsz || tilesToMpszClient(meld.tiles || [])).join(" "),
    turn: Number(payload?.turn || 0),
    round_wind: payload?.round_wind || "",
    seat_wind: payload?.seat_wind || "",
    dora: String(payload?.dora || ""),
    objective: Number(payload?.objective || 2),
  });
}

function wasmModeForRequest(requestKey) {
  if (wasmActiveRequestKey !== requestKey) {
    wasmActiveRequestKey = requestKey;
    wasmActiveRequestMode = {
      degraded: false,
      fallbackReason: "",
      flags: { ...WASM_DEFAULT_FLAGS },
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

async function runWasmRequest(payload, allowRetry = true) {
  if (!wasmWorker || wasmWorkerUseCount >= WASM_RECYCLE_AFTER) {
    resetWasmWorker();
    createWasmWorker();
  }
  const requestKey = payload.__wasmRequestKey || null;
  const mode = requestKey
    ? wasmModeForRequest(requestKey)
    : { degraded: false, fallbackReason: "", flags: { ...WASM_DEFAULT_FLAGS } };
  if (!requestKey) {
    wasmActiveRequestMode = { degraded: false, fallbackReason: "", flags: { ...WASM_DEFAULT_FLAGS } };
  }
  const requestPayload = {
    ...payload,
    enable_shanten_down: mode.flags.enable_shanten_down,
    enable_tegawari: mode.flags.enable_tegawari,
  };
  try {
    return await new Promise((resolve, reject) => {
      const id = ++wasmRequestId;
      const timer = setTimeout(() => {
        wasmRequests.delete(id);
        resetWasmWorker();
        reject(new Error("シミュレーターの計算が時間内に完了しませんでした。"));
      }, WASM_REQUEST_TIMEOUT);
      wasmRequests.set(id, { resolve, reject, timer });
      wasmWorker.postMessage({ id, payload: requestPayload });
    });
  } catch (error) {
    if (!allowRetry || !isRecoverableWasmError(error)) throw error;
    if (requestKey) {
      wasmActiveRequestMode = {
        degraded: true,
        fallbackReason: error?.message || String(error),
        flags: {
          enable_shanten_down: false,
          enable_tegawari: false,
        },
      };
    }
    resetWasmWorker();
    createWasmWorker();
    return runWasmRequest(payload, false);
  }
}

function wasmAnalyze(payload) {
  const queued = wasmQueue.then(() => runWasmRequest(payload));
  wasmQueue = queued.catch(() => {});
  return queued;
}

function summarizeWasmResult(raw, turn) {
  lastWasmMode = wasmActiveRequestMode || { degraded: false, fallbackReason: "", flags: { ...WASM_DEFAULT_FLAGS } };
  const code = (index) => {
    if (index < 9) return `${index + 1}m`;
    if (index < 18) return `${index - 8}p`;
    if (index < 27) return `${index - 17}s`;
    if (index < 34) return `${index - 26}z`;
    return `0${"mps"[index - 34]}`;
  };
  const at = (values) => Number(values?.[Math.min(Math.max(1, turn), values.length - 1)] || 0);
  const rows = (raw.stats || []).filter((stat) => stat.tile >= 0).map((stat) => ({
    tile: code(stat.tile),
    metric: at(stat.exp_score),
    expected_score: at(stat.exp_score),
    win_probability: at(stat.win_prob),
    tenpai_probability: at(stat.tenpai_prob),
    ukeire: (stat.necessary_tiles || []).reduce((sum, item) => sum + item.count, 0),
    necessary_tiles: (stat.necessary_tiles || []).map((item) => ({ tile: code(item.tile), count: item.count })),
    shanten: stat.shanten,
  })).sort((a, b) => b.metric - a.metric);
  const best = rows[0]?.metric || 0;
  return {
    version: "0.9.6-wasm",
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
    genre_order: genreOrderFor($("admin-genre").value),
    turn: Number($("admin-turn").value),
    round_wind: $("admin-round-wind").value,
    seat_wind: $("admin-seat-wind").value,
    dora: $("admin-dora").value,
    count: Number($("admin-count").value),
    tolerance_percent: Number($("admin-tolerance").value),
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
  records.forEach((record) => {
    const key = canonicalProblemKey(record);
    if (!existing.has(key)) {
      problems.push(record);
      existing.add(key);
    }
  });
  await saveProblems();
  renderAdminProblems();
  refreshGenres();
}

async function generateWithWasm() {
  setAdminMessage("シミュレーターで類題候補を検証しています。", "busy");
  try {
    const toleranceWasBlank = !String($("admin-tolerance").value || "").trim();
    const sourceVerification = await runWasmVerification();
    if (toleranceWasBlank) {
      $("admin-tolerance").value = toleranceInputValue(sourceVerification.required_tolerance_percent);
      updateToleranceHint();
    }
    const payload = adminPayload();
    const canRegisterSource = sourceVerification.required_tolerance_percent <= payload.tolerance_percent + 1e-9;
    const sourceKey = canonicalProblemKey({
      hand: sourceVerification.hand,
      melds_text: sourceVerification.melds_text,
    });
    let sourceProblem = problems.find((problem) => canonicalProblemKey(problem) === sourceKey);
    const pending = [];
    if (!sourceProblem) {
      if (!canRegisterSource) {
        const proceed = confirm("元問題はこの許容乖離率では登録できません。元問題を登録せずに類題生成を続けますか？");
        if (!proceed) return;
        sourceProblem = { id: null };
      } else {
        sourceProblem = manualProblemFromForm(sourceVerification);
        pending.push(sourceProblem);
      }
    }
    const requested = Math.max(1, Math.min(100, payload.count || 10));
    const specs = enumerateTransformSpecs(sourceVerification.hand);
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
          spec
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
          payload
        );
        if (simulation?.solver_mode?.degraded) fallbackUsed = true;
        const answerGaps = calculateAnswerGaps(simulation, candidate.answers);
        if (Math.max(...Object.values(answerGaps)) > payload.tolerance_percent + 1e-9) continue;
        qualified.push({
          id: crypto.randomUUID(),
          hand: candidate.hand,
          answers: candidate.answers,
          primary_answer: candidate.answers[0],
          tolerance_percent: payload.tolerance_percent,
          answer_gaps: answerGaps,
          melds: candidate.melds,
          melds_text: candidate.melds.map((meld) => meld.mpsz).join(" "),
          genre: payload.genre.trim() || "未分類",
          genre_order: payload.genre_order,
          note: payload.note.trim(),
          prompt_note: payload.prompt_note.trim(),
          source_id: sourceProblem.id,
          transform: candidate.spec,
          created_at: new Date().toISOString(),
          settings: {
            turn: payload.turn,
            round_wind: payload.round_wind,
            seat_wind: payload.seat_wind,
            dora_indicators: parseMpsz(payload.dora),
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
      `${candidates.length}候補を検証し、条件を満たした${qualified.length}問からランダムに${accepted.length}問を登録しました。${sourceProblem.id ? "元問題も登録済みです。" : "元問題は未登録です。"}${degreeText}。重複除外: ${skippedDuplicates}問。${fallbackUsed ? "一部の候補はシャンテン戻し・手替わりを無効化して検証しました。" : ""}`,
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
  $("verification-result").innerHTML = `
    <h3>${data.is_optimal ? "指定解答は最適解" : "指定解答の乖離を確認"}</h3>
    <p>ブロック: ${(data.blocks || []).map(escapeHtml).join(" / ")}</p>
    <p>副露: ${data.melds_text ? escapeHtml(data.melds_text) : "なし"}</p>
    <p>最適打: ${(data.simulation?.best_discards || []).join("・")}</p>
    <p>指定解答の乖離率: ${escapeHtml(gaps)}</p>
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
    return `<details class="generated-result">
      <summary><span class="generated-summary">
        <span class="generated-hand">${parseMpsz(problem.hand).map(tileImage).join("")}${renderMelds(problem.melds || [])}</span>
        <span class="generated-metrics">
          <b>解答 ${answers.map(escapeHtml).join("・")}</b><br>
          1位 ${escapeHtml(best?.tile || "-")}: 期待値 ${formatNumber(best?.expected_score)}<br>
          ${answerSummary}
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
  const problemCount = $("create-problem-count");
  if (problemCount) problemCount.textContent = `${problems.length}問`;
  const manageProblemCount = $("manage-problem-count");
  if (manageProblemCount) manageProblemCount.textContent = `${problems.length}問`;
  refreshGenres();
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
  }));
  managementRows.innerHTML = filteredManagementProblems.map((problem) => {
    const source = problems.find((item) => item.id === problem.source_id);
    const selected = problem.id === selectedManagedProblemId;
    return `<tr data-id="${problem.id}" class="${selected ? "selected-problem-row" : ""}">
      <td><input class="problem-select" type="checkbox" value="${problem.id}" ${selected ? "checked" : ""}></td>
      <td><button class="problem-link" type="button" data-id="${problem.id}">${escapeHtml(problem.hand)}</button></td>
      <td>${escapeHtml(problem.genre || "未分類")}</td>
      <td>${formatDate(problem.created_at)}</td>
      <td>${source ? escapeHtml(source.hand) : "元問題"}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="5">登録済みの問題がありません。</td></tr>`;
  document.querySelectorAll(".problem-link").forEach((button) =>
    button.addEventListener("click", () => {
      selectedManagedProblemId = button.dataset.id;
      renderAdminProblems();
      previewProblem(button.dataset.id);
    })
  );
  document.querySelectorAll(".sort-th").forEach((button) => {
    const key = button.dataset.sort;
    button.classList.toggle("active", managementSort.key === key);
    button.addEventListener("click", () => {
      if (managementSort.key === key) {
        managementSort.direction = managementSort.direction === "asc" ? "desc" : "asc";
      } else {
        managementSort.key = key;
        managementSort.direction = key === "created_at" ? "desc" : "asc";
      }
      renderAdminProblems();
    });
  });
  renderGenreOrderEditor();
}

function setAdminMessage(text, type) {
  $("admin-message").className = `message ${type}`;
  $("admin-message").textContent = text;
}

function selectedProblemIds() {
  return [...document.querySelectorAll(".problem-select:checked")].map((input) => input.value);
}

function selectFilteredProblems() {
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
  await saveProblems();
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

function sortManagementProblems(items) {
  const { key, direction } = managementSort;
  const factor = direction === "asc" ? 1 : -1;
  const sortValue = (problem) => {
    if (key === "hand") return String(problem.hand || "");
    if (key === "genre") return String(problem.genre || "未分類");
    if (key === "created_at") return String(problem.created_at || "");
    if (key === "source") {
      const source = problems.find((item) => item.id === problem.source_id);
      return source ? String(source.hand || "") : "元問題";
    }
    return "";
  };
  return [...items].sort((a, b) => {
    const av = sortValue(a);
    const bv = sortValue(b);
    if (key === "created_at") return (Date.parse(av || 0) - Date.parse(bv || 0)) * factor;
    return av.localeCompare(bv, "ja") * factor;
  });
}

async function moveGenre(index, direction) {
  const genres = genresInRegistrationOrder();
  const destination = index + direction;
  if (destination < 0 || destination >= genres.length) return;
  [genres[index], genres[destination]] = [genres[destination], genres[index]];
  const order = new Map(genres.map((genre, orderIndex) => [genre, orderIndex]));
  problems.forEach((problem) => problem.genre_order = order.get(problem.genre || "未分類"));
  await saveProblems();
  renderAdminProblems();
  refreshGenres();
}

function previewProblem(problemId) {
  const problem = problems.find((item) => item.id === problemId);
  if (!problem) return;
  selectedManagedProblemId = problemId;
  const preview = $("problem-preview");
  preview.classList.remove("hidden");
  preview.innerHTML = `
    <div class="section-heading"><h3>問題編集</h3><button id="close-preview">閉じる</button></div>
    <div class="preview-hand">${parseMpsz(problem.hand).map(tileImage).join("")}${renderMelds(problem.melds || [])}</div>
    <p>登録日: ${formatDate(problem.created_at)}</p>
    <p>加工元: ${problem.source_id ? escapeHtml(problems.find((item) => item.id === problem.source_id)?.hand || "不明") : "元問題"}</p>
    <div class="problem-edit-form">
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
    };
    const duplicate = problems.find(
      (item) => item.id !== problem.id && canonicalProblemKey(item) === canonicalProblemKey(candidate)
    );
    if (duplicate) throw new Error("同じ手牌と副露の問題はすでに登録されています。");
    const payload = problemPayload(candidate);
    const simulation = await analyzeWithWasm(candidate.hand, melds, payload);
    const answerGaps = calculateAnswerGaps(simulation, answers);
    Object.assign(problem, candidate, {
      note: $("preview-note").value.trim(),
      prompt_note: $("preview-prompt-note").value.trim(),
      simulator: simulation,
      answer_gaps: answerGaps,
      unverified: false,
    });
    await saveProblems();
    refreshGenres();
    renderAdminProblems();
    previewProblem(problem.id);
    const savedMessage = $("preview-edit-message");
    savedMessage.className = "message ok";
    savedMessage.textContent = "変更を保存しました。";
  } catch (error) {
    message.className = "message error";
    message.textContent = error.message;
  }
}

async function deleteEditedProblem(problem) {
  if (!confirm("この問題を削除しますか？")) return;
  problems = problems.filter((item) => item.id !== problem.id);
  const history = loadHistory();
  delete history[problem.id];
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  selectedManagedProblemId = null;
  await saveProblems();
  $("problem-preview").classList.add("hidden");
  renderAdminProblems();
  refreshGenres();
}

async function dumpProblems() {
  try {
    const exportMsg = $("export-message");
    const base64Output = $("base64-output");
    const history = loadHistory();
    const data = {
      v: 3,
      p: problems,
      h: history,
    };
    const sourceBytes = new TextEncoder().encode(JSON.stringify(data));
    const compressedBytes = await compressBytes(sourceBytes);
    const base64 = `NK3:${toBase64(compressedBytes, true)}`;
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

function resetAllData() {
  if (!confirm("問題データと学習記録を含む、このアプリの保存データをすべて削除しますか？")) return;
  localStorage.clear();
  location.reload();
}

async function restoreDump(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = await decodeSaveData(text);
    if (data?.v === 3 && Array.isArray(data.p)) {
      problems = data.p;
      localStorage.setItem(HISTORY_KEY, JSON.stringify(data.h || {}));
      await saveProblems();
    } else if (Array.isArray(data)) {
      problems = data;
      await saveProblems();
    } else if (Array.isArray(data.problems)) {
      problems = data.problems;
      if (data.history) {
        localStorage.setItem(HISTORY_KEY, data.history);
      }
      await saveProblems();
    } else if (data.localStorage && typeof data.localStorage === "object") {
      restoreLocalStorageSnapshot(data.localStorage);
      const stored = localStorage.getItem(PROBLEMS_KEY);
      problems = stored ? JSON.parse(stored) : [];
      await saveProblems();
    } else {
      throw new Error("復元できるデータではありません。");
    }
    renderAdminProblems();
    refreshGenres();
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
  renderAllInputPreviews();
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
  updateToleranceHint();
  let melds = [];
  try { melds = parseMeldsClient($("admin-melds").value); } catch {}
  $("meld-preview").innerHTML = `${renderMelds(melds)}
    ${pendingMeldTiles.length ? `<div class="concealed-hand">${pendingMeldTiles.map(tileImage).join("")}</div>` : ""}
    ${!melds.length && !pendingMeldTiles.length ? '<span class="empty-preview">副露なし</span>' : ""}`;
}

function updateToleranceHint() {
  const target = $("tolerance-hint");
  if (!target) return;
  const raw = String($("admin-tolerance")?.value || "").trim();
  target.textContent = raw ? "" : "空欄なら自動で検証して設定します。";
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

function tilesToMpszClient(tiles) {
  return "mpsz".split("").map((suit) => {
    const ranks = tiles
      .filter((tile) => tile[1] === suit)
      .map((tile) => tile[0])
      .sort((a, b) => tileRank(`${a}${suit}`) - tileRank(`${b}${suit}`) || Number(a === "0") - Number(b === "0"));
    return ranks.length ? `${ranks.join("")}${suit}` : "";
  }).join("");
}

function splitBlocksClient(hand) {
  const tiles = Array.isArray(hand) ? parseMpsz(tilesToMpszClient(hand)) : parseMpsz(hand);
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

function enumerateTransformSpecs(hand) {
  const blocks = splitBlocksClient(hand);
  const suitMaps = [
    { m: "m", p: "p", s: "s" },
    { m: "m", p: "s", s: "p" },
    { m: "p", p: "m", s: "s" },
    { m: "p", p: "s", s: "m" },
    { m: "s", p: "m", s: "p" },
    { m: "s", p: "p", s: "m" },
  ];
  const specs = [];
  const seen = new Set();
  const movableBlocks = blocks.filter((block) => block.suit !== "z");
  const slideState = {};
  const emitSlides = (index) => {
    if (index >= movableBlocks.length) {
      suitMaps.forEach((suitMap) => {
        [false, true].forEach((reverse) => {
          const key = JSON.stringify([suitMap.m, suitMap.p, suitMap.s, reverse, slideState]);
          if (seen.has(key)) return;
          seen.add(key);
          const degree = ["m", "p", "s"].filter((suit) => suitMap[suit] !== suit).length
            + Number(reverse)
            + Object.values(slideState).filter((delta) => delta !== 0).length;
          if (!degree) return;
          specs.push({ suit_map: { ...suitMap }, reverse, slides: { ...slideState }, degree });
        });
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

function randomTransformSpecs(hand, limit = null) {
  const specs = enumerateTransformSpecs(hand);
  shuffleArray(specs);
  return Number.isFinite(limit) ? specs.slice(0, limit) : specs;
}

function transformProblem(hand, answers, melds, spec) {
  const output = [];
  const convertedByTile = {};
  splitBlocksClient(hand).forEach((block) => {
    const delta = Number(spec.slides[block.index] || 0);
    if (!block.slideOptions.includes(delta)) throw new Error("許可されないスライドです");
    block.tiles.forEach((tile) => {
      const wasRed = tile[0] === "0";
      let rank = tileRank(tile);
      let suit = tile[1];
      if (suit !== "z") {
        rank += delta;
        if (spec.reverse) rank = 10 - rank;
        suit = spec.suit_map[suit];
      }
      const converted = `${wasRed && rank === 5 ? 0 : rank}${suit}`;
      output.push(converted);
      convertedByTile[tile] = converted;
    });
  });
  const counts = countTiles(output);
  if (Object.values(counts).some((count) => count > 4)) {
    throw new Error("変換により同じ牌が5枚以上になります");
  }
  const transformedAnswers = [...new Set(answers.map((answer) => convertedByTile[answer]))];
  if (transformedAnswers.some((answer) => !answer)) throw new Error("解答牌を変換できません");
  const transformedMelds = melds.map((meld) => {
    const tiles = meld.tiles.map((tile) => {
      const wasRed = tile[0] === "0";
      let rank = tileRank(tile);
      let suit = tile[1];
      if (suit !== "z") {
        if (spec.reverse) rank = 10 - rank;
        suit = spec.suit_map[suit];
      }
      return `${wasRed && rank === 5 ? 0 : rank}${suit}`;
    });
    const mpsz = tilesToMpszClient(tiles);
    return { type: meld.type, name: meld.type === 0 ? "ポン" : "チー", tiles: parseMpsz(mpsz), mpsz };
  });
  return {
    hand: tilesToMpszClient(output),
    answers: transformedAnswers,
    melds: transformedMelds,
  };
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
  container.classList.remove("hidden");
  container.innerHTML = `
    <div class="simulator-heading">
      <div>
        <span class="eyebrow">何切るシミュレーター結果</span>
        <h3>何切るシミュレーター結果</h3>
      </div>
      <span>${simulation.turn}局目・${simulation.shanten?.all ?? "-"}シャンテン</span>
    </div>
    ${simulation.solver_mode?.degraded ? `<p class="sim-warning">この結果は、シャンテン戻し・手替わりを無効化した状態で計算しています。</p>` : ""}
    <div class="sim-table-wrap">
      <table class="sim-table">
        <thead>
          <tr>
            <th>切る牌</th>
            <th>必要牌</th>
            <th>聴牌率</th>
            <th>和了率</th>
            <th>期待値</th>
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
              <td><b>${formatNumber(row.expected_score)}</b><small class="relative-score">${relative.toFixed(2)}%</small></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>
    <p class="sim-legend">上棒が最良手、強調表示が指定解答です。必要牌は牌画像で表示します。</p>
  `;
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

function toleranceInputValue(value) {
  const numeric = Math.max(0, Number(value || 0));
  if (numeric <= 1e-12) return "0";
  const step = 0.0001;
  return (Math.floor(numeric / step + 1e-9) * step + step)
    .toFixed(4)
    .replace(/\.?0+$/, "");
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
  const value = text.trim();
  if (value.startsWith("NK3:")) {
    const compressed = fromBase64(value.slice(4), true);
    const decoded = await decompressBytes(compressed);
    return JSON.parse(new TextDecoder().decode(decoded));
  }
  try {
    return JSON.parse(value);
  } catch {
    const decoded = new TextDecoder().decode(fromBase64(value));
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

async function decompressBytes(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("このブラウザはデータの復元に対応していません。ブラウザを最新版に更新してください。");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
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
