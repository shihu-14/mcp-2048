import puppeteer from "puppeteer-core";
import { boardsEqual, chooseMove, delay, emptyCells, keyForDirection } from "./game.js";
import { play2048StorageKey, recognizeSnapshot } from "./recognition.js";

export const DEFAULT_TARGET_URL = "https://play2048.co/";
export const DEFAULT_CONNECT_URL = "http://127.0.0.1:9222";
export const DEFAULT_BROWSER_MODE = "auto";
export const DEFAULT_BROWSER_EXECUTABLE_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const DEFAULT_DELAY_MS = 75;
export const DEFAULT_MAX_STEPS = 3000;
export const DEFAULT_MAX_RESTARTS = 5;
export const DEFAULT_DEPTH = 2;
export const MIN_DELAY_MS = 50;
export const MAX_DELAY_MS = 1000;
const PLAY2048_STORAGE_MODES = ["tutorial", "standard", "classic", "partner1"];

let launchedBrowser = null;

export function normalizeDelay(delayMs = DEFAULT_DELAY_MS) {
  if (!Number.isInteger(delayMs)) {
    throw new Error("delayMs must be an integer.");
  }
  if (delayMs < MIN_DELAY_MS) {
    throw new Error(`delayMs must be at least ${MIN_DELAY_MS}ms.`);
  }
  if (delayMs > MAX_DELAY_MS) {
    throw new Error(`delayMs must be ${MAX_DELAY_MS}ms or less.`);
  }
  return delayMs;
}

export function normalizeMaxSteps(maxSteps = DEFAULT_MAX_STEPS) {
  if (!Number.isInteger(maxSteps) || maxSteps <= 0) {
    throw new Error("maxSteps must be a positive integer.");
  }
  return maxSteps;
}

export function normalizeMaxRestarts(maxRestarts = DEFAULT_MAX_RESTARTS) {
  if (!Number.isInteger(maxRestarts) || maxRestarts < 0) {
    throw new Error("maxRestarts must be a non-negative integer.");
  }
  return maxRestarts;
}

function normalizeBrowserMode(browserMode = DEFAULT_BROWSER_MODE) {
  if (!["auto", "connect", "launch"].includes(browserMode)) {
    throw new Error('browserMode must be "auto", "connect", or "launch".');
  }
  return browserMode;
}

export async function connectBrowser(connectUrl = DEFAULT_CONNECT_URL) {
  return puppeteer.connect({
    browserURL: connectUrl,
    defaultViewport: null
  });
}

async function launchBrowser(options = {}) {
  if (launchedBrowser?.isConnected()) {
    return launchedBrowser;
  }

  const executablePath = options.browserExecutablePath ??
    process.env.MCP_2048_BROWSER_EXECUTABLE_PATH ??
    DEFAULT_BROWSER_EXECUTABLE_PATH;

  launchedBrowser = await puppeteer.launch({
    executablePath,
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
      "--v=0"
    ]
  });

  launchedBrowser.on("disconnected", () => {
    launchedBrowser = null;
  });

  return launchedBrowser;
}

export async function getBrowser(options = {}) {
  const browserMode = normalizeBrowserMode(options.browserMode);

  if (browserMode === "launch") {
    return {
      browser: await launchBrowser(options),
      shouldDisconnect: false
    };
  }

  if (browserMode === "connect") {
    return {
      browser: await connectBrowser(options.connectUrl ?? DEFAULT_CONNECT_URL),
      shouldDisconnect: true
    };
  }

  try {
    return {
      browser: await connectBrowser(options.connectUrl ?? DEFAULT_CONNECT_URL),
      shouldDisconnect: true
    };
  } catch (error) {
    if (options.connectUrl && options.connectUrl !== DEFAULT_CONNECT_URL) {
      throw error;
    }
    return {
      browser: await launchBrowser(options),
      shouldDisconnect: false
    };
  }
}

function pageMatchesTarget(pageUrl, targetUrl) {
  try {
    const page = new URL(pageUrl);
    const target = new URL(targetUrl);

    if (page.origin !== target.origin) {
      return false;
    }

    if (target.pathname === "/" || target.pathname === "") {
      return page.pathname === "/" || page.pathname === "";
    }

    return page.pathname.startsWith(target.pathname);
  } catch {
    return pageUrl.includes(targetUrl);
  }
}

async function findOrOpenPage(browser, targetUrl = DEFAULT_TARGET_URL) {
  const pages = await browser.pages();
  const matchingPage = pages.find((page) => pageMatchesTarget(page.url(), targetUrl));

  if (matchingPage) {
    await matchingPage.bringToFront();
    return matchingPage;
  }

  const page = pages[0] ?? await browser.newPage();
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.bringToFront();
  return page;
}

export async function getGamePage(options = {}) {
  const { browser, shouldDisconnect } = await getBrowser(options);
  try {
    const page = await findOrOpenPage(browser, options.targetUrl ?? DEFAULT_TARGET_URL);
    return { browser, page, shouldDisconnect };
  } catch (error) {
    if (shouldDisconnect) {
      await browser.disconnect();
    }
    throw error;
  }
}

export async function readBoard(page) {
  const snapshot = await page.evaluate(() => {
    const tiles = Array.from(document.querySelectorAll(".tile-container .tile"));
    const messageElement = document.querySelector(".game-message");
    const messageText = messageElement?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const messageClass = messageElement?.className ?? "";
    const scoreText = document.querySelector(".score-container")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const localStorageEntries = [];

    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        const value = key ? localStorage.getItem(key) : null;
        if (key && value) {
          localStorageEntries.push([key, value]);
        }
      }
    } catch {
      // Some browser contexts can block localStorage. DOM recognition may still work.
    }

    return {
      tileClassNames: tiles.map((tile) => typeof tile.className === "string" ? tile.className : tile.className?.baseVal ?? ""),
      localStorageEntries,
      locationPath: window.location?.pathname ?? "",
      scoreText,
      messageText,
      messageClass
    };
  });

  const recognized = recognizeSnapshot(snapshot);
  if (!recognized.recognized) {
    throw new Error("Could not recognize a 2048 board from DOM tiles or play2048.co storage.");
  }

  return recognized;
}

export async function waitForStableBoard(page, options = {}) {
  const samples = Number.isInteger(options.samples) ? options.samples : 2;
  const intervalMs = Number.isInteger(options.intervalMs) ? options.intervalMs : 50;
  let previous = null;
  let stableCount = 0;
  let lastError = null;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    let current;
    try {
      current = await readBoard(page);
      lastError = null;
    } catch (error) {
      lastError = error;
      await delay(intervalMs);
      continue;
    }

    const serialized = JSON.stringify({
      board: current.board,
      status: current.status,
      scoreText: current.scoreText
    });

    if (serialized === previous) {
      stableCount += 1;
      if (stableCount >= samples - 1) {
        return current;
      }
    } else {
      stableCount = 0;
      previous = serialized;
    }

    await delay(intervalMs);
  }

  if (lastError) {
    throw lastError;
  }

  return readBoard(page);
}

async function focusGame(page) {
  await page.bringToFront();
  await page.evaluate(() => {
    window.focus();
    document.body?.focus?.();
    const board = document.querySelector("canvas, .game-container, #app");
    board?.dispatchEvent?.(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function pressMove(page, direction, delayMs) {
  const key = keyForDirection(direction);
  await focusGame(page);
  await page.keyboard.press(key);
  await delay(delayMs);
  return key;
}

async function resetGame(page, targetUrl = DEFAULT_TARGET_URL) {
  const storageKeys = [
    "gameState",
    ...PLAY2048_STORAGE_MODES.map((mode) => play2048StorageKey(`k-${mode}`))
  ];

  await page.evaluate((keys) => {
    for (const key of keys) {
      localStorage.removeItem(key);
    }
  }, storageKeys);

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await delay(150);
  return waitForStableBoard(page);
}

export async function inspect2048(options = {}) {
  const { browser, page, shouldDisconnect } = await getGamePage(options);
  try {
    const state = await waitForStableBoard(page);
    return {
      ...state,
      emptyCells: emptyCells(state.board),
      recommendation: chooseMove(state.board, { depth: options.depth ?? DEFAULT_DEPTH })
    };
  } finally {
    if (shouldDisconnect) {
      await browser.disconnect();
    }
  }
}

export async function step2048(options = {}) {
  const delayMs = normalizeDelay(options.delayMs ?? DEFAULT_DELAY_MS);
  const targetUrl = options.targetUrl ?? DEFAULT_TARGET_URL;
  const { browser, page, shouldDisconnect } = await getGamePage(options);

  try {
    const before = await waitForStableBoard(page);
    if (before.status !== "playing") {
      return {
        stopped: true,
        reason: before.status,
        before,
        after: before
      };
    }

    const decision = chooseMove(before.board, { depth: options.depth ?? DEFAULT_DEPTH });
    if (!decision.direction) {
      return {
        stopped: true,
        reason: "no-legal-moves",
        before,
        after: before,
        decision
      };
    }

    const key = await pressMove(page, decision.direction, delayMs);
    let after = await waitForStableBoard(page);
    let recovered = false;

    if (after.status === "playing" && boardsEqual(before.board, after.board)) {
      await focusGame(page);
      await page.keyboard.press(key);
      await delay(delayMs);
      after = await waitForStableBoard(page);
      recovered = !boardsEqual(before.board, after.board);
    }

    return {
      stopped: after.status !== "playing",
      reason: after.status === "playing" ? null : after.status,
      direction: decision.direction,
      key,
      before,
      after,
      decision,
      recovered,
      targetUrl
    };
  } finally {
    if (shouldDisconnect) {
      await browser.disconnect();
    }
  }
}

export async function play2048(options = {}) {
  const delayMs = normalizeDelay(options.delayMs ?? DEFAULT_DELAY_MS);
  const maxSteps = normalizeMaxSteps(options.maxSteps ?? DEFAULT_MAX_STEPS);
  const maxRestarts = normalizeMaxRestarts(options.maxRestarts ?? DEFAULT_MAX_RESTARTS);
  const restartOnGameOver = options.restartOnGameOver ?? true;
  const targetUrl = options.targetUrl ?? DEFAULT_TARGET_URL;
  const { browser, page, shouldDisconnect } = await getGamePage(options);
  const history = [];
  let restarts = 0;
  let unchangedMoves = 0;

  try {
    for (let step = 1; step <= maxSteps; step += 1) {
      const before = await waitForStableBoard(page);

      if (before.status !== "playing") {
        if (before.status === "game-over" && restartOnGameOver && restarts < maxRestarts) {
          restarts += 1;
          const resetState = await resetGame(page, targetUrl);
          history.push({
            step,
            type: "restart",
            reason: "game-over",
            restarts,
            after: resetState.board,
            status: resetState.status,
            scoreText: resetState.scoreText
          });
          continue;
        }

        return {
          stopped: true,
          reason: before.status,
          steps: history.length,
          restarts,
          final: before,
          history
        };
      }

      const decision = chooseMove(before.board, { depth: options.depth ?? DEFAULT_DEPTH });
      if (!decision.direction) {
        if (restartOnGameOver && restarts < maxRestarts) {
          restarts += 1;
          const resetState = await resetGame(page, targetUrl);
          history.push({
            step,
            type: "restart",
            reason: "no-legal-moves",
            restarts,
            after: resetState.board,
            status: resetState.status,
            scoreText: resetState.scoreText
          });
          continue;
        }

        return {
          stopped: true,
          reason: "no-legal-moves",
          steps: history.length,
          restarts,
          final: before,
          history
        };
      }

      const key = await pressMove(page, decision.direction, delayMs);
      let after = await waitForStableBoard(page);
      let recovered = false;

      if (after.status === "playing" && boardsEqual(before.board, after.board)) {
        await focusGame(page);
        await page.keyboard.press(key);
        await delay(delayMs);
        after = await waitForStableBoard(page);
        recovered = !boardsEqual(before.board, after.board);
      }

      if (after.status === "playing" && boardsEqual(before.board, after.board)) {
        unchangedMoves += 1;
      } else {
        unchangedMoves = 0;
      }

      history.push({
        step,
        type: "move",
        direction: decision.direction,
        key,
        before: before.board,
        after: after.board,
        status: after.status,
        scoreText: after.scoreText,
        decisionScores: decision.scores,
        recovered
      });

      if (after.status !== "playing") {
        if (after.status === "game-over" && restartOnGameOver && restarts < maxRestarts) {
          restarts += 1;
          const resetState = await resetGame(page, targetUrl);
          history.push({
            step,
            type: "restart",
            reason: "game-over",
            restarts,
            after: resetState.board,
            status: resetState.status,
            scoreText: resetState.scoreText
          });
          continue;
        }

        return {
          stopped: true,
          reason: after.status,
          steps: history.length,
          restarts,
          final: after,
          history
        };
      }

      if (unchangedMoves >= 3) {
        return {
          stopped: true,
          reason: "unchanged-board",
          steps: history.length,
          restarts,
          final: after,
          history
        };
      }
    }

    const final = await waitForStableBoard(page);
    return {
      stopped: true,
      reason: "max-steps",
      steps: history.length,
      restarts,
      final,
      history
    };
  } finally {
    if (shouldDisconnect) {
      await browser.disconnect();
    }
  }
}

export async function start2048(options = {}) {
  return play2048({
    browserMode: DEFAULT_BROWSER_MODE,
    targetUrl: DEFAULT_TARGET_URL,
    maxSteps: DEFAULT_MAX_STEPS,
    delayMs: DEFAULT_DELAY_MS,
    restartOnGameOver: true,
    maxRestarts: DEFAULT_MAX_RESTARTS,
    depth: DEFAULT_DEPTH,
    ...options
  });
}
