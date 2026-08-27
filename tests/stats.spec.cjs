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
        attempts: [{ at: answeredAt, correct: true, genre: "テスト", intervalDays: 28 }],
        dueAt: reviewDueAt(answeredAt, 28, 0),
      },
    }));
    showView("stats");
  });

  await expect(page.locator('#net-mature-periods input[value="31"]')).toBeChecked();
  await expect(page.locator("#net-mature-meta")).toContainText("Mature＝現在の次回復習間隔が28日以上（初見正解は7日）・直近1か月・日次");
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

test("問題一覧から欠けた履歴もNet Matureと成績に残る", async ({ page }) => {
  await page.goto("http://127.0.0.1:18765/");
  await expect(page.locator("#nav")).toBeVisible();
  await page.evaluate(() => {
    const answeredAt = Date.now() - 10 * DAY;
    problems = [];
    localStorage.setItem("nanikiru-learning-v1", JSON.stringify({
      orphan: {
        attempts: [{ at: answeredAt, correct: true, genre: "復旧対象", intervalDays: 28 }],
        dueAt: answeredAt + 28 * DAY,
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
