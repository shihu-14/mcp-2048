import { boardsEqual, emptyCells } from "./game.js";
import { BrowserManager, delay, pressDirection } from "./browser.js";
import {
  PLAY2048_URL,
  clearStoredGame,
  waitForStableState,
} from "./recognition.js";
import { chooseMove } from "./solver.js";

export const DEFAULT_DELAY_MS = 5;
export const DEFAULT_DEPTH = 2;
export const DEFAULT_MAX_STEPS = 3000;
export const DEFAULT_MAX_RESTARTS = 5;
export const MIN_DELAY_MS = 5;
export const MAX_DELAY_MS = 1000;
export const MAX_STEPS = 10000;
export const MAX_RESTARTS = 20;
export const RECENT_MOVE_LIMIT = 20;

export function normalizeDelay(delayMs = DEFAULT_DELAY_MS) {
  if (
    !Number.isInteger(delayMs) ||
    delayMs < MIN_DELAY_MS ||
    delayMs > MAX_DELAY_MS
  ) {
    throw new Error(
      `delayMs must be an integer from ${MIN_DELAY_MS} to ${MAX_DELAY_MS}.`,
    );
  }
  return delayMs;
}

export function normalizeDepth(depth = DEFAULT_DEPTH) {
  if (!Number.isInteger(depth) || depth < 0 || depth > 5) {
    throw new Error("depth must be an integer from 0 to 5.");
  }
  return depth;
}

export function normalizeMaxSteps(maxSteps = DEFAULT_MAX_STEPS) {
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > MAX_STEPS) {
    throw new Error(`maxSteps must be an integer from 1 to ${MAX_STEPS}.`);
  }
  return maxSteps;
}

export function normalizeMaxRestarts(maxRestarts = DEFAULT_MAX_RESTARTS) {
  if (
    !Number.isInteger(maxRestarts) ||
    maxRestarts < 0 ||
    maxRestarts > MAX_RESTARTS
  ) {
    throw new Error(
      `maxRestarts must be an integer from 0 to ${MAX_RESTARTS}.`,
    );
  }
  return maxRestarts;
}

function maxTile(board) {
  return Math.max(...board.flat());
}

function appendRecentMove(recentMoves, move) {
  recentMoves.push(move);
  if (recentMoves.length > RECENT_MOVE_LIMIT) recentMoves.shift();
}

export class GameController {
  #browserManager;
  #recognition;
  #chooseMove;
  #busy = false;

  constructor({
    browserManager = new BrowserManager({ targetUrl: PLAY2048_URL }),
    recognition = { waitForStableState, clearStoredGame },
    moveSelector = chooseMove,
  } = {}) {
    this.#browserManager = browserManager;
    this.#recognition = recognition;
    this.#chooseMove = moveSelector;
  }

  async #exclusive(callback) {
    if (this.#busy)
      throw new Error("2048 browser is busy with another operation.");
    this.#busy = true;
    try {
      return await callback();
    } finally {
      this.#busy = false;
    }
  }

  async #performStep(page, { delayMs, depth }) {
    const before = await this.#recognition.waitForStableState(page);
    if (before.status !== "playing") {
      return {
        stopped: true,
        reason: before.status,
        direction: null,
        before,
        after: before,
        recovered: false,
      };
    }

    const decision = this.#chooseMove(before.board, { depth });
    if (!decision.direction) {
      return {
        stopped: true,
        reason: "no-legal-moves",
        direction: null,
        before,
        after: before,
        recovered: false,
      };
    }

    await pressDirection(page, decision.direction, delayMs);
    let after = await this.#recognition.waitForStableState(page);
    let recovered = false;
    if (after.status === "playing" && boardsEqual(before.board, after.board)) {
      await pressDirection(page, decision.direction, delayMs);
      after = await this.#recognition.waitForStableState(page);
      recovered = !boardsEqual(before.board, after.board);
    }

    const unchanged =
      after.status === "playing" && boardsEqual(before.board, after.board);

    return {
      stopped: after.status !== "playing" || unchanged,
      reason: unchanged
        ? "unchanged-board"
        : after.status === "playing"
          ? null
          : after.status,
      direction: decision.direction,
      before,
      after,
      recovered,
    };
  }

  async #restart(page) {
    await this.#recognition.clearStoredGame(page);
    await page.goto(PLAY2048_URL, { waitUntil: "domcontentloaded" });
    await delay(150);
    return this.#recognition.waitForStableState(page);
  }

  async inspect(options = {}) {
    const depth = normalizeDepth(options.depth);
    return this.#exclusive(() =>
      this.#browserManager.withPage(options, async (page) => {
        const state = await this.#recognition.waitForStableState(page);
        return {
          state,
          emptyCellCount: emptyCells(state.board).length,
          maxTile: maxTile(state.board),
          recommendation: this.#chooseMove(state.board, { depth }),
        };
      }),
    );
  }

  async step(options = {}) {
    const runOptions = {
      delayMs: normalizeDelay(options.delayMs),
      depth: normalizeDepth(options.depth),
    };
    return this.#exclusive(() =>
      this.#browserManager.withPage(options, (page) =>
        this.#performStep(page, runOptions),
      ),
    );
  }

  async play(options = {}) {
    const restartOnGameOver = options.restartOnGameOver ?? true;
    if (typeof restartOnGameOver !== "boolean") {
      throw new Error("restartOnGameOver must be a boolean.");
    }
    const runOptions = {
      delayMs: normalizeDelay(options.delayMs),
      depth: normalizeDepth(options.depth),
      maxSteps: normalizeMaxSteps(options.maxSteps),
      maxRestarts: normalizeMaxRestarts(options.maxRestarts),
      restartOnGameOver,
    };

    return this.#exclusive(() =>
      this.#browserManager.withPage(options, async (page) => {
        const recentMoves = [];
        let moveCount = 0;
        let restartCount = 0;

        const finish = (reason, final) => ({
          stopped: true,
          reason,
          moveCount,
          restartCount,
          final,
          maxTile: maxTile(final.board),
          recentMoves,
        });

        const canRestart = (reason) =>
          runOptions.restartOnGameOver &&
          ["game-over", "no-legal-moves"].includes(reason) &&
          restartCount < runOptions.maxRestarts;

        while (moveCount < runOptions.maxSteps) {
          const result = await this.#performStep(page, runOptions);
          if (!result.direction) {
            if (canRestart(result.reason)) {
              restartCount += 1;
              await this.#restart(page);
              continue;
            }
            return finish(result.reason, result.after);
          }

          moveCount += 1;
          appendRecentMove(recentMoves, {
            move: moveCount,
            direction: result.direction,
            score: result.after.score,
            status: result.after.status,
            recovered: result.recovered,
          });

          if (result.stopped) {
            if (canRestart(result.reason)) {
              restartCount += 1;
              await this.#restart(page);
              continue;
            }
            return finish(result.reason, result.after);
          }
        }

        return finish(
          "max-steps",
          await this.#recognition.waitForStableState(page),
        );
      }),
    );
  }

  async close() {
    await this.#browserManager.close();
  }
}
