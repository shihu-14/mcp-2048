import assert from "node:assert/strict";
import test from "node:test";

import { chooseMove, evaluateBoard } from "../../src/solver.js";

test("evaluateBoard rewards open playable boards and rejects game over", () => {
  const open = [
    [2, 2, 0, 0],
    [4, 0, 0, 0],
    [8, 0, 0, 0],
    [16, 0, 0, 0],
  ];
  const crowded = [
    [2, 4, 8, 16],
    [32, 64, 128, 256],
    [512, 1024, 2048, 4096],
    [8192, 16384, 32768, 65536],
  ];
  assert.ok(evaluateBoard(open) > evaluateBoard(crowded));
  assert.equal(evaluateBoard(crowded), -100000);
});

test("chooseMove is deterministic and returns a legal direction", () => {
  const board = [
    [2, 2, 0, 0],
    [4, 0, 0, 0],
    [8, 0, 0, 0],
    [16, 0, 0, 0],
  ];
  const first = chooseMove(board, { depth: 1 });
  const second = chooseMove(board, { depth: 1 });
  assert.deepEqual(first, second);
  assert.ok(first.legalMoves.includes(first.direction));
  assert.equal(typeof first.scores[first.direction], "number");
  assert.equal(first.depth, 1);
});

test("chooseMove reports game over and validates depth", () => {
  const board = [
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2],
  ];
  assert.deepEqual(chooseMove(board, { depth: 2 }), {
    direction: null,
    scores: {},
    legalMoves: [],
    depth: 2,
    gameOver: true,
  });
  assert.throws(() => chooseMove(board, { depth: -1 }), /0 to 5/);
  assert.throws(() => chooseMove(board, { depth: 6 }), /0 to 5/);
});

test("default depth adapts to the number of empty cells", () => {
  const open = Array.from({ length: 4 }, () => Array(4).fill(0));
  open[0][0] = 2;
  assert.equal(chooseMove(open).depth, 2);

  const medium = [
    [2, 4, 8, 16],
    [32, 64, 0, 0],
    [128, 256, 0, 0],
    [512, 1024, 0, 0],
  ];
  assert.equal(chooseMove(medium).depth, 3);
});
