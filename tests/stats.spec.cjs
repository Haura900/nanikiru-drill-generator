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
  await expect(page.locator("#net-mature-meta")).toContainText("復習間隔 ≥ 28日・直近1か月・日次");
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
