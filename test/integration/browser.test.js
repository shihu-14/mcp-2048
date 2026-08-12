import assert from "node:assert/strict";
import test from "node:test";

import {
  BrowserManager,
  focusGame,
  keyForDirection,
  normalizeBrowserMode,
  pressDirection,
} from "../../src/browser.js";

const TARGET_URL = "https://play2048.co/";

class FakePage {
  constructor(url = "about:blank", { gotoUrl = null, frontUrl = null } = {}) {
    this.currentUrl = url;
    this.gotoUrl = gotoUrl;
    this.frontUrl = frontUrl;
    this.gotoCalls = [];
    this.frontCalls = 0;
    this.evaluateCalls = 0;
    this.keys = [];
    this.keyboard = { press: async (key) => this.keys.push(key) };
  }

  url() {
    return this.currentUrl;
  }

  async goto(url) {
    this.currentUrl = this.gotoUrl ?? url;
    this.gotoCalls.push(url);
  }

  async bringToFront() {
    this.frontCalls += 1;
    if (this.frontUrl) this.currentUrl = this.frontUrl;
  }

  async evaluate() {
    this.evaluateCalls += 1;
  }
}

class FakeBrowser {
  constructor(pages = []) {
    this.pageList = pages;
    this.disconnectCalls = 0;
    this.closeCalls = 0;
    this.connected = true;
    this.listeners = new Map();
  }

  async pages() {
    return this.pageList;
  }

  async newPage() {
    const page = new FakePage();
    this.pageList.push(page);
    return page;
  }

  disconnect() {
    this.disconnectCalls += 1;
  }

  async close() {
    this.closeCalls += 1;
    this.connected = false;
    this.listeners.get("disconnected")?.();
  }

  isConnected() {
    return this.connected;
  }

  on(name, listener) {
    this.listeners.set(name, listener);
  }
}

test("connect mode reuses a matching page and only disconnects", async () => {
  const matching = new FakePage(TARGET_URL);
  const browser = new FakeBrowser([matching]);
  const connectOptions = [];
  const manager = new BrowserManager({
    targetUrl: TARGET_URL,
    puppeteerApi: {
      async connect(options) {
        connectOptions.push(options);
        return browser;
      },
    },
  });

  const value = await manager.withPage(
    { browserMode: "connect" },
    async (page) => {
      assert.equal(page, matching);
      return 42;
    },
  );
  assert.equal(value, 42);
  assert.equal(browser.disconnectCalls, 1);
  assert.equal(browser.closeCalls, 0);
  assert.equal(connectOptions[0].browserURL, "http://127.0.0.1:9222");
});

test("connect mode opens a new page without overwriting unrelated tabs", async () => {
  const unrelated = new FakePage("https://example.com/");
  const browser = new FakeBrowser([unrelated]);
  const manager = new BrowserManager({
    targetUrl: TARGET_URL,
    puppeteerApi: {
      async connect() {
        return browser;
      },
    },
  });
  await manager.withPage({ browserMode: "connect" }, async (page) => {
    assert.notEqual(page, unrelated);
    assert.equal(page.url(), TARGET_URL);
  });
  assert.deepEqual(unrelated.gotoCalls, []);
});

test("launch mode discovers Chrome by channel, reuses it, and closes it", async () => {
  const browser = new FakeBrowser();
  const launchOptions = [];
  const manager = new BrowserManager({
    targetUrl: TARGET_URL,
    puppeteerApi: {
      async launch(options) {
        launchOptions.push(options);
        return browser;
      },
    },
  });
  await manager.withPage(
    { browserMode: "launch", headless: true },
    async () => {},
  );
  await manager.withPage(
    { browserMode: "launch", headless: true },
    async () => {},
  );
  assert.equal(launchOptions.length, 1);
  assert.equal(launchOptions[0].channel, "chrome");
  assert.equal(launchOptions[0].headless, true);
  await manager.close();
  assert.equal(browser.closeCalls, 1);
});

test("environment executable path wins and auto falls back to launch", async () => {
  const browser = new FakeBrowser();
  let launchedWith;
  const manager = new BrowserManager({
    targetUrl: TARGET_URL,
    puppeteerApi: {
      async connect() {
        throw new Error("offline");
      },
      async launch(options) {
        launchedWith = options;
        return browser;
      },
    },
  });
  const previousExecutablePath = process.env.MCP_2048_BROWSER_EXECUTABLE_PATH;
  process.env.MCP_2048_BROWSER_EXECUTABLE_PATH = "/opt/chrome";
  try {
    await manager.withPage({ browserMode: "auto" }, async () => {});
    assert.equal(launchedWith.executablePath, "/opt/chrome");
    assert.equal("channel" in launchedWith, false);
    await manager.close();
  } finally {
    if (previousExecutablePath === undefined) {
      delete process.env.MCP_2048_BROWSER_EXECUTABLE_PATH;
    } else {
      process.env.MCP_2048_BROWSER_EXECUTABLE_PATH = previousExecutablePath;
    }
  }
});

test("browser input helpers validate and press arrow keys", async () => {
  const page = new FakePage();
  assert.equal(keyForDirection("left"), "ArrowLeft");
  assert.throws(() => keyForDirection("invalid"), /Unsupported/);
  assert.equal(normalizeBrowserMode(), "auto");
  assert.throws(() => normalizeBrowserMode("invalid"), /browserMode/);
  await focusGame(page);
  await pressDirection(page, "right", 0);
  assert.deepEqual(page.keys, ["ArrowRight"]);
  assert.equal(page.evaluateCalls, 2);
});

test("connect mode accepts only HTTP(S) loopback DevTools URLs", async () => {
  const accepted = [];
  for (const connectUrl of [
    "http://localhost:9222",
    "https://127.0.0.1:9222",
    "http://[::1]:9222",
  ]) {
    const browser = new FakeBrowser([new FakePage(TARGET_URL)]);
    const manager = new BrowserManager({
      targetUrl: TARGET_URL,
      puppeteerApi: {
        async connect(options) {
          accepted.push(options.browserURL);
          return browser;
        },
      },
    });
    await manager.withPage(
      { browserMode: "connect", connectUrl },
      async () => {},
    );
  }
  assert.deepEqual(accepted, [
    "http://localhost:9222",
    "https://127.0.0.1:9222",
    "http://[::1]:9222",
  ]);

  let connectCalls = 0;
  const manager = new BrowserManager({
    targetUrl: TARGET_URL,
    puppeteerApi: {
      async connect() {
        connectCalls += 1;
        throw new Error("should not run");
      },
    },
  });
  for (const [browserMode, connectUrl] of [
    ["auto", "https://example.com"],
    ["connect", "http://192.168.1.10:9222"],
    ["connect", "http://169.254.169.254"],
  ]) {
    await assert.rejects(
      () => manager.withPage({ browserMode, connectUrl }, async () => {}),
      /loopback host/,
    );
  }
  for (const connectUrl of ["file:///tmp/chrome", "invalid"]) {
    await assert.rejects(
      () =>
        manager.withPage({ browserMode: "auto", connectUrl }, async () => {}),
      /HTTP or HTTPS/,
    );
  }
  assert.equal(connectCalls, 0);
});

test("new pages reject redirects outside the target origin and path", async () => {
  const browser = new FakeBrowser();
  const redirected = new FakePage("about:blank", {
    gotoUrl: "https://example.com/",
  });
  browser.newPage = async () => {
    browser.pageList.push(redirected);
    return redirected;
  };
  const manager = new BrowserManager({
    targetUrl: TARGET_URL,
    puppeteerApi: { connect: async () => browser },
  });
  let callbackCalled = false;
  await assert.rejects(
    () =>
      manager.withPage({ browserMode: "connect" }, async () => {
        callbackCalled = true;
      }),
    /Refusing to control/,
  );
  assert.equal(callbackCalled, false);
  assert.equal(browser.disconnectCalls, 1);
});

test("reused pages are revalidated immediately before use", async () => {
  const matching = new FakePage(TARGET_URL, {
    frontUrl: "https://play2048.co/classic",
  });
  const browser = new FakeBrowser([matching]);
  const manager = new BrowserManager({
    targetUrl: TARGET_URL,
    puppeteerApi: { connect: async () => browser },
  });
  let callbackCalled = false;
  await assert.rejects(
    () =>
      manager.withPage({ browserMode: "connect" }, async () => {
        callbackCalled = true;
      }),
    /Refusing to control/,
  );
  assert.equal(callbackCalled, false);
  assert.equal(browser.disconnectCalls, 1);
});
