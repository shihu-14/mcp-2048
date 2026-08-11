import assert from "node:assert/strict";
import test from "node:test";

import {
  GameController,
  normalizeDelay,
  normalizeDepth,
  normalizeMaxRestarts,
  normalizeMaxSteps,
} from "../../src/controller.js";

function boardAt(column = 0) {
  const board = Array.from({ length: 4 }, () => Array(4).fill(0));
  board[0][column % 4] = 2;
  return board;
}

function gameState({ board = boardAt(), status = "playing", score = 0 } = {}) {
  return {
    board,
    status,
    score,
    recognitionSource: "test",
    tileCount: board.flat().filter(Boolean).length,
    duplicateTiles: 0,
  };
}

function fakePage() {
  return {
    keyboard: {
      presses: [],
      async press(key) {
        this.presses.push(key);
      },
    },
    gotoCalls: 0,
    async bringToFront() {},
    async evaluate() {},
    async goto() {
      this.gotoCalls += 1;
    },
  };
}

function fakeBrowserManager(page = fakePage()) {
  return {
    page,
    closeCalls: 0,
    async withPage(_options, callback) {
      return callback(page);
    },
    async close() {
      this.closeCalls += 1;
    },
  };
}

const moveSelector = (_board, { depth }) => ({
  direction: "left",
  scores: { left: 1 },
  legalMoves: ["left"],
  scoreGain: 0,
  resultingBoard: boardAt(0),
  depth,
  gameOver: false,
});

test("controller validates bounded run options", () => {
  assert.equal(normalizeDelay(), 5);
  assert.equal(normalizeDepth(), 2);
  assert.equal(normalizeMaxSteps(), 3000);
  assert.equal(normalizeMaxRestarts(), 5);
  assert.throws(() => normalizeDelay(4), /5 to 1000/);
  assert.throws(() => normalizeDepth(6), /0 to 5/);
  assert.throws(() => normalizeMaxSteps(10001), /1 to 10000/);
  assert.throws(() => normalizeMaxRestarts(21), /0 to 20/);
});

test("play validates restartOnGameOver outside the MCP boundary", async () => {
  const controller = new GameController({
    browserManager: fakeBrowserManager(),
  });
  await assert.rejects(
    () => controller.play({ restartOnGameOver: "yes" }),
    /must be a boolean/,
  );
});

test("inspect returns a compact state and recommendation", async () => {
  const state = gameState();
  const controller = new GameController({
    browserManager: fakeBrowserManager(),
    recognition: {
      async waitForStableState() {
        return state;
      },
      async clearStoredGame() {},
    },
    moveSelector,
  });
  const result = await controller.inspect({ depth: 1 });
  assert.equal(result.emptyCellCount, 15);
  assert.equal(result.maxTile, 2);
  assert.equal(result.recommendation.direction, "left");
});

test("step retries focus once and reports recovery", async () => {
  const before = gameState({ board: boardAt(1) });
  const after = gameState({ board: boardAt(0), score: 4 });
  const states = [before, before, after];
  const page = fakePage();
  const controller = new GameController({
    browserManager: fakeBrowserManager(page),
    recognition: {
      async waitForStableState() {
        return states.shift();
      },
      async clearStoredGame() {},
    },
    moveSelector,
  });
  const result = await controller.step({ delayMs: 5, depth: 1 });
  assert.equal(result.recovered, true);
  assert.equal(result.stopped, false);
  assert.equal(page.keyboard.presses.length, 2);
});

test("step stops when a retried move leaves the board unchanged", async () => {
  const unchanged = gameState({ board: boardAt(1) });
  const controller = new GameController({
    browserManager: fakeBrowserManager(),
    recognition: {
      async waitForStableState() {
        return unchanged;
      },
      async clearStoredGame() {},
    },
    moveSelector,
  });
  const result = await controller.step({ delayMs: 5, depth: 1 });
  assert.equal(result.stopped, true);
  assert.equal(result.reason, "unchanged-board");
});

test("step stops before input for terminal and immovable boards", async () => {
  const terminal = new GameController({
    browserManager: fakeBrowserManager(),
    recognition: {
      async waitForStableState() {
        return gameState({ status: "won" });
      },
      async clearStoredGame() {},
    },
    moveSelector,
  });
  assert.equal((await terminal.step()).reason, "won");

  const immovable = new GameController({
    browserManager: fakeBrowserManager(),
    recognition: {
      async waitForStableState() {
        return gameState();
      },
      async clearStoredGame() {},
    },
    moveSelector() {
      return { direction: null };
    },
  });
  assert.equal((await immovable.step()).reason, "no-legal-moves");
});

test("play bounds recent moves independently of maxSteps", async () => {
  let stateCall = 0;
  const controller = new GameController({
    browserManager: fakeBrowserManager(),
    recognition: {
      async waitForStableState() {
        const state = gameState({
          board: boardAt(stateCall),
          score: stateCall,
        });
        stateCall += 1;
        return state;
      },
      async clearStoredGame() {},
    },
    moveSelector,
  });
  const result = await controller.play({
    maxSteps: 25,
    maxRestarts: 0,
    delayMs: 5,
    depth: 0,
  });
  assert.equal(result.reason, "max-steps");
  assert.equal(result.moveCount, 25);
  assert.equal(result.recentMoves.length, 20);
  assert.equal(result.recentMoves[0].move, 6);
  assert.equal(result.recentMoves[19].move, 25);
});

test("play restarts a game-over board without consuming a move", async () => {
  const states = [
    gameState({ status: "game-over" }),
    gameState(),
    gameState(),
    gameState({ board: boardAt(1) }),
    gameState({ status: "won", board: boardAt(1), score: 2048 }),
  ];
  let clears = 0;
  const page = fakePage();
  const controller = new GameController({
    browserManager: fakeBrowserManager(page),
    recognition: {
      async waitForStableState() {
        return states.shift();
      },
      async clearStoredGame() {
        clears += 1;
      },
    },
    moveSelector,
  });
  const result = await controller.play({
    maxSteps: 2,
    maxRestarts: 1,
    delayMs: 5,
    depth: 0,
  });
  assert.equal(result.reason, "won");
  assert.equal(result.restartCount, 1);
  assert.equal(result.moveCount, 1);
  assert.equal(clears, 1);
  assert.equal(page.gotoCalls, 1);
});

test("browser operations reject concurrency and controller closes its manager", async () => {
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const manager = fakeBrowserManager();
  const controller = new GameController({
    browserManager: manager,
    recognition: {
      async waitForStableState() {
        await pending;
        return gameState();
      },
      async clearStoredGame() {},
    },
    moveSelector,
  });
  const first = controller.inspect();
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => controller.step(), /browser is busy/);
  release();
  await first;
  await controller.close();
  assert.equal(manager.closeCalls, 1);
});
