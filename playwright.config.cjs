module.exports = {
  testMatch: "**/*.spec.cjs",
  webServer: {
    command: "python -m http.server 18765 --directory docs",
    url: "http://127.0.0.1:18765/",
    reuseExistingServer: true,
  },
  use: {
    headless: true,
    launchOptions: process.platform === "win32" ? {
      executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    } : {},
  },
  timeout: 180000,
};
