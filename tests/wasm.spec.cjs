const { test, expect } = require("@playwright/test");
const zlib = require("node:zlib");

test("mahjong wasm runs in a browser", async ({ page }) => {
  const cspViolations = [];
  page.on("console", (message) => { if (/Content Security Policy|Refused to/i.test(message.text())) cspViolations.push(message.text()); });
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(() => new Promise((resolve, reject) => {
    const worker = new Worker("wasm/worker.js", { type: "module" });
    const timer = setTimeout(() => reject(new Error("WASM worker timeout")), 180000);
    worker.onmessage = (event) => {
      clearTimeout(timer);
      worker.terminate();
      event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result);
    };
    worker.onerror = (event) => reject(new Error(event.message));
    worker.postMessage({
      id: 1,
      payload: {
        round_wind: 27,
        seat_wind: 28,
        dora_indicators: [],
        hand: [4, 5, 13, 14, 16, 17, 21, 21, 23, 23, 24, 33, 33, 33],
        melds: [],
        enable_reddora: true,
        enable_uradora: false,
        enable_shanten_down: true,
        enable_tegawari: true,
        objective: 2,
      },
    });
  }));
  expect(result.success).toBe(true);
  expect(result.stats).toHaveLength(10);
  const ranked = [...result.stats].sort((a, b) => b.exp_score[6] - a.exp_score[6]);
  expect(ranked[0].tile).toBe(16);
  expect(ranked[1].tile).toBe(17);
  expect(ranked[0].exp_score[6]).toBeCloseTo(1329.1878, 3);
  expect(cspViolations).toEqual([]);
});

test("wasm worker is recycled without breaking analysis", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(async () => {
    const payload = {
      round_wind: 27,
      seat_wind: 28,
      dora_indicators: [],
      hand: [4, 5, 13, 14, 16, 17, 21, 21, 23, 23, 24, 33, 33, 33],
      melds: [],
      enable_reddora: true,
      enable_uradora: false,
      enable_shanten_down: true,
      enable_tegawari: true,
      objective: 2,
    };
    const first = await wasmAnalyze(payload);
    const firstGeneration = wasmWorkerGeneration;
    wasmWorkerUseCount = WASM_RECYCLE_AFTER;
    const second = await wasmAnalyze(payload);
    return {
      firstSuccess: first.success,
      secondSuccess: second.success,
      firstGeneration,
      secondGeneration: wasmWorkerGeneration,
    };
  });
  expect(result.firstSuccess).toBe(true);
  expect(result.secondSuccess).toBe(true);
  expect(result.secondGeneration).toBeGreaterThan(result.firstGeneration);
});

test("problem editor defaults to graphical tile input", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  await page.evaluate(() => showView("create"));
  await expect(page.locator("#admin-count")).toHaveValue("3");
  await expect(page.locator("#admin-genre")).toHaveValue("");
  await expect(page.locator("#admin-dora")).toHaveValue("");
  await page.locator("#hand-picker .picker-tile[data-tile='1m']").click();
  await page.locator("#hand-picker .picker-tile[data-tile='2m']").click();
  await expect(page.locator("#admin-hand")).toHaveValue("12m");
  await expect(page.locator("#hand-preview img")).toHaveCount(2);
  await page.locator("#answer-picker .picker-tile[data-tile='1m']").click();
  await expect(page.locator("#admin-answer")).toHaveValue("1m");
  await expect(page.locator("#answer-preview img")).toHaveCount(1);
  await page.locator("#meld-picker .picker-tile[data-tile='1m']").click();
  await page.locator("#meld-picker .picker-tile[data-tile='2m']").click();
  await page.locator("#meld-picker .picker-tile[data-tile='3m']").click();
  await expect(page.locator("#admin-melds")).toHaveValue("123m");
  await expect(page.locator("#meld-preview img")).toHaveCount(3);
  await page.locator("#dora-picker .picker-tile[data-tile='4p']").click();
  await expect(page.locator("#admin-dora")).toHaveValue("4p");
  await expect(page.locator("#dora-preview img")).toHaveCount(1);
});

test("red fives can be entered and keep their identity", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  await page.evaluate(() => showView("create"));

  const manzuButtons = page.locator("#hand-picker .picker-tile[data-tile$='m']");
  await expect(manzuButtons).toHaveCount(10);
  await expect(manzuButtons.nth(8)).toHaveAttribute("data-tile", "9m");
  await expect(manzuButtons.nth(9)).toHaveAttribute("data-tile", "0m");
  await expect(page.locator("#answer-picker .picker-tile[data-tile^='0']")).toHaveCount(0);

  await page.locator("#hand-picker .picker-tile[data-tile='5m']").click();
  await page.locator("#hand-picker .picker-tile[data-tile='0m']").click();
  await page.locator("#hand-picker .picker-tile[data-tile='0m']").click();
  await expect(page.locator("#admin-hand")).toHaveValue("50m");
  await expect(page.locator("#hand-preview img").nth(0)).toHaveAttribute("alt", "5m");
  await expect(page.locator("#hand-preview img").nth(1)).toHaveAttribute("alt", "0m");
  await expect(page.locator("#hand-preview img").nth(1)).toHaveAttribute("src", /aka3-66-90-s\.png$/);

  const values = await page.evaluate(() => ({
    parsed: parseMpsz("50m"),
    serialized: tilesToMpszClient(["0m", "5m", "6m"]),
    redIndex: tileIndex("0m"),
    normalIndex: tileIndex("5m"),
  }));
  expect(values.parsed).toEqual(["5m", "0m"]);
  expect(values.serialized).toBe("506m");
  expect(values.redIndex).toBe(34);
  expect(values.normalIndex).toBe(4);

  const duplicateError = await page.evaluate(() => {
    try {
      validateCombinedTileCounts(parseMpsz("00m"), []);
      return "";
    } catch (error) {
      return error.message;
    }
  });
  expect(duplicateError).toContain("赤牌は各種類1枚まで");
});

test("mobile quiz and editor stay within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("http://127.0.0.1:18765/");
  await page.evaluate(() => {
    problems = Array.from({ length: 3 }, (_, index) => ({
      id: `mobile-${index}`,
      hand: "123456789m12344p",
      answers: ["1m"],
      primary_answer: "1m",
      genre: `スマホ表示確認用の長いジャンル名${index + 1}`,
      simulator: {
        best_discards: ["1m"],
        rows: Array.from({ length: 3 }, (_, rowIndex) => ({
          tile: `${rowIndex + 1}m`,
          metric: 1000 - rowIndex * 100,
          expected_score: 1000 - rowIndex * 100,
          win_probability: 0.2,
          tenpai_probability: 0.6,
          ukeire: 20,
          necessary_tiles: [],
          shanten: 2,
        })),
      },
    }));
    refreshGenres();
  });

  const genreTable = page.locator(".genre-table");
  await expect(genreTable).toBeVisible();
  expect(await genreTable.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect(page.locator(".start-genre").first()).toBeInViewport();

  await page.locator(".start-genre").first().click();
  const hand = page.locator("#hand");
  expect(await hand.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await page.locator("#hand .tile").first().evaluate((element) => element.getBoundingClientRect().width)).toBeLessThan(30);

  await page.locator("#hand .tile").first().click();
  const simulatorWrap = page.locator("#quiz-simulator-result .sim-table-wrap");
  await expect(simulatorWrap).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  expect(await simulatorWrap.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);

  await page.evaluate(() => showView("create"));
  await expect(page.locator("#hand-preview .preview-tile-slot")).toHaveCount(14);
  const previewBox = await page.locator("#hand-preview").boundingBox();
  await page.locator("#hand-picker .picker-tile[data-tile='1m']").click();
  await expect(page.locator("#hand-preview .preview-tile-slot")).toHaveCount(13);
  const previewAfter = await page.locator("#hand-preview").boundingBox();
  expect(previewAfter.height).toBe(previewBox.height);
  expect(previewAfter.width).toBe(previewBox.width);
});

test("answered problem opens selected in management and can be edited", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  await page.evaluate(() => {
    problems = [{
      id: "editable-problem",
      hand: "123456789m12344p",
      answers: ["1m"],
      primary_answer: "1m",
      genre: "編集前",
      note: "",
      prompt_note: "",
      melds: [],
      settings: {
        turn: 6,
        round_wind: "1z",
        seat_wind: "2z",
        dora_indicators: [],
        objective: 2,
      },
      simulator: {
        turn: 6,
        shanten: { all: 2 },
        best_discards: ["1m"],
        rows: [{
          tile: "1m",
          metric: 1000,
          expected_score: 1000,
          win_probability: 0.2,
          tenpai_probability: 0.6,
          ukeire: 20,
          necessary_tiles: [],
          shanten: 2,
        }],
      },
    }];
    currentQuizContext = { mode: "genre", genre: "編集前" };
    currentProblem = problems[0];
    renderQuestion(currentProblem, null);
  });

  await page.locator("#hand .tile[data-tile='1m']").click();
  await expect(page.locator("#edit-current-problem")).toBeVisible();
  await page.locator("#edit-current-problem").click();
  await expect(page.locator("#manage-view")).toBeVisible();
  await expect(page.locator(".problem-select[value='editable-problem']")).toBeChecked();
  await expect(page.locator("tr[data-id='editable-problem']")).toHaveClass(/selected-problem-row/);
  await expect(page.locator("#preview-hand-input")).toHaveValue("123456789m12344p");
  await expect(page.locator("#preview-answer-input")).toHaveValue("1m");

  await page.evaluate(() => {
    window.analyzeWithWasm = async () => ({
      version: "edit-test",
      turn: 6,
      shanten: { all: 2 },
      best_discards: ["2m"],
      rows: [{
        tile: "2m",
        metric: 1200,
        expected_score: 1200,
        win_probability: 0.22,
        tenpai_probability: 0.64,
        ukeire: 22,
        necessary_tiles: [],
        shanten: 2,
      }],
    });
  });
  await page.locator("#preview-genre").fill("編集後");
  await page.locator("#preview-hand-input").fill("223456789m12344p");
  await page.locator("#preview-answer-input").fill("2m");
  await page.locator("#save-preview-problem").click();
  await expect(page.locator("#preview-edit-message")).toContainText("変更を保存しました");
  const edited = await page.evaluate(() => problems[0]);
  expect(edited.hand).toBe("223456789m12344p");
  expect(edited.answers).toEqual(["2m"]);
  expect(edited.genre).toBe("編集後");
  expect(edited.simulator.version).toBe("edit-test");
});

test("similar-problem transforms run in the browser", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(() => {
    const hand = "45m2344779p23368s";
    const blocks = describeBlocksClient(parseMpsz(hand));
    const transformed = transformProblem(
      hand,
      ["7p", "9p"],
      parseMeldsClient("123m 777z"),
      {
        suit_map: { m: "p", p: "s", s: "m" },
        reverse: true,
        slides: {},
        degree: 4,
      }
    );
    return { blocks, transformed, specs: randomTransformSpecs(hand, 40) };
  });
  expect(result.blocks).toEqual(["45m", "2344p", "779p", "233s", "68s"]);
  expect(result.transformed.answers).toEqual(["3s", "1s"]);
  expect(result.transformed.melds.map((meld) => meld.mpsz)).toEqual(["789p", "777z"]);
  expect(result.specs).toHaveLength(40);
  expect(result.specs.every((spec) => spec.degree > 0)).toBe(true);
});

test("similar-problem generation uses the browser simulator path", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(async () => {
    showView("create");
    document.querySelector("#admin-genre").value = "WASM生成";
    document.querySelector("#admin-hand").value = "45m2344779p23368s";
    document.querySelector("#admin-answer").value = "9p";
    document.querySelector("#admin-count").value = "2";
    let registered = [];
    window.analyzeWithWasm = async (handText, melds, payload) => ({
      version: "test-wasm",
      turn: payload.turn,
      objective: 2,
      shanten: { all: 2 },
      best_discards: [...new Set(parseMpsz(handText))],
      rows: [...new Set(parseMpsz(handText))].map((tile) => ({
        tile,
        metric: 1000,
        expected_score: 1000,
        win_probability: 0.2,
        tenpai_probability: 0.6,
        ukeire: 20,
        necessary_tiles: [],
        shanten: 2,
      })),
    });
    window.registerProblems = async (records) => { registered = records; };
    await generateWithWasm();
    return {
      registered,
      message: document.querySelector("#admin-message").textContent,
    };
  });
  expect(result.registered).toHaveLength(3);
  expect(result.registered.filter((problem) => problem.source_id)).toHaveLength(2);
  expect(result.message).toContain("2問を登録");
});

test("similar-problem conditions use source tolerance, rank and fixed next-worse rank", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(() => {
    const simulation = (metrics) => ({
      rows: metrics.map(([tile, metric]) => ({ tile, metric, expected_score: metric })),
    });
    const sourceSimulation = simulation([["1m", 100], ["2m", 90], ["3m", 83], ["4m", 70]]);
    const sourceGaps = calculateAnswerGaps(sourceSimulation, ["2m"]);
    const sourceAnswerConditions = calculateAnswerConditions(sourceSimulation, ["2m"]);
    const sourceConditions = {
      tolerance_percent: Math.max(...Object.values(sourceGaps)),
      max_rank: sourceAnswerConditions.max_rank,
      next_worse_rank: sourceAnswerConditions.max_rank + 1,
      next_worse_gap_percent: sourceAnswerConditions.next_worse_gap_percent,
    };
    const accepted = evaluateSimilarProblem(
      simulation([["2m", 100], ["1m", 95], ["3m", 92], ["4m", 70]]),
      ["2m"],
      sourceConditions
    );
    const rejectedBySeparation = evaluateSimilarProblem(
      simulation([["2m", 100], ["1m", 99], ["3m", 94], ["4m", 70]]),
      ["2m"],
      sourceConditions
    );
    const rejectedByRank = evaluateSimilarProblem(
      simulation([["1m", 100], ["3m", 95], ["2m", 90], ["4m", 70]]),
      ["2m"],
      sourceConditions
    );
    const tiedAnswers = calculateAnswerConditions(
      simulation([["1m", 100], ["2m", 100], ["3m", 90]]),
      ["1m", "2m"]
    );
    const tiedBest = calculateAnswerConditions(
      simulation([["4m", 134], ["7m", 134], ["1p", 121.62]]),
      ["4m"]
    );
    const tiedCandidate = evaluateSimilarProblem(
      simulation([["4m", 134], ["7m", 134], ["1p", 121.62]]),
      ["4m"],
      { tolerance_percent: 0, max_rank: 1, next_worse_rank: 2, next_worse_gap_percent: 5 }
    );
    return { sourceConditions, accepted, rejectedBySeparation, rejectedByRank, tiedAnswers, tiedBest, tiedCandidate };
  });
  expect(result.sourceConditions.tolerance_percent).toBeCloseTo(10, 8);
  expect(result.sourceConditions.max_rank).toBe(2);
  expect(result.sourceConditions.next_worse_rank).toBe(3);
  expect(result.sourceConditions.next_worse_gap_percent).toBeCloseTo(7.7777777778, 8);
  expect(result.accepted.accepted).toBe(true);
  expect(result.accepted.conditions.max_rank).toBe(1);
  expect(result.accepted.conditions.comparison_rank).toBe(3);
  expect(result.rejectedBySeparation.separation_accepted).toBe(false);
  expect(result.rejectedByRank.rank_accepted).toBe(false);
  expect(result.tiedAnswers.max_rank).toBe(1);
  expect(result.tiedAnswers.next_worse_gap_percent).toBe(0);
  expect(result.tiedBest.max_rank).toBe(1);
  expect(result.tiedBest.comparison_rank).toBe(2);
  expect(result.tiedBest.next_worse_gap_percent).toBe(0);
  expect(result.tiedBest.boundary_tile).toBe("7m");
  expect(result.tiedCandidate.separation_accepted).toBe(false);
  expect(result.tiedCandidate.accepted).toBe(false);
});

test("save data is compressed and remains backward compatible", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(async () => {
    const data = {
      v: 3,
      p: Array.from({ length: 80 }, (_, index) => ({
        id: `problem-${index}`,
        hand: "56m5689p44667s777z",
        answers: ["8p", "9p"],
        genre: "５ブロック理論（１）",
        simulator: {
          best_discards: ["8p", "9p"],
          rows: Array.from({ length: 10 }, () => ({
            metric: 1329.1878,
            expected_score: 1329.1878,
            win_probability: 0.2311,
          })),
        },
      })),
      h: {},
    };
    const source = new TextEncoder().encode(JSON.stringify(data));
    const compressed = await compressBytes(source);
    const encoded = `NK3:${toBase64(compressed, true)}`;
    const restored = await decodeSaveData(encoded);

    const legacyData = { problems: data.p.slice(0, 1), history: "{}" };
    const legacyEncoded = toBase64(new TextEncoder().encode(JSON.stringify(legacyData)));
    const restoredLegacy = await decodeSaveData(legacyEncoded);

    return {
      encodedLength: encoded.length,
      legacyLength: toBase64(source).length,
      restoredCount: restored.p.length,
      restoredLegacyCount: restoredLegacy.problems.length,
    };
  });

  expect(result.encodedLength).toBeLessThan(result.legacyLength * 0.2);
  expect(result.restoredCount).toBe(80);
  expect(result.restoredLegacyCount).toBe(1);
});

test("oversized backup input and decompressed data are rejected", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  await page.click('#nav button[data-view="export"]');
  await page.setInputFiles("#restore-file", {
    name: "too-large.txt", mimeType: "text/plain", buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
  });
  await expect(page.locator("#restore-message")).toContainText("ファイルのサイズが上限を超えています");

  const compressed = zlib.gzipSync(Buffer.alloc(2 * 1024 * 1024));
  const message = await page.evaluate(async (base64) => {
    try { await decompressBytes(fromBase64(base64, true), 1024 * 1024); return ""; }
    catch (error) { return error.message; }
  }, compressed.toString("base64url"));
  expect(message).toContain("展開後サイズが上限を超えています");
});

test("management rows are lazy and paginated", async ({ page }) => {
  await page.addInitScript(() => {
    const problems = Array.from({ length: 450 }, (_, index) => ({
      id: `lazy-${index}`, hand: "123m123p123s11122z", answers: ["1m"], primary_answer: "1m", genre: `分類${index % 4}`,
      created_at: new Date().toISOString(), settings: { turn: 6, round_wind: "1z", seat_wind: "2z", dora_indicators: [], objective: 2 },
    }));
    localStorage.setItem("nanikiru-problems-v1", JSON.stringify(problems));
  });
  await page.goto("http://127.0.0.1:18765/");
  expect(await page.locator("#management-rows tr").count()).toBe(0);
  await page.click('#nav button[data-view="manage"]');
  expect(await page.locator("#management-rows tr").count()).toBe(200);
  await expect(page.locator("#management-page-info")).toContainText("1 / 3ページ");
  await page.click("#management-next");
  await expect(page.locator("#management-page-info")).toContainText("2 / 3ページ");
});

test("quiz shows total unseen count and random-mode remaining count", async ({ page }) => {
  await page.addInitScript(() => {
    const makeProblem = (id, genre) => ({
      id, hand: "123m123p123s11122z", answers: ["1m"], primary_answer: "1m", genre,
      created_at: new Date().toISOString(), settings: { turn: 6, round_wind: "1z", seat_wind: "2z", dora_indicators: [], objective: 2 },
    });
    localStorage.setItem("nanikiru-problems-v1", JSON.stringify([
      makeProblem("count-a", "分類A"), makeProblem("count-b", "分類A"), makeProblem("count-c", "分類B"),
    ]));
    localStorage.setItem("nanikiru-learning-v1", JSON.stringify({
      "count-c": { attempts: [{ at: Date.now() - 1000, correct: true }], dueAt: Date.now() + 86400000 },
    }));
  });
  await page.goto("http://127.0.0.1:18765/");
  await expect(page.locator(".genre-total-row")).toContainText("合計");
  await expect(page.locator(".genre-total-row")).toContainText("2問");
  await page.click("#random-question");
  await expect(page.locator("#question-status")).toContainText("残り 1問");
});

test("a first answer appears in learning activity and review interval charts", async ({ page }) => {
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem("nanikiru-problems-v1", JSON.stringify([{
      id: "first-chart", hand: "123m123p123s11122z", answers: ["1m"], primary_answer: "1m", genre: "集計確認",
      created_at: new Date().toISOString(), settings: { turn: 6, round_wind: "1z", seat_wind: "2z", dora_indicators: [], objective: 2 },
    }]));
    localStorage.setItem("nanikiru-learning-v1", JSON.stringify({
      "first-chart": { attempts: [{ at: now, correct: true, genre: "集計確認" }], dueAt: now + 7 * 86400000 },
    }));
  });
  await page.goto("http://127.0.0.1:18765/");
  const chartData = await page.evaluate(() => {
    const history = loadHistory();
    return {
      activity: buildSolveActivityPoints(history),
      scheduleTotal: buildReviewScheduleBuckets(history).reduce((sum, item) => sum + item.value, 0),
      intervalTotal: buildReviewIntervalBuckets(history).reduce((sum, item) => sum + item.value, 0),
    };
  });
  expect(chartData.activity).toHaveLength(1);
  expect(chartData.activity[0].value).toBe(1);
  expect(chartData.scheduleTotal).toBe(1);
  expect(chartData.intervalTotal).toBe(1);
});

test("problem additions are grouped by days ago with a daily average", async ({ page }) => {
  const seedNow = Date.now();
  await page.addInitScript(({ seedNow }) => {
    const makeProblem = (id, createdAt) => ({
      id, hand: "123m123p123s11122z", answers: ["1m"], primary_answer: "1m", genre: "追加集計",
      created_at: new Date(createdAt).toISOString(), settings: { turn: 6, round_wind: "1z", seat_wind: "2z", dora_indicators: [], objective: 2 },
    });
    localStorage.setItem("nanikiru-problems-v1", JSON.stringify([
      makeProblem("added-today", seedNow),
      makeProblem("added-two-days-a", seedNow - 2 * 86400000),
      makeProblem("added-two-days-b", seedNow - 2 * 86400000),
    ]));
  }, { seedNow });
  await page.goto("http://127.0.0.1:18765/");
  await page.click('#nav button[data-view="stats"]');
  await expect(page.locator("#problem-add-average")).toHaveText("平均 1.00問／日");
  await expect(page.locator("#problem-add-chart")).toBeVisible();

  const stats = await page.evaluate(() => {
    const now = Date.UTC(2026, 6, 23, 3);
    return buildProblemAdditionStats([
      { created_at: new Date(now).toISOString() },
      { created_at: new Date(now - 2 * DAY).toISOString() },
      { created_at: new Date(now - 2 * DAY).toISOString() },
      { created_at: "invalid" },
    ], now);
  });
  expect(stats.total).toBe(3);
  expect(stats.elapsedDays).toBe(3);
  expect(stats.averagePerDay).toBe(1);
  expect(stats.buckets.find((item) => item.label === "0日前").value).toBe(1);
  expect(stats.buckets.find((item) => item.label === "2日前").value).toBe(2);
});

test("the latest answer can be cancelled with its previous review schedule restored", async ({ page }) => {
  const previousAt = Date.now() - 7 * 86400000;
  const previousDueAt = Date.now() - 1000;
  await page.addInitScript(({ previousAt, previousDueAt }) => {
    localStorage.setItem("nanikiru-problems-v1", JSON.stringify([{
      id: "undo-answer", hand: "123m123p123s11122z", answers: ["1m"], primary_answer: "1m", genre: "取消確認",
      created_at: new Date().toISOString(), settings: { turn: 6, round_wind: "1z", seat_wind: "2z", dora_indicators: [], objective: 2 },
    }]));
    localStorage.setItem("nanikiru-learning-v1", JSON.stringify({
      "undo-answer": { attempts: [{ at: previousAt, correct: false, genre: "取消確認" }], dueAt: previousDueAt },
    }));
  }, { previousAt, previousDueAt });

  await page.goto("http://127.0.0.1:18765/");
  await page.locator("#hand button.tile[data-tile='2m']").click();
  await expect(page.locator("#undo-current-answer")).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("nanikiru-learning-v1"))["undo-answer"].attempts)).toHaveLength(2);

  await page.locator("#undo-current-answer").click();
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem("nanikiru-learning-v1"))["undo-answer"]);
  expect(restored).toEqual({ attempts: [{ at: previousAt, correct: false, genre: "取消確認" }], dueAt: previousDueAt });
  await expect(page.locator("#answer-result")).toBeHidden();
  await expect(page.locator("#hand button.tile[data-tile='1m']")).toBeEnabled();
  await expect(page.locator("#question-genre")).toBeHidden();
});

test("cancelling a first answer removes the new learning record", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("nanikiru-problems-v1", JSON.stringify([{
      id: "undo-first", hand: "123m123p123s11122z", answers: ["1m"], primary_answer: "1m", genre: "初回取消",
      created_at: new Date().toISOString(), settings: { turn: 6, round_wind: "1z", seat_wind: "2z", dora_indicators: [], objective: 2 },
    }]));
  });

  await page.goto("http://127.0.0.1:18765/");
  await page.locator("#random-question").click();
  await page.locator("#hand button.tile[data-tile='1m']").click();
  await page.locator("#undo-current-answer").click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("nanikiru-learning-v1") || "{}")["undo-first"])).toBeUndefined();
  await expect(page.locator("#question-status")).toContainText("初見");
  await expect(page.locator("#hand button.tile[data-tile='1m']")).toBeEnabled();
});

test("quiz display sorts red fives between five and six regardless of mpsz order", async ({ page }) => {
  await page.addInitScript(() => {
    Math.random = () => 0.99;
    localStorage.setItem("nanikiru-problems-v1", JSON.stringify([{
      id: "red-order", hand: "6057s6057p6057m11z", answers: ["5m"], primary_answer: "5m", genre: "red-order",
      created_at: new Date().toISOString(), settings: { turn: 6, round_wind: "1z", seat_wind: "2z", dora_indicators: [], objective: 2 },
    }]));
    localStorage.setItem("nanikiru-learning-v1", JSON.stringify({
      "red-order": { attempts: [{ at: Date.now() - 86400000, correct: true, genre: "red-order" }], dueAt: Date.now() - 1000 },
    }));
  });

  await page.goto("http://127.0.0.1:18765/");
  const displayedTiles = await page.locator("#hand button.tile img").evaluateAll((images) => images.map((image) => image.alt));
  expect(displayedTiles).toEqual([
    "5m", "0m", "6m", "7m",
    "5p", "0p", "6p", "7p",
    "5s", "0s", "6s",
    "1z", "1z", "7s",
  ]);
  await expect(page.locator("#hand .drawn-tile")).toHaveAttribute("data-tile", "7s");
  expect(parseFloat(await page.locator("#hand .drawn-tile").evaluate((tile) => getComputedStyle(tile).marginLeft))).toBeGreaterThan(0);
});

test("drawn tile candidates use sequence ends and triplets but not incomplete shapes", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  const selected = await page.evaluate(() => ({
    sequenceLow: selectDrawnTileForQuestion(["3m", "4m", "5m"], () => 0).drawnTile,
    sequenceHigh: selectDrawnTileForQuestion(["3m", "4m", "5m"], () => 0.99).drawnTile,
    triplet: selectDrawnTileForQuestion(["7p", "7p", "7p"], () => 0).drawnTile,
    adjacentTaatsu: selectDrawnTileForQuestion(["3s", "4s"], () => 0).drawnTile,
    gappedTaatsu: selectDrawnTileForQuestion(["3s", "5s"], () => 0).drawnTile,
  }));
  expect(selected).toEqual({
    sequenceLow: "3m",
    sequenceHigh: "5m",
    triplet: "7p",
    adjacentTaatsu: null,
    gappedTaatsu: null,
  });
});

test("only correct-to-wrong transitions count and the eighth suspends until resumed", async ({ page }) => {
  const now = Date.now();
  const attempts = [];
  for (let index = 0; index < 7; index++) {
    attempts.push({ at: now - (16 - index * 2) * 86400000, correct: true, genre: "suspension" });
    attempts.push({ at: now - (15 - index * 2) * 86400000, correct: false, genre: "suspension" });
  }
  attempts.push({ at: now - 2 * 86400000, correct: true, genre: "suspension" });
  await page.addInitScript(({ attempts }) => {
    localStorage.setItem("nanikiru-problems-v1", JSON.stringify([{
      id: "suspension", hand: "123m123p123s11122z", answers: ["1m"], primary_answer: "1m", genre: "suspension",
      created_at: new Date().toISOString(), settings: { turn: 6, round_wind: "1z", seat_wind: "2z", dora_indicators: [], objective: 2 },
    }]));
    localStorage.setItem("nanikiru-learning-v1", JSON.stringify({
      suspension: { attempts, dueAt: Date.now() - 1000 },
    }));
  }, { attempts });

  await page.goto("http://127.0.0.1:18765/");
  expect(await page.evaluate(() => wrongTransitionCount({ attempts: [
    { correct: false }, { correct: false }, { correct: true }, { correct: false }, { correct: false },
  ] }))).toBe(1);

  const dialogPromise = new Promise((resolve) => page.once("dialog", async (dialog) => {
    const message = dialog.message();
    await dialog.accept();
    resolve(message);
  }));
  await page.locator("#hand button.tile[data-tile='2m']").click();
  expect(await dialogPromise).toContain("8回");

  const suspended = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("nanikiru-learning-v1")).suspension;
    return { state, dueIds: dueReviewProblems().map((problem) => problem.id) };
  });
  expect(suspended.state.suspended).toBe(true);
  expect(suspended.state.wrongTransitionCount).toBe(8);
  expect(suspended.dueIds).not.toContain("suspension");

  await page.evaluate(() => showView("manage"));
  await expect(page.locator(".suspended-label")).toContainText("休止");
  await page.locator(".resume-problem").click();
  const resumed = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("nanikiru-learning-v1")).suspension;
    return { state, dueIds: dueReviewProblems().map((problem) => problem.id) };
  });
  expect(resumed.state.suspended).toBe(false);
  expect(resumed.state.wrongTransitionCount).toBe(0);
  expect(resumed.dueIds).toContain("suspension");
});

test("restored text cannot create script or event attributes", async ({ page }) => {
  const attacks = [
    '<img src=x onerror="window.__xss=1">',
    '"><svg onload="window.__xss=1">',
    '</textarea><script>window.__xss=1</script>',
  ];
  await page.addInitScript(({ attacks }) => {
    localStorage.setItem("nanikiru-problems-v1", JSON.stringify([{
      id: "xss-safe-id", hand: "123m123p123s11122z", answers: ["1m"], primary_answer: "1m",
      genre: attacks[0], note: attacks[1], prompt_note: attacks[2], created_at: new Date().toISOString(),
      settings: { turn: 6, round_wind: "1z", seat_wind: "2z", dora_indicators: [], objective: 2 },
    }]));
  }, { attacks });
  await page.goto("http://127.0.0.1:18765/");
  await page.click('#nav button[data-view="manage"]');
  await page.click('.problem-link');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.locator("script:not([src]), [onerror], [onload]").count()).toBe(0);
  await expect(page.locator("#preview-note")).toHaveValue(attacks[1]);
  await expect(page.locator("#preview-prompt-note")).toHaveValue(attacks[2]);
});

test("invalid problem id in backup is rejected", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  await page.waitForFunction(() => window.NanikiruSaveData);
  const message = await page.evaluate(async () => {
    try {
      await window.NanikiruSaveData.applySaveData({ v: 6, p: [{ id: '<script>x</script>', hand: "123m", answers: ["1m"], genre: "x" }], h: {}, s: {}, a: 10, g: [] });
      return "accepted";
    } catch (error) { return error.message; }
  });
  expect(message).toContain("問題ID");
});
