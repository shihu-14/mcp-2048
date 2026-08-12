import puppeteer from "puppeteer-core";

export const DEFAULT_BROWSER_MODE = "auto";
export const DEFAULT_CONNECT_URL = "http://127.0.0.1:9222";

const BROWSER_MODES = ["auto", "connect", "launch"];
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const DIRECTION_KEYS = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
};

export function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function keyForDirection(direction) {
  const key = DIRECTION_KEYS[direction];
  if (!key) throw new Error(`Unsupported direction: ${direction}`);
  return key;
}

export function normalizeBrowserMode(browserMode = DEFAULT_BROWSER_MODE) {
  if (!BROWSER_MODES.includes(browserMode)) {
    throw new Error('browserMode must be "auto", "connect", or "launch".');
  }
  return browserMode;
}

function normalizeConnectUrl(connectUrl = DEFAULT_CONNECT_URL) {
  let parsed;
  try {
    parsed = new URL(connectUrl);
  } catch {
    throw new Error("connectUrl must be a valid HTTP or HTTPS URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("connectUrl must be a valid HTTP or HTTPS URL.");
  }
  if (!LOOPBACK_HOSTNAMES.has(parsed.hostname)) {
    throw new Error(
      "connectUrl must use the loopback host localhost, 127.0.0.1, or ::1.",
    );
  }
  return parsed.href.replace(/\/$/, "");
}

function pageMatchesTarget(pageUrl, targetUrl) {
  try {
    const page = new URL(pageUrl);
    const target = new URL(targetUrl);
    return page.origin === target.origin && page.pathname === target.pathname;
  } catch {
    return false;
  }
}

function assertTargetPage(page, targetUrl) {
  if (!pageMatchesTarget(page.url(), targetUrl)) {
    throw new Error(
      `Refusing to control a page outside the configured 2048 URL: ${targetUrl}`,
    );
  }
}

export async function focusGame(page) {
  await page.bringToFront();
  await page.evaluate(() => {
    window.focus();
    document.body?.focus?.();
    const board = document.querySelector("canvas, .game-container, #app");
    board?.dispatchEvent?.(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

export async function pressDirection(page, direction, delayMs) {
  const key = keyForDirection(direction);
  await focusGame(page);
  await page.keyboard.press(key);
  await delay(delayMs);
}

export class BrowserManager {
  #puppeteer;
  #targetUrl;
  #launchedBrowser = null;

  constructor({ targetUrl, puppeteerApi = puppeteer } = {}) {
    if (!targetUrl) throw new Error("BrowserManager requires a targetUrl.");
    this.#targetUrl = targetUrl;
    this.#puppeteer = puppeteerApi;
  }

  async #connect(connectUrl) {
    return this.#puppeteer.connect({
      browserURL: connectUrl,
      defaultViewport: null,
    });
  }

  async #launch(options) {
    if (this.#launchedBrowser?.isConnected?.()) return this.#launchedBrowser;

    const executablePath = process.env.MCP_2048_BROWSER_EXECUTABLE_PATH;
    const launchOptions = {
      browser: "chrome",
      headless: options.headless ?? false,
      defaultViewport: null,
      dumpio: false,
      args: [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-extensions",
        "--disable-features=Translate,OptimizationHints,MediaRouter,AutofillServerCommunication",
        "--disable-sync",
        "--log-level=3",
        "--v=0",
      ],
    };
    if (executablePath) launchOptions.executablePath = executablePath;
    else launchOptions.channel = "chrome";

    const browser = await this.#puppeteer.launch(launchOptions);
    this.#launchedBrowser = browser;
    browser.on?.("disconnected", () => {
      if (this.#launchedBrowser === browser) this.#launchedBrowser = null;
    });
    return browser;
  }

  async #acquire(options) {
    const browserMode = normalizeBrowserMode(options.browserMode);
    if (browserMode === "launch") {
      return { browser: await this.#launch(options), connected: false };
    }

    const connectUrl = normalizeConnectUrl(
      options.connectUrl ?? DEFAULT_CONNECT_URL,
    );
    if (browserMode === "connect") {
      return {
        browser: await this.#connect(connectUrl),
        connected: true,
      };
    }

    try {
      return {
        browser: await this.#connect(connectUrl),
        connected: true,
      };
    } catch {
      return { browser: await this.#launch(options), connected: false };
    }
  }

  async #findOrOpenPage(browser) {
    const pages = await browser.pages();
    const matchingPage = pages.find((page) =>
      pageMatchesTarget(page.url(), this.#targetUrl),
    );
    if (matchingPage) {
      await matchingPage.bringToFront();
      assertTargetPage(matchingPage, this.#targetUrl);
      return matchingPage;
    }

    const page = await browser.newPage();
    await page.goto(this.#targetUrl, { waitUntil: "domcontentloaded" });
    assertTargetPage(page, this.#targetUrl);
    await page.bringToFront();
    assertTargetPage(page, this.#targetUrl);
    return page;
  }

  async withPage(options, callback) {
    const { browser, connected } = await this.#acquire(options);
    try {
      return await callback(await this.#findOrOpenPage(browser));
    } finally {
      if (connected) await browser.disconnect();
    }
  }

  async close() {
    const browser = this.#launchedBrowser;
    this.#launchedBrowser = null;
    if (browser?.isConnected?.()) await browser.close();
  }
}
