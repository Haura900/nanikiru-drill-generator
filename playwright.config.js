module.exports = {
  webServer: {
    command: "python -m http.server 18765 --directory docs",
    url: "http://127.0.0.1:18765/",
    reuseExistingServer: true,
  },
  use: {
    headless: true,
    launchOptions: {
      executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    },
  },
  timeout: 180000,
};
