const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("nanikiru-review-settings-v1", JSON.stringify({ quiz_random_transform: false }));
  });
});

test("Net Matureグラフは1か月表示と28日判定を初期値にする", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  await expect(page.locator("#nav")).toBeVisible();
  await expect(page.locator("#review-mature-interval-days")).toHaveValue("28");

  await page.evaluate(() => {
    const now = Date.now();
    const answeredAt = now - 10 * 24 * 60 * 60 * 1000;
    problems = [{
      id: "net-mature-test",
      genre: "テスト",
      hand: "123456789m12345p",
      answers: ["5p"],
      created_at: new Date(now - 80 * 24 * 60 * 60 * 1000).toISOString(),
    }];
    localStorage.setItem("nanikiru-learning-v1", JSON.stringify({
      "net-mature-test": {
        attempts: [{ at: answeredAt, correct: true, genre: "テスト", intervalDays: 32 }],
        dueAt: reviewDueAt(answeredAt, 32, 0),
      },
    }));
    showView("stats");
  });

  await expect(page.locator('#net-mature-periods input[value="31"]')).toBeChecked();
  await expect(page.locator("#net-mature-meta")).toContainText("Mature＝回答時に決まった次回復習間隔が28日超（初見正解は7日）・日付切替 00:00・直近1か月・日次");
  await expect(page.locator("#net-mature-current")).toHaveText("1");
  await expect(page.locator("#net-mature-change")).toHaveText("+1");

  await page.locator('#net-mature-periods input[value="0"] + span').click();
  await expect(page.locator('#net-mature-periods input[value="0"]')).toBeChecked();
  await expect(page.locator("#net-mature-meta")).toContainText("全期間・月次・最初の問題登録");
});

test("Mature判定日数は設定から保存できる", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  await expect(page.locator("#nav")).toBeVisible();
  await page.evaluate(() => {
    showView("export");
    const input = document.getElementById("review-mature-interval-days");
    input.value = "35";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("nanikiru-review-settings-v1")));
  expect(stored.mature_interval_days).toBe(35);
  await expect(page.locator("#review-mature-interval-days")).toHaveValue("35");
});

test("Net Matureの日付は設定した日付切替時刻で区切る", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  await expect(page.locator("#nav")).toBeVisible();
  await page.evaluate(() => {
    const beforeBoundary = Date.parse("2026-08-07T18:59:00Z");
    const atBoundary = Date.parse("2026-08-07T19:00:00Z");
    Date.now = () => atBoundary;
    problems = [
      { id: "before-boundary", created_at: "2026-08-01T00:00:00Z" },
      { id: "at-boundary", created_at: "2026-08-01T00:00:00Z" },
    ];
    localStorage.setItem("nanikiru-review-settings-v1", JSON.stringify({
      day_boundary_minutes: 4 * 60,
      mature_interval_days: 28,
      quiz_random_transform: false,
    }));
    localStorage.setItem("nanikiru-learning-v1", JSON.stringify({
      "before-boundary": {
        attempts: [{ at: beforeBoundary, correct: true, intervalDays: 32 }],
        dueAt: reviewDueAt(beforeBoundary, 32, 4 * 60),
      },
      "at-boundary": {
        attempts: [{ at: atBoundary, correct: true, intervalDays: 32 }],
        dueAt: reviewDueAt(atBoundary, 32, 4 * 60),
      },
    }));
    showView("stats");
  });

  await expect(page.locator("#net-mature-meta")).toContainText("日付切替 04:00");
  await expect(page.locator("#net-mature-today-answered")).toHaveText("1");
  const rows = page.locator("#net-mature-values-body tr");
  await expect(rows.nth(0)).toContainText("2026-08-08");
  await expect(rows.nth(1)).toContainText("2026-08-07");
});

test("問題一覧から欠けた履歴もNet Matureと成績に残る", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  await expect(page.locator("#nav")).toBeVisible();
  await page.evaluate(() => {
    const answeredAt = Date.now() - 10 * DAY;
    problems = [];
    localStorage.setItem("nanikiru-learning-v1", JSON.stringify({
      orphan: {
        attempts: [{ at: answeredAt, correct: true, genre: "復旧対象", intervalDays: 32 }],
        dueAt: reviewDueAt(answeredAt, 32, 0),
      },
    }));
    showView("stats");
  });
  await expect(page.locator("#net-mature-current")).toHaveText("1");
});

test("セーブデータを生成してClipboard APIへコピーできる", async ({ page }) => {
  await page.addInitScript(() => {
    window.__copiedSave = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value) => { window.__copiedSave = value; } },
    });
  });
  await page.goto("http://127.0.0.1:18765/");
  await expect(page.locator("#nav")).toBeVisible();
  await page.click('#nav button[data-view="export"]');
  await page.locator(".save-copy-details summary").click();
  await page.locator("#copy-base64").click();
  await expect(page.locator("#export-message")).toContainText("コピーしました");
  const copied = await page.evaluate(() => window.__copiedSave);
  expect(copied.startsWith("NK3:")).toBe(true);
  expect(copied.length).toBeGreaterThan(10);
});
