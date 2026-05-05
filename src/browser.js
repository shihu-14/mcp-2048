import puppeteer from "puppeteer-core";
import { chooseMove, delay, emptyCells, keyForDirection } from "./game.js";
import { recognizeSnapshot } from "./recognition.js";

export const DEFAULT_TARGET_URL = "https://play2048.co/tutorial";
export const DEFAULT_CONNECT_URL = "http://127.0.0.1:9222";
export const DEFAULT_DELAY_MS = 700;
export const DEFAULT_MAX_STEPS = 200;
export const MIN_DELAY_MS = 500;

export function normalizeDelay(delayMs = DEFAULT_DELAY_MS) {
  if (!Number.isInteger(delayMs)) {
    throw new Error("delayMs must be an integer.");
  }
  if (delayMs < MIN_DELAY_MS) {
    throw new Error(`delayMs must be at least ${MIN_DELAY_MS}ms.`);
  }
  if (delayMs > 1000) {
    throw new Error("delayMs must be 1000ms or less.");
  }
  return delayMs;
}

export function normalizeMaxSteps(maxSteps = DEFAULT_MAX_STEPS) {
  if (!Number.isInteger(maxSteps) || maxSteps <= 0) {
    throw new Error("maxSteps must be a positive integer.");
  }
  return maxSteps;
}

export async function connectBrowser(connectUrl = DEFAULT_CONNECT_URL) {
  return puppeteer.connect({
    browserURL: connectUrl,
    defaultViewport: null
  });
}

async function findOrOpenPage(browser, targetUrl = DEFAULT_TARGET_URL) {
  const pages = await browser.pages();
  const matchingPage = pages.find((page) => page.url().includes(targetUrl));

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
  const browser = await connectBrowser(options.connectUrl ?? DEFAULT_CONNECT_URL);
  try {
    const page = await findOrOpenPage(browser, options.targetUrl ?? DEFAULT_TARGET_URL);
    return { browser, page };
  } catch (error) {
    await browser.disconnect();
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
  const intervalMs = Number.isInteger(options.intervalMs) ? options.intervalMs : 150;
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

export async function inspect2048(options = {}) {
  const { browser, page } = await getGamePage(options);
  try {
    const state = await waitForStableBoard(page);
    return {
      ...state,
      emptyCells: emptyCells(state.board),
      recommendation: chooseMove(state.board, { depth: options.depth })
    };
  } finally {
    await browser.disconnect();
  }
}

export async function step2048(options = {}) {
  const delayMs = normalizeDelay(options.delayMs ?? DEFAULT_DELAY_MS);
  const { browser, page } = await getGamePage(options);

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

    const decision = chooseMove(before.board, { depth: options.depth });
    if (!decision.direction) {
      return {
        stopped: true,
        reason: "no-legal-moves",
        before,
        after: before,
        decision
      };
    }

    await page.keyboard.press(keyForDirection(decision.direction));
    await delay(delayMs);
    const after = await waitForStableBoard(page);

    return {
      stopped: after.status !== "playing",
      reason: after.status === "playing" ? null : after.status,
      direction: decision.direction,
      key: keyForDirection(decision.direction),
      before,
      after,
      decision
    };
  } finally {
    await browser.disconnect();
  }
}

export async function play2048(options = {}) {
  const delayMs = normalizeDelay(options.delayMs ?? DEFAULT_DELAY_MS);
  const maxSteps = normalizeMaxSteps(options.maxSteps ?? DEFAULT_MAX_STEPS);
  const { browser, page } = await getGamePage(options);
  const history = [];

  try {
    for (let step = 1; step <= maxSteps; step += 1) {
      const before = await waitForStableBoard(page);

      if (before.status !== "playing") {
        return {
          stopped: true,
          reason: before.status,
          steps: history.length,
          final: before,
          history
        };
      }

      const decision = chooseMove(before.board, { depth: options.depth });
      if (!decision.direction) {
        return {
          stopped: true,
          reason: "no-legal-moves",
          steps: history.length,
          final: before,
          history
        };
      }

      const key = keyForDirection(decision.direction);
      await page.keyboard.press(key);
      await delay(delayMs);
      const after = await waitForStableBoard(page);

      history.push({
        step,
        direction: decision.direction,
        key,
        before: before.board,
        after: after.board,
        status: after.status,
        scoreText: after.scoreText,
        decisionScores: decision.scores
      });

      if (after.status !== "playing") {
        return {
          stopped: true,
          reason: after.status,
          steps: history.length,
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
      final,
      history
    };
  } finally {
    await browser.disconnect();
  }
}
