const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.STUDIO_URL || "http://127.0.0.1:4949";
const screenshotPath = process.env.STUDIO_SCREENSHOT || "artifacts/studio-smoke.png";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const browserErrors = [];

  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });

  const response = await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 60_000 });
  assert(response, "dashboard navigation returned no response");
  assert.equal(response.status(), 200, `dashboard returned HTTP ${response.status()}`);
  assert.equal(await page.title(), "Voidarch Studio");

  await page.waitForSelector("#control", { state: "visible" });
  await page.waitForFunction(() => {
    const text = document.querySelector("#repoline")?.textContent || "";
    return text.length > 0 && !text.includes("connecting");
  }, { timeout: 60_000 });

  for (const selector of ["#control", "#agents", "#sessions", "#worktrees", "#runs", "#memory", "#health"]) {
    assert(await page.locator(selector).count(), `missing dashboard panel ${selector}`);
  }

  const sessions = page.locator("#sessions");
  assert(await sessions.getAttribute("open") !== null, "sessions panel should initially be open");
  await page.locator("#sessions > summary").click();
  assert.equal(await sessions.getAttribute("open"), null, "sessions panel did not collapse through the GUI");
  await page.locator("#sessions > summary").click();
  assert(await sessions.getAttribute("open") !== null, "sessions panel did not reopen through the GUI");

  await page.selectOption("#jump", "worktrees");
  await page.waitForTimeout(150);
  assert(await page.locator("#worktrees").getAttribute("open") !== null, "jump control did not open the Worktrees panel");

  const api = await page.evaluate(async () => {
    const stateResponse = await fetch("/api/state?fresh=1");
    const state = await stateResponse.json();
    const reposResponse = await fetch("/api/repos");
    const repos = await reposResponse.json();
    const sessionsResponse = await fetch("/api/sessions");
    const sessions = await sessionsResponse.json();
    const promptResponse = await fetch("/api/prompt/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "verify Studio public readiness", contextPack: "safe context" }),
    });
    const prompt = await promptResponse.json();
    const invalidRepoResponse = await fetch("/api/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    return {
      stateStatus: stateResponse.status,
      state,
      reposStatus: reposResponse.status,
      repos,
      sessionsStatus: sessionsResponse.status,
      sessions,
      promptStatus: promptResponse.status,
      prompt,
      invalidRepoStatus: invalidRepoResponse.status,
    };
  });

  assert.equal(api.stateStatus, 200);
  assert.equal(api.reposStatus, 200);
  assert.equal(api.sessionsStatus, 200);
  assert.equal(api.promptStatus, 200);
  assert.equal(api.invalidRepoStatus, 400, "missing repository root must be rejected");
  assert.equal(typeof api.state.repo?.root, "string", "state payload is missing repo.root");
  assert(Array.isArray(api.state.health), "state payload is missing health checks");
  assert(Array.isArray(api.state.sessions), "state payload is missing hooked sessions");
  assert(Array.isArray(api.state.worktrees), "state payload is missing worktrees");
  assert(Array.isArray(api.repos.repos), "repo registry payload is malformed");
  assert(Array.isArray(api.sessions.sessions), "session payload is malformed");
  assert(!api.prompt.error, `prompt renderer failed: ${api.prompt.error}`);
  assert(JSON.stringify(api.prompt).includes("verify Studio public readiness"), "prompt renderer lost the requested task");

  await page.screenshot({ path: screenshotPath, fullPage: true });
  await browser.close();

  assert.deepEqual(browserErrors, [], `browser errors:\n${browserErrors.join("\n")}`);
  console.log("Voidarch Studio daemon and Chromium GUI smoke test passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
