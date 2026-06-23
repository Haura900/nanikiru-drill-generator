const { test, expect } = require("@playwright/test");

test("mahjong wasm runs in a browser", async ({ page }) => {
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
  expect(await page.evaluate(() => toleranceInputValue(0.0001))).toBe("0.0002");
  expect(await page.evaluate(() => toleranceInputValue(0.00001))).toBe("0.0001");
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
    document.querySelector("#admin-tolerance").value = "0";
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
