import assert from "node:assert/strict";
import test from "node:test";

import {
  boardsEqual,
  cloneBoard,
  emptyCells,
  isGameOver,
  isTileValue,
  legalMoves,
  moveBoard,
  normalizeBoard,
  slideLineLeft,
} from "../../src/game.js";

test("normalizeBoard accepts canonical tiles and returns a copy", () => {
  const board = [
    [2, 4, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 2048],
  ];
  const normalized = normalizeBoard(board);
  assert.deepEqual(normalized, board);
  assert.notEqual(normalized, board);
  assert.notEqual(normalized[0], board[0]);
  assert.equal(isTileValue(0), true);
  assert.equal(isTileValue(4096), true);
  assert.equal(isTileValue(3), false);
  assert.equal(isTileValue(Number.MAX_SAFE_INTEGER), false);
});

test("normalizeBoard rejects malformed and noncanonical boards", () => {
  assert.throws(() => normalizeBoard([]), /4x4/);
  assert.throws(
    () => normalizeBoard([[2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]),
    /exactly 4/,
  );
  assert.throws(
    () =>
      normalizeBoard([
        [3, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
    /power of two/,
  );
  assert.throws(() => slideLineLeft([2, 2]), /exactly 4/);
});

test("slideLineLeft merges every tile at most once", () => {
  assert.deepEqual(slideLineLeft([2, 2, 2, 2]), {
    line: [4, 4, 0, 0],
    scoreGain: 8,
    moved: true,
  });
  assert.deepEqual(slideLineLeft([2, 2, 2, 0]), {
    line: [4, 2, 0, 0],
    scoreGain: 4,
    moved: true,
  });
  assert.deepEqual(slideLineLeft([2, 4, 8, 16]), {
    line: [2, 4, 8, 16],
    scoreGain: 0,
    moved: false,
  });
});

test("moveBoard moves and merges in all directions", () => {
  const board = [
    [2, 0, 2, 4],
    [0, 4, 4, 0],
    [2, 2, 2, 0],
    [0, 0, 0, 0],
  ];
  assert.deepEqual(moveBoard(board, "left").board, [
    [4, 4, 0, 0],
    [8, 0, 0, 0],
    [4, 2, 0, 0],
    [0, 0, 0, 0],
  ]);
  assert.deepEqual(moveBoard(board, "right").board, [
    [0, 0, 4, 4],
    [0, 0, 0, 8],
    [0, 0, 2, 4],
    [0, 0, 0, 0],
  ]);
  assert.deepEqual(moveBoard(board, "up").board, [
    [4, 4, 2, 4],
    [0, 2, 4, 0],
    [0, 0, 2, 0],
    [0, 0, 0, 0],
  ]);
  assert.deepEqual(moveBoard(board, "down").board, [
    [0, 0, 0, 0],
    [0, 0, 2, 0],
    [0, 4, 4, 0],
    [4, 2, 2, 4],
  ]);
  assert.throws(() => moveBoard(board, "diagonal"), /Unsupported/);
});

test("board helpers report empties, equality, legal moves, and game over", () => {
  const open = [
    [2, 4, 8, 16],
    [32, 0, 128, 256],
    [512, 1024, 2048, 4096],
    [8192, 16384, 32768, 65536],
  ];
  const closed = [
    [2, 4, 8, 16],
    [32, 64, 128, 256],
    [512, 1024, 2048, 4096],
    [8192, 16384, 32768, 65536],
  ];
  assert.deepEqual(emptyCells(open), [{ row: 1, column: 1 }]);
  assert.equal(isGameOver(open), false);
  assert.equal(isGameOver(closed), true);
  assert.deepEqual(legalMoves(closed), []);
  assert.equal(boardsEqual(open, cloneBoard(open)), true);
  assert.equal(boardsEqual(open, closed), false);
});
