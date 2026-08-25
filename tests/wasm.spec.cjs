const { test, expect } = require("@playwright/test");
const zlib = require("node:zlib");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("nanikiru-review-settings-v1")) {
      localStorage.setItem("nanikiru-review-settings-v1", JSON.stringify({ quiz_random_transform: false }));
    }
  });
});

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
        game_mode: 1,
        round_wind: 27,
        seat_wind: 28,
        dora_indicators: [],
        hand: [4, 5, 13, 14, 16, 17, 21, 21, 23, 23, 24, 33, 33, 33],
        melds: [],
        enable_reddora: true,
        enable_uradora: false,
        enable_shanten_down: true,
        enable_tegawari: true,
        auto_disable_deep_search: true,
        enable_riichi: true,
        enable_calls: false,
        enable_turn_yaku: true,
        calc_stats: true,
        calc_yaku_stats: false,
        calc_shapley_stats: false,
        ron_rate: 0,
        version: "0.9.14",
      },
    });
  }));
  expect(result.success).toBe(true);
  expect(result.stats).toHaveLength(10);
  const ranked = [...result.stats].sort((a, b) => b.exp_score[6] - a.exp_score[6]);
  expect(ranked[0].tile).toBe(17);
  expect(ranked[1].tile).toBe(16);
  expect(ranked[0].exp_score[6]).toBeCloseTo(1506.9471, 3);
  expect(cspViolations).toEqual([]);
});

test("large tegawari graph completes without exhausting the WASM call stack", async ({ page }) => {
  test.setTimeout(180000);
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(() => new Promise((resolve, reject) => {
    const worker = new Worker("wasm/worker.js", { type: "module" });
    const timer = setTimeout(() => reject(new Error("WASM worker timeout")), 170000);
    worker.onmessage = (event) => {
      clearTimeout(timer);
      worker.terminate();
      event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result);
    };
    worker.onerror = (event) => reject(new Error(event.message));
    worker.postMessage({
      id: 1,
      payload: {
        game_mode: 1,
        round_wind: 27,
        seat_wind: 28,
        dora_indicators: [],
        hand: [2, 3, 6, 6, 7, 8, 13, 16, 22, 27, 31, 32, 33, 33],
        melds: [],
        enable_reddora: true,
        enable_uradora: true,
        enable_shanten_down: true,
        enable_tegawari: true,
        auto_disable_deep_search: false,
        enable_riichi: true,
        enable_calls: false,
        enable_turn_yaku: true,
        calc_stats: true,
        calc_yaku_stats: false,
        calc_shapley_stats: false,
        ron_rate: 0.7,
        remaining_tiles: 70,
        version: "0.9.14",
      },
    });
  }));

  expect(result.success).toBe(true);
  expect(result.searched).toBe(6698142);
  expect(result.stats).toHaveLength(12);
});

test("a legal ron tile is not exposed as a chi hand-change", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(() => new Promise((resolve, reject) => {
    const worker = new Worker("wasm/worker.js", { type: "module" });
    const timer = setTimeout(() => reject(new Error("WASM worker timeout")), 60000);
    worker.onmessage = (event) => {
      clearTimeout(timer);
      worker.terminate();
      event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result);
    };
    worker.onerror = (event) => reject(new Error(event.message));
    worker.postMessage({
      id: 1,
      payload: {
        game_mode: 1,
        round_wind: 27,
        seat_wind: 28,
        dora_indicators: [],
        hand: [3, 5, 13, 13, 21, 22, 23, 32],
        melds: [
          { type: 0, tiles: [31, 31, 31] },
          { type: 1, tiles: [9, 10, 11] },
        ],
        enable_reddora: true,
        enable_uradora: true,
        enable_shanten_down: false,
        enable_tegawari: false,
        auto_disable_deep_search: false,
        enable_riichi: true,
        enable_calls: true,
        enable_turn_yaku: true,
        calc_stats: true,
        calc_yaku_stats: false,
        calc_shapley_stats: false,
        ron_rate: 0.7,
        remaining_tiles: 40,
        version: "0.9.14",
      },
    });
  }));

  expect(result.success).toBe(true);
  const discardGreen = result.stats.find((stat) => stat.tile === 32);
  expect(discardGreen).toBeTruthy();
  expect(discardGreen.call_tile_stats.some((entry) => entry.tile === 4)).toBe(false);
});

test("mahjong wasm returns exact Shapley and call statistics", async ({ page }) => {
  test.setTimeout(180000);
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(() => new Promise((resolve, reject) => {
    const worker = new Worker("wasm/worker.js", { type: "module" });
    const timer = setTimeout(() => reject(new Error("WASM worker timeout")), 170000);
    worker.onmessage = (event) => {
      clearTimeout(timer);
      worker.terminate();
      event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.result);
    };
    worker.onerror = (event) => reject(new Error(event.message));
    worker.postMessage({
      id: 1,
      payload: {
        game_mode: 1,
        round_wind: 27,
        seat_wind: 28,
        dora_indicators: [],
        hand: [1, 2, 6, 9, 11, 14, 14, 16, 23, 24, 25, 32, 32, 33],
        melds: [],
        enable_reddora: true,
        enable_uradora: true,
        enable_shanten_down: false,
        enable_tegawari: false,
        auto_disable_deep_search: true,
        enable_riichi: true,
        enable_calls: true,
        enable_other_win_stop: false,
        other_win_hazard: Array(18).fill(0),
        enable_turn_yaku: true,
        calc_stats: true,
        calc_yaku_stats: true,
        calc_shapley_stats: true,
        ron_rate: 0.7,
        remaining_tiles: 48,
        version: "0.9.14",
      },
    });
  }));
  expect(result.success).toBe(true);
  expect(result.stats.length).toBeGreaterThan(0);
  expect(result.stats.some((stat) => stat.yaku_stats?.some((entry) => entry.shapley_score?.[6] > 0))).toBe(true);
  expect(result.stats.some((stat) => stat.call_prob?.[6] > 0)).toBe(true);
  expect(result.stats.some((stat) => stat.call_tile_stats?.some((entry) => entry.probability?.[6] > 0))).toBe(true);
});

test("wasm worker is recycled without breaking analysis", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(async () => {
    const payload = {
      game_mode: 1,
      round_wind: 27,
      seat_wind: 28,
      dora_indicators: [],
      hand: [4, 5, 13, 14, 16, 17, 21, 21, 23, 23, 24, 33, 33, 33],
      melds: [],
      enable_reddora: true,
      enable_uradora: false,
      enable_shanten_down: true,
      enable_tegawari: true,
      auto_disable_deep_search: true,
      enable_riichi: true,
      enable_calls: false,
      enable_turn_yaku: true,
      calc_stats: true,
      calc_yaku_stats: false,
      calc_shapley_stats: false,
      ron_rate: 0,
      version: "0.9.14",
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

  await page.locator("#preview-hand-input").fill("123456789m12348z");
  await page.locator("#preview-answer-input").fill("1m");
  await page.locator("#save-preview-problem").click();
  await expect(page.locator("#preview-edit-message")).toContainText("存在しない牌");
  expect(await page.evaluate(() => problems[0].hand)).toBe("223456789m12344p");
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
    const presentation = buildQuizProblemPresentation({
      hand: "123m456p789s11122z",
      answers: ["1m"],
      primary_answer: "1m",
      melds: [{ type: 1, name: "チー", tiles: ["1m", "2m", "3m"], mpsz: "123m" }],
      note: "候補 1m 2p 3s",
      prompt_note: "注目 1m",
      settings: { dora_indicators: ["1m"] },
      simulator: {
        best_discards: ["1m"],
        rows: [{ tile: "1m", necessary_tiles: [{ tile: "2p", count: 4 }] }],
      },
    }, { quiz_random_transform: true }, (() => {
      const values = [0.5, 0.1];
      return () => values.shift();
    })());
    return { blocks, transformed, presentation, specs: randomTransformSpecs(hand, 40) };
  });
  expect(result.blocks).toEqual(["45m", "2344p", "779p", "233s", "68s"]);
  expect(result.transformed.answers).toEqual(["3s", "1s"]);
  expect(result.transformed.melds.map((meld) => meld.mpsz)).toEqual(["789p", "777z"]);
  expect(result.specs).toHaveLength(40);
  expect(result.specs.every((spec) => spec.degree > 0)).toBe(true);
  expect(result.specs.every((spec) => spec.suit_map.m === "m" && spec.suit_map.p === "p" && spec.suit_map.s === "s")).toBe(true);
  expect(result.specs.every((spec) => spec.reverse_suits.length <= 2)).toBe(true);
  expect(result.presentation.hand).toBe("123m789p456s11122z");
  expect(result.presentation.answers).toEqual(["9p"]);
  expect(result.presentation.melds[0].mpsz).toBe("789p");
  expect(result.presentation.settings.dora_indicators).toEqual(["7p"]);
  expect(result.presentation.note).toContain("9p");
  expect(result.presentation.note).toContain("8s");
  expect(result.presentation.note).toContain("7m");
  expect(result.presentation.prompt_note).toContain("9p");
  expect(result.presentation.simulator.best_discards).toEqual(["9p"]);
  expect(result.presentation.simulator.rows[0].tile).toBe("9p");
  expect(result.presentation.simulator.rows[0].necessary_tiles[0].tile).toBe("8s");
});

test("data settings persist the suspension threshold, daily new limit, day boundary, Mature threshold and quiz transform", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  await page.evaluate(() => showView("export"));
  await expect(page.locator("#review-suspension-wrong-transitions")).toHaveValue("8");
  await expect(page.locator("#review-daily-new-problem-limit")).toHaveValue("10");
  await expect(page.locator("#review-day-boundary-time")).toHaveValue("00:00");
  await expect(page.locator("#review-mature-interval-days")).toHaveValue("28");
  await expect(page.locator("#quiz-random-transform")).not.toBeChecked();
  await expect(page.locator("#simulator-enable-calls")).toBeChecked();
  await expect(page.locator("#simulator-enable-uradora")).toBeChecked();
  await expect(page.locator("#simulator-fast-similar-generation")).toBeChecked();
  await expect(page.locator("#simulator-tsumo-win-share-percent")).toHaveValue("30");
  await page.locator("#review-suspension-wrong-transitions").fill("12");
  await page.locator("#review-daily-new-problem-limit").fill("15");
  await page.locator("#review-day-boundary-time").fill("04:30");
  await page.locator("#review-mature-interval-days").fill("35");
  await page.locator("#quiz-random-transform").check();
  await page.locator("#simulator-enable-calls").uncheck();
  await page.locator("#simulator-fast-similar-generation").uncheck();
  await page.locator("#simulator-tsumo-win-share-percent").fill("42");
  await page.locator(".hazard-settings").evaluate((details) => { details.open = true; });
  await page.locator("#simulator-other-win-hazard-grid [data-hazard-turn='10']").fill("8.25");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("nanikiru-review-settings-v1")));
  expect(stored.suspension_wrong_transitions).toBe(12);
  expect(stored.daily_new_problem_limit).toBe(15);
  expect(stored.day_boundary_minutes).toBe(270);
  expect(stored.mature_interval_days).toBe(35);
  expect(stored.quiz_random_transform).toBe(true);
  expect(stored.simulator_enable_calls).toBe(false);
  expect(stored.simulator_fast_similar_generation).toBe(false);
  expect(stored.simulator_tsumo_win_share_percent).toBe(42);
  expect(stored.simulator_other_win_hazard_percent[9]).toBe(8.25);
  const savedSettings = await page.evaluate(() => ({
    backup: window.NanikiruSaveData.buildSaveData().s,
    cloud: window.NanikiruSaveData.getSettings().reviewSettings,
  }));
  expect(savedSettings.backup.simulator_tsumo_win_share_percent).toBe(42);
  expect(savedSettings.cloud.simulator_enable_calls).toBe(false);
  expect(savedSettings.backup.simulator_fast_similar_generation).toBe(false);
  await page.reload();
  await page.evaluate(() => showView("export"));
  await expect(page.locator("#review-suspension-wrong-transitions")).toHaveValue("12");
  await expect(page.locator("#review-daily-new-problem-limit")).toHaveValue("15");
  await expect(page.locator("#review-day-boundary-time")).toHaveValue("04:30");
  await expect(page.locator("#review-mature-interval-days")).toHaveValue("35");
  await expect(page.locator("#quiz-random-transform")).toBeChecked();
  await expect(page.locator("#simulator-enable-calls")).not.toBeChecked();
  await expect(page.locator("#simulator-fast-similar-generation")).not.toBeChecked();
  await expect(page.locator("#simulator-tsumo-win-share-percent")).toHaveValue("42");
  await expect(page.locator("#simulator-other-win-hazard-grid [data-hazard-turn='10']")).toHaveValue("8.25");
});

test("legacy cloud settings load with defaults for newly added settings", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  await page.waitForFunction(() => window.NanikiruSaveData);
  await page.evaluate(async () => {
    await window.NanikiruSaveData.applyCloudRecords({
      settingsRecord: {
        reviewSettings: {
          first_correct_days: 11,
          wrong_retry_days: 2,
          wrong_then_correct_days: 4,
          repeat_multiplier: 5,
        },
        adminCount: 9,
        genreOrder: ["旧設定"],
      },
    });
  });
  const stored = await page.evaluate(() => ({
    review: JSON.parse(localStorage.getItem("nanikiru-review-settings-v1")),
    adminCount: localStorage.getItem("nanikiru-admin-count-v1"),
    genreOrder: JSON.parse(localStorage.getItem("nanikiru-genre-order-v1")),
  }));
  expect(stored.review).toEqual({
    first_correct_days: 11,
    wrong_retry_days: 2,
    wrong_then_correct_days: 4,
    repeat_multiplier: 5,
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
    simulator_fast_similar_generation: true,
    simulator_tsumo_win_share_percent: 30,
    simulator_other_win_hazard_percent: [
      0.02, 0.08, 0.29, 0.78, 1.70, 3.05, 4.67, 6.44, 8.23,
      9.75, 11.08, 12.12, 12.76, 13.12, 13.23, 13.09, 11.70, 11.70,
    ],
  });
  expect(stored.adminCount).toBe("9");
  expect(stored.genreOrder).toEqual(["旧設定"]);
});

test("simulator settings are forwarded to WASM and Shapley output is parsed", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(() => {
    localStorage.setItem("nanikiru-review-settings-v1", JSON.stringify({
      simulator_enable_reddora: false,
      simulator_enable_uradora: true,
      simulator_enable_shanten_down: false,
      simulator_enable_tegawari: true,
      simulator_auto_disable_deep_search: true,
      simulator_enable_riichi: true,
      simulator_enable_calls: true,
      simulator_enable_other_win_stop: true,
      simulator_tsumo_win_share_percent: 35,
      simulator_other_win_hazard_percent: Array(18).fill(5),
      quiz_random_transform: false,
    }));
    const settings = loadReviewSettings();
    const scene = { turn: 6, round_wind: "1z", seat_wind: "2z", dora: "", objective: 2 };
    const mode = { flags: { enable_shanten_down: false, enable_tegawari: true } };
    const captured = buildSimulatorEnginePayload("123m123p123s11122z", [], scene, settings, mode, "test");
    const lightweight = buildSimulatorEnginePayload("123m123p123s11122z", [], scene, settings, mode, "test", false);
    const probabilities = Array(19).fill(0);
    probabilities[6] = 0.2;
    const scores = Array(19).fill(0);
    scores[6] = 1200;
    const simulation = summarizeWasmResult({
      shanten: { all: 1 },
      stats: [{
        tile: 0, shanten: 1, exp_score: scores, win_prob: probabilities, tenpai_prob: probabilities,
        call_prob: probabilities, call_win_prob: probabilities, necessary_tiles: [], call_tile_stats: [],
        yaku_stats: [{
          yaku: 2, occurrence_prob: probabilities,
          shapley_score: scores, called_occurrence_prob: probabilities, called_shapley_score: scores,
        }],
      }],
    }, 6);
    return { captured, lightweight, row: simulation.rows[0] };
  });
  expect(result.captured.enable_reddora).toBe(false);
  expect(result.captured.enable_uradora).toBe(true);
  expect(result.captured.enable_calls).toBe(true);
  expect(result.captured.enable_other_win_stop).toBe(true);
  expect(result.captured.calc_yaku_stats).toBe(true);
  expect(result.captured.calc_shapley_stats).toBe(true);
  expect(result.captured.t_min).toBe(6);
  expect(result.lightweight.calc_yaku_stats).toBe(false);
  expect(result.lightweight.calc_shapley_stats).toBe(false);
  expect(result.captured.ron_rate).toBeCloseTo(0.65, 10);
  expect(result.captured.remaining_tiles).toBe(48);
  expect(result.captured.other_win_hazard[0]).toBeCloseTo(0.05, 10);
  expect(result.row.yaku_contributions[0].name).toBe("立直");
  expect(result.row.call_probability).toBeCloseTo(0.2, 10);
});

test("WASM fallback preserves shanten-down before disabling both search options", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(() => {
    const mode = {
      degraded: false,
      requestedFlags: { enable_shanten_down: true, enable_tegawari: true },
      flags: { enable_shanten_down: true, enable_tegawari: true },
    };
    const first = nextWasmFallbackFlags(mode);
    mode.degraded = true;
    mode.flags = first;
    const warning = wasmFallbackWarning(mode);
    const second = nextWasmFallbackFlags(mode);
    mode.flags = second;
    const third = nextWasmFallbackFlags(mode);
    return { first, warning, second, third };
  });

  expect(result.first).toEqual({ enable_shanten_down: true, enable_tegawari: false });
  expect(result.warning).toContain("手替わりだけを無効化");
  expect(result.second).toEqual({ enable_shanten_down: false, enable_tegawari: true });
  expect(result.third).toEqual({ enable_shanten_down: false, enable_tegawari: false });
});

test("legacy simulator results and changed settings trigger a lazy statistics refresh", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(() => {
    const settings = loadReviewSettings();
    const signature = simulatorSettingsSignature(settings);
    const row = { tile: "1m", metric: 1000, yaku_contributions: [] };
    return {
      legacy: simulatorStatsNeedRefresh({ rows: [{ tile: "1m", metric: 1000 }] }, settings),
      current: simulatorStatsNeedRefresh({ settings_signature: signature, rows: [row] }, settings),
      deferred: simulatorStatsNeedRefresh({ details_complete: false, settings_signature: signature, rows: [row] }, settings),
      changed: simulatorStatsNeedRefresh({ settings_signature: signature, rows: [row] }, {
        ...settings,
        simulator_enable_calls: !settings.simulator_enable_calls,
      }),
    };
  });
  expect(result).toEqual({ legacy: true, current: false, deferred: true, changed: true });
});

test("simulator table shows stable-color Shapley bars and called-hand details", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  await page.evaluate(() => {
    const yaku = (value, name, shortName, shapley, occurrence) => ({
      yaku: value, name, short_name: shortName, shapley, occurrence,
    });
    const rows = [
      {
        tile: "1m", metric: 1200, expected_score: 1200, win_probability: 0.2, tenpai_probability: 0.5,
        call_probability: 0.08, call_win_probability: 0.03, ukeire: 0, necessary_tiles: [], shanten: 1,
        yaku_contributions: [yaku(2, "立直", "立", 700, 0.15), yaku(1024, "ドラ", "ド", 500, 0.12)],
        called_yaku_contributions: [yaku(16384, "發", "發", 400, 0.4)],
        call_tile_rates: [{ tile: "6z", probability: 0.04, conditional_probability: 0.5 }],
        shapley_total: 1200, shapley_residual: 0,
      },
      {
        tile: "2m", metric: 900, expected_score: 900, win_probability: 0.17, tenpai_probability: 0.46,
        call_probability: 0, call_win_probability: 0, ukeire: 0, necessary_tiles: [], shanten: 1,
        yaku_contributions: [yaku(2, "立直", "立", 500, 0.11), yaku(4096, "赤ドラ", "赤", 400, 0.1)],
        called_yaku_contributions: [], call_tile_rates: [], shapley_total: 900, shapley_residual: 0,
      },
    ];
    rows.forEach((row) => { row.yaku_chart_contributions = aggregateYakuContributions(row.yaku_contributions); });
    const host = document.createElement("div");
    host.id = "shapley-chart-test-host";
    document.body.append(host);
    renderSimulatorTable(host, {
      turn: 6, shanten: { all: 1 }, rows,
    }, ["1m"], "1m");
  });
  await expect(page.locator(".shapley-track")).toHaveCount(2);
  const riichiSegments = page.locator('.shapley-segment[data-yaku="2"]');
  await expect(riichiSegments).toHaveCount(2);
  const chartStyles = await riichiSegments.evaluateAll((segments) => segments.map((segment) => ({
    color: getComputedStyle(segment).backgroundColor,
    width: segment.getBoundingClientRect().width,
  })));
  expect(chartStyles[0].color).toBe(chartStyles[1].color);
  expect(chartStyles[0].color).not.toBe("rgba(0, 0, 0, 0)");
  expect(chartStyles[0].width).toBeGreaterThan(chartStyles[1].width);
  expect(chartStyles[1].width).toBeGreaterThan(1);
  await expect(page.locator(".shapley-track").first()).toHaveCSS("background-color", "rgb(13, 18, 25)");
  await expect(page.locator(".sim-table > thead")).toContainText("副露和了率");
  await page.locator(".shapley-details").first().evaluate((details) => { details.open = true; });
  await expect(page.locator(".shapley-details").first()).toContainText("副露発生 8.00%");
  await expect(page.locator(".shapley-details").first()).toContainText("發");
  await expect(page.locator(".shapley-details").first()).toContainText("残差");
});

test("configured JST day boundary controls daily grouping and the new-problem quota", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(() => {
    localStorage.setItem("nanikiru-review-settings-v1", JSON.stringify({
      day_boundary_minutes: 4 * 60,
      daily_new_problem_limit: 10,
      quiz_random_transform: false,
    }));
    const beforeBoundary = Date.UTC(2026, 7, 7, 18, 59);
    const boundary = Date.UTC(2026, 7, 7, 19, 0);
    const now = Date.UTC(2026, 7, 7, 19, 30);
    const history = {
      before: { attempts: [{ at: beforeBoundary, correct: true }], dueAt: now + DAY },
      after: { attempts: [{ at: boundary, correct: true }], dueAt: now + DAY },
    };
    return {
      beforeKey: jstDayKey(beforeBoundary),
      boundaryKey: jstDayKey(boundary),
      range: localDayRange(now),
      answeredToday: newProblemsAnsweredToday(history, now),
      dayDifference: calendarDaysDiffJst(beforeBoundary, boundary),
    };
  });
  expect(result.beforeKey).toBe("2026-08-07");
  expect(result.boundaryKey).toBe("2026-08-08");
  expect(result.range).toEqual({
    start: Date.UTC(2026, 7, 7, 19, 0),
    end: Date.UTC(2026, 7, 8, 19, 0),
  });
  expect(result.answeredToday).toBe(1);
  expect(result.dayDifference).toBe(1);
});

test("review due dates use logical days anchored at the configured boundary", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(() => {
    const settings = {
      first_correct_days: 7,
      wrong_retry_days: 1,
      wrong_then_correct_days: 1,
      repeat_multiplier: 3,
      day_boundary_minutes: 4 * 60,
    };
    const night = Date.UTC(2026, 7, 8, 14, 0); // 2026-08-08 23:00 JST
    const nextMorning = Date.UTC(2026, 7, 8, 21, 0); // 2026-08-09 06:00 JST
    const wrongDueAt = calculateNextReviewDueAt([], false, night, settings);
    const afterWrongDueAt = calculateNextReviewDueAt(
      [{ at: night, correct: false }],
      true,
      nextMorning,
      settings,
    );

    problems = [{ id: "legacy-boundary" }];
    localStorage.setItem("nanikiru-review-settings-v1", JSON.stringify(settings));
    localStorage.setItem("nanikiru-learning-v1", JSON.stringify({
      "legacy-boundary": {
        attempts: [{ at: night, correct: false }],
        dueAt: night + DAY,
      },
    }));
    repairReviewHistoryDueDates();
    const migratedDueAt = JSON.parse(localStorage.getItem("nanikiru-learning-v1"))["legacy-boundary"].dueAt;
    const originalNow = Date.now;
    Date.now = () => nextMorning;
    const dueProblemIds = dueReviewProblems().map((problem) => problem.id);
    Date.now = originalNow;
    return {
      wrongDueAt,
      eligibleNextMorning: wrongDueAt <= nextMorning,
      afterWrongDueAt,
      migratedDueAt,
      dueProblemIds,
      nearIntegerDelay: normalizeReviewDelayDays((0.1 + 0.2) * 10),
      fractionalDelay: normalizeReviewDelayDays(3.01),
    };
  });
  expect(result.wrongDueAt).toBe(Date.UTC(2026, 7, 8, 19, 0)); // 2026-08-09 04:00 JST
  expect(result.eligibleNextMorning).toBe(true);
  expect(result.afterWrongDueAt).toBe(Date.UTC(2026, 7, 14, 19, 0)); // 2026-08-15 04:00 JST
  expect(result.migratedDueAt).toBe(Date.UTC(2026, 7, 8, 19, 0));
  expect(result.dueProblemIds).toContain("legacy-boundary");
  expect(result.nearIntegerDelay).toBe(3);
  expect(result.fractionalDelay).toBe(4);
});

test("review mode adds only the remaining daily quota of random new problems", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(() => {
    const now = Date.now();
    const { start } = localDayRange(now);
    const today = start + 60 * 60 * 1000;
    const yesterday = start - 60 * 60 * 1000;
    const makeProblem = (id) => ({
      id, hand: "123m123p123s11122z", answers: ["1m"], primary_answer: "1m", genre: "daily-new",
      created_at: new Date().toISOString(), settings: { turn: 6, round_wind: "1z", seat_wind: "2z", dora_indicators: [], objective: 2 },
    });
    problems = [
      makeProblem("due-a"), makeProblem("due-b"),
      ...Array.from({ length: 4 }, (_, index) => makeProblem(`today-${index}`)),
      makeProblem("seen-yesterday"),
      ...Array.from({ length: 12 }, (_, index) => makeProblem(`unseen-${index}`)),
    ];
    const history = {
      "due-a": { attempts: [{ at: yesterday, correct: true }], dueAt: now - 2000 },
      "due-b": { attempts: [{ at: yesterday, correct: true }], dueAt: now - 1000 },
      "seen-yesterday": { attempts: [{ at: yesterday, correct: true }], dueAt: now + DAY },
    };
    for (let index = 0; index < 4; index++) {
      history[`today-${index}`] = { attempts: [{ at: today + index, correct: true }], dueAt: now + DAY };
    }
    localStorage.setItem("nanikiru-learning-v1", JSON.stringify(history));
    localStorage.setItem("nanikiru-review-settings-v1", JSON.stringify({
      daily_new_problem_limit: 10,
      quiz_random_transform: false,
    }));
    currentQuizContext = { mode: "review" };
    const dueStatus = renderQuestionStatus(problems.find((problem) => problem.id === "due-a"), history["due-a"]);
    const newStatus = renderQuestionStatus(problems.find((problem) => problem.id === "unseen-0"), null);
    const firstPool = reviewQuestionPool(history, () => 0, now);
    history["unseen-0"] = { attempts: [{ at: today + 100, correct: true }], dueAt: now + DAY };
    const secondPool = reviewQuestionPool(history, () => 0, now);
    return {
      answeredToday: newProblemsAnsweredToday(JSON.parse(localStorage.getItem("nanikiru-learning-v1")), now),
      firstCounts: reviewQuestionCounts(JSON.parse(localStorage.getItem("nanikiru-learning-v1")), now),
      dueStatus,
      newStatus,
      firstPoolIds: firstPool.map((problem) => problem.id),
      secondPoolIds: secondPool.map((problem) => problem.id),
    };
  });
  expect(result.answeredToday).toBe(4);
  expect(result.firstCounts).toEqual({ due: 2, newProblems: 6, total: 8 });
  expect(result.dueStatus).toContain("残り 7問（復習 1問・新規 6問）");
  expect(result.newStatus).toContain("残り 7問（復習 2問・新規 5問）");
  expect(result.firstPoolIds.slice(0, 2)).toEqual(["due-a", "due-b"]);
  expect(result.firstPoolIds.filter((id) => id.startsWith("unseen-"))).toHaveLength(6);
  expect(result.secondPoolIds.slice(0, 2)).toEqual(["due-a", "due-b"]);
  expect(result.secondPoolIds.filter((id) => id.startsWith("unseen-"))).toHaveLength(5);
});

test("quiz accepts the transformed answer tile", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  await page.evaluate(() => {
    localStorage.setItem("nanikiru-review-settings-v1", JSON.stringify({ quiz_random_transform: true }));
    const problem = {
      id: "transformed-answer",
      hand: "123m456p789s11122z",
      answers: ["1m"],
      primary_answer: "1m",
      genre: "transform",
      melds: [],
      settings: { round_wind: "1z", seat_wind: "2z", dora_indicators: [] },
    };
    problems = [problem];
    currentProblem = problem;
    currentQuizContext = { mode: "genre", genre: "transform" };
    const values = [0.5, 0.1, 0];
    const originalRandom = Math.random;
    Math.random = () => values.shift() ?? 0;
    renderQuestion(problem, null);
    Math.random = originalRandom;
  });
  await page.locator("#hand .tile[data-tile='9p']").click();
  await expect(page.locator("#answer-result")).toContainText("正解");
  const attempt = await page.evaluate(() => JSON.parse(localStorage.getItem("nanikiru-learning-v1"))["transformed-answer"].attempts[0]);
  expect(attempt.correct).toBe(true);
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
    const calls = [];
    window.analyzeWithWasm = async (handText, melds, payload, options = {}) => {
      const includeYakuStats = options.includeYakuStats !== false;
      calls.push({ profile: options.estimateProfile || "exact", includeYakuStats });
      return ({
      version: "test-wasm",
      turn: payload.turn,
      objective: 2,
      details_complete: includeYakuStats,
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
        yaku_contributions: includeYakuStats ? [{
          yaku: 2, name: "立直", short_name: "立", occurrence: 0.2, shapley: 1000,
        }] : [],
        yaku_chart_contributions: includeYakuStats ? [{
          yaku: 2, name: "立直", short_name: "立", occurrence: 0.2, shapley: 1000,
        }] : [],
        shapley_total: includeYakuStats ? 1000 : 0,
        shapley_residual: 0,
      })),
      });
    };
    window.registerProblems = async (records) => { registered = records; };
    await generateWithWasm();
    return {
      registered,
      calls,
      message: document.querySelector("#admin-message").textContent,
      sourceShapleyBars: document.querySelectorAll("#admin-simulator-table .shapley-track").length,
      sourceMissingYaku: document.querySelector("#admin-simulator-table").textContent.includes("役別データなし"),
    };
  });
  expect(result.registered).toHaveLength(3);
  expect(result.registered.filter((problem) => problem.source_id)).toHaveLength(2);
  expect(result.calls.filter((call) => call.profile === "fast")).toHaveLength(5);
  expect(result.calls.filter((call) => call.profile === "medium")).toHaveLength(0);
  expect(result.calls.filter((call) => call.profile === "exact")).toHaveLength(3);
  expect(result.calls[0]).toEqual({ profile: "exact", includeYakuStats: true });
  expect(result.calls.slice(1).every((call) => call.includeYakuStats === false)).toBe(true);
  expect(result.registered.find((problem) => !problem.source_id).simulator.details_complete).toBe(true);
  expect(result.sourceShapleyBars).toBeGreaterThan(0);
  expect(result.sourceMissingYaku).toBe(false);
  expect(result.message).toContain("2問を登録");
});

test("stopping similar generation registers the source and completed candidates", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(async () => {
    showView("create");
    document.querySelector("#admin-genre").value = "停止テスト";
    document.querySelector("#admin-hand").value = "45m2344779p23368s";
    document.querySelector("#admin-answer").value = "9p";
    document.querySelector("#admin-count").value = "3";
    let registered = [];
    let candidateExactCalls = 0;
    window.analyzeWithWasm = async (handText, _melds, payload, options = {}) => {
      const profile = options.estimateProfile || "exact";
      if (profile === "exact" && handText !== "45m2344779p23368s") {
        candidateExactCalls++;
        if (candidateExactCalls === 2) {
          document.querySelector("#stop-generate-button").click();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      return {
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
      };
    };
    window.registerProblems = async (records) => { registered = records; };
    await generateWithWasm();
    return {
      registered,
      candidateExactCalls,
      message: document.querySelector("#admin-message").textContent,
      stopHidden: document.querySelector("#stop-generate-button").classList.contains("hidden"),
    };
  });
  expect(result.candidateExactCalls).toBe(2);
  expect(result.registered).toHaveLength(2);
  expect(result.registered.filter((problem) => !problem.source_id)).toHaveLength(1);
  expect(result.registered.filter((problem) => problem.source_id)).toHaveLength(1);
  expect(result.message).toContain("途中で停止");
  expect(result.message).toContain("元問題も登録済み");
  expect(result.stopHidden).toBe(true);
});

test("online similar search lazily samples degree lanes and stops after enough exact matches", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(async () => {
    const candidates = Array.from({ length: 120 }, (_, index) => ({
      id: index,
      hand: "123m123p123s11122z",
      answers: ["1m"],
      spec: { degree: index % 6 + 1 },
    }));
    const sourceConditions = {
      tolerance_percent: 0,
      max_rank: 1,
      next_worse_rank: 2,
      next_worse_gap_percent: 10,
    };
    const calls = [];
    const simulation = {
      rows: [
        { tile: "1m", metric: 100 },
        { tile: "2m", metric: 80 },
      ],
    };
    const search = await searchSimilarCandidatesOnline({
      candidates,
      requested: 2,
      sourceConditions,
      analyze: async (candidate, profile) => {
        calls.push({ id: candidate.id, profile, degree: candidate.spec.degree });
        return simulation;
      },
    });
    return { calls, search };
  });
  expect(result.search.qualified).toHaveLength(2);
  expect(result.search.counters).toEqual({ fast: 5, exact: 2 });
  expect(result.search.remaining).toBe(118);
  expect(new Set(result.calls.filter((call) => call.profile === "fast").map((call) => call.degree)).size).toBe(5);
  expect(new Set(result.search.qualified.map((item) => item.candidate.spec.degree)).size).toBe(2);
});

test("fast estimates only order candidates and never decide acceptance", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(async () => {
    const rejectedEstimate = {
      rows: [
        { tile: "2m", metric: 100 },
        { tile: "1m", metric: 80 },
      ],
    };
    const acceptedExact = {
      rows: [
        { tile: "1m", metric: 100 },
        { tile: "2m", metric: 80 },
      ],
    };
    const profiles = [];
    const search = await searchSimilarCandidatesOnline({
      candidates: [{
        id: 1,
        hand: "123m123p123s11122z",
        answers: ["1m"],
        spec: { degree: 1 },
      }],
      requested: 1,
      sourceConditions: {
        tolerance_percent: 0,
        max_rank: 1,
        next_worse_rank: 2,
        next_worse_gap_percent: 10,
      },
      analyze: async (_candidate, profile) => {
        profiles.push(profile);
        return profile === "exact" ? acceptedExact : rejectedEstimate;
      },
    });
    return { search, profiles };
  });
  expect(result.profiles).toEqual(["fast", "exact"]);
  expect(result.search.qualified).toHaveLength(1);
});

test("online similar search expands its batches until the requested count is filled", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(async () => {
    const candidates = Array.from({ length: 41 }, (_, index) => ({
      id: index,
      hand: "123m123p123s11122z",
      answers: ["1m"],
      spec: { degree: index % 6 + 1, slides: { 0: index } },
    }));
    const sourceConditions = {
      tolerance_percent: 0,
      max_rank: 1,
      next_worse_rank: 2,
      next_worse_gap_percent: 10,
    };
    const accepted = {
      rows: [
        { tile: "1m", metric: 100 },
        { tile: "2m", metric: 80 },
      ],
    };
    const rejected = {
      rows: [
        { tile: "2m", metric: 100 },
        { tile: "1m", metric: 80 },
      ],
    };
    let exactCalls = 0;
    const search = await searchSimilarCandidatesOnline({
      candidates,
      requested: 3,
      sourceConditions,
      analyze: async (_candidate, profile) => {
        if (profile !== "exact") return accepted;
        exactCalls++;
        return [1, 7, 13].includes(exactCalls) ? accepted : rejected;
      },
    });
    return { search, exactCalls };
  });
  expect(result.search.qualified).toHaveLength(3);
  expect(result.exactCalls).toBe(13);
  expect(result.search.expansions).toBeGreaterThan(0);
  expect(result.search.limits.exact).toBeGreaterThan(6);
});

test("online similar search exhausts candidates instead of stopping at its initial budget", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(async () => {
    const candidates = Array.from({ length: 10 }, (_, index) => ({
      id: index,
      hand: "123m123p123s11122z",
      answers: ["1m"],
      spec: { degree: index % 6 + 1, slides: { 0: index } },
    }));
    const rejected = {
      rows: [
        { tile: "2m", metric: 100 },
        { tile: "1m", metric: 80 },
      ],
    };
    return searchSimilarCandidatesOnline({
      candidates,
      requested: 3,
      sourceConditions: {
        tolerance_percent: 0,
        max_rank: 1,
        next_worse_rank: 2,
        next_worse_gap_percent: 10,
      },
      analyze: async () => rejected,
    });
  });
  expect(result.qualified).toHaveLength(0);
  expect(result.counters).toEqual({ fast: 10, exact: 10 });
  expect(result.remaining).toBe(0);
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

test("cloud problem repair converts legacy fields without discarding the record", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  const result = await page.evaluate(() => window.NanikiruSaveData.repairProblem({
    id: "old-id",
    genre: 123,
    hand: "123m123p123s11122z",
    answer: "3m 6p",
    source_id: "bad id",
    melds: "legacy",
  }, "cloud-id"));
  expect(result.value).toMatchObject({
    id: "cloud-id", genre: "123", hand: "123m123p123s11122z", answers: ["3m", "6p"],
  });
  expect(result.value.source_id).toBeUndefined();
  expect(result.value.melds).toBeUndefined();
  expect(result.changes.length).toBeGreaterThan(0);
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
  const nowJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const previousDueAt = Date.UTC(nowJst.getUTCFullYear(), nowJst.getUTCMonth(), nowJst.getUTCDate()) - 9 * 60 * 60 * 1000;
  const previousAt = previousDueAt - 7 * 86400000;
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

test("only correct-to-wrong transitions count and the configured threshold suspends until resumed", async ({ page }) => {
  const now = Date.now();
  const attempts = [];
  for (let index = 0; index < 2; index++) {
    attempts.push({ at: now - (16 - index * 2) * 86400000, correct: true, genre: "suspension" });
    attempts.push({ at: now - (15 - index * 2) * 86400000, correct: false, genre: "suspension" });
  }
  attempts.push({ at: now - 2 * 86400000, correct: true, genre: "suspension" });
  await page.addInitScript(({ attempts }) => {
    localStorage.setItem("nanikiru-review-settings-v1", JSON.stringify({
      suspension_wrong_transitions: 3,
      quiz_random_transform: false,
    }));
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
  expect(await dialogPromise).toContain("3回");

  const suspended = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("nanikiru-learning-v1")).suspension;
    return { state, dueIds: dueReviewProblems().map((problem) => problem.id) };
  });
  expect(suspended.state.suspended).toBe(true);
  expect(suspended.state.wrongTransitionCount).toBe(3);
  expect(suspended.dueIds).not.toContain("suspension");

  await page.evaluate(() => showView("manage"));
  await expect(page.locator(".suspended-label")).toContainText("休止");
  await page.locator(".resume-problem").click();
  await expect.poll(() => page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("nanikiru-learning-v1")).suspension;
    return state?.suspended;
  })).toBe(false);
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
