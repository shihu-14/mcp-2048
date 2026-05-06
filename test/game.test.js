import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseMove,
  emptyCells,
  isGameOver,
  keyForDirection,
  legalMoves,
  moveBoard,
  slideLineLeft
} from "../src/game.js";
import { normalizeDelay, normalizeMaxRestarts, normalizeMaxSteps } from "../src/browser.js";
import {
  boardFromState,
  decodePlay2048Payload,
  encodePlay2048Payload,
  play2048StorageKey,
  recognizeSnapshot
} from "../src/recognition.js";

test("slideLineLeft merges each tile at most once per move", () => {
  assert.deepEqual(slideLineLeft([2, 2, 2, 2]), {
    line: [4, 4, 0, 0],
    scoreGain: 8,
    moved: true
  });

  assert.deepEqual(slideLineLeft([4, 4, 8, 0]), {
    line: [8, 8, 0, 0],
    scoreGain: 8,
    moved: true
  });
});

test("moveBoard moves and merges in all directions", () => {
  const board = [
    [2, 0, 2, 4],
    [0, 4, 4, 0],
    [2, 2, 2, 0],
    [0, 0, 0, 0]
  ];

  assert.deepEqual(moveBoard(board, "left").board, [
    [4, 4, 0, 0],
    [8, 0, 0, 0],
    [4, 2, 0, 0],
    [0, 0, 0, 0]
  ]);

  assert.deepEqual(moveBoard(board, "right").board, [
    [0, 0, 4, 4],
    [0, 0, 0, 8],
    [0, 0, 2, 4],
    [0, 0, 0, 0]
  ]);

  assert.deepEqual(moveBoard(board, "up").board, [
    [4, 4, 2, 4],
    [0, 2, 4, 0],
    [0, 0, 2, 0],
    [0, 0, 0, 0]
  ]);

  assert.deepEqual(moveBoard(board, "down").board, [
    [0, 0, 0, 0],
    [0, 0, 2, 0],
    [0, 4, 4, 0],
    [4, 2, 2, 4]
  ]);
});

test("legalMoves returns only directions that change the board", () => {
  const board = [
    [2, 4, 8, 16],
    [32, 64, 128, 256],
    [512, 1024, 2048, 4096],
    [8192, 16384, 32768, 65536]
  ];

  assert.equal(isGameOver(board), true);
  assert.deepEqual(legalMoves(board), []);
});

test("emptyCells and game-over detection handle open cells", () => {
  const board = [
    [2, 4, 8, 16],
    [32, 0, 128, 256],
    [512, 1024, 2048, 4096],
    [8192, 16384, 32768, 65536]
  ];

  assert.deepEqual(emptyCells(board), [{ row: 1, column: 1 }]);
  assert.equal(isGameOver(board), false);
});

test("chooseMove returns a legal direction and score details", () => {
  const board = [
    [2, 2, 0, 0],
    [4, 0, 0, 0],
    [8, 0, 0, 0],
    [16, 0, 0, 0]
  ];

  const decision = chooseMove(board, { depth: 1 });
  assert.ok(["up", "down", "left", "right"].includes(decision.direction));
  assert.ok(decision.legalMoves.includes(decision.direction));
  assert.equal(typeof decision.scores[decision.direction], "number");
});

test("chooseMove reports no direction when no moves are possible", () => {
  const board = [
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2]
  ];

  assert.deepEqual(chooseMove(board), {
    direction: null,
    scores: {},
    legalMoves: [],
    gameOver: true
  });
});

test("keyForDirection maps moves to browser arrow keys", () => {
  assert.equal(keyForDirection("up"), "ArrowUp");
  assert.equal(keyForDirection("down"), "ArrowDown");
  assert.equal(keyForDirection("left"), "ArrowLeft");
  assert.equal(keyForDirection("right"), "ArrowRight");
});

test("runtime controls enforce bounded delays and step limits", () => {
  assert.equal(normalizeDelay(), 5);
  assert.equal(normalizeDelay(5), 5);
  assert.equal(normalizeDelay(50), 50);
  assert.equal(normalizeDelay(1000), 1000);
  assert.equal(normalizeMaxSteps(1), 1);
  assert.equal(normalizeMaxRestarts(0), 0);
  assert.equal(normalizeMaxRestarts(2), 2);

  assert.throws(() => normalizeDelay(4), /at least 5ms/);
  assert.throws(() => normalizeDelay(1001), /1000ms or less/);
  assert.throws(() => normalizeMaxSteps(0), /positive integer/);
  assert.throws(() => normalizeMaxRestarts(-1), /non-negative integer/);
});

test("recognition parses classic 2048 DOM tile classes", () => {
  const recognized = recognizeSnapshot({
    tileClassNames: [
      "tile tile-2 tile-position-1-1 tile-new",
      "tile tile-4 tile-position-4-1",
      "tile tile-8 tile-position-2-3"
    ],
    messageClass: "",
    messageText: "",
    scoreText: "14",
    localStorageEntries: []
  });

  assert.equal(recognized.recognitionSource, "classic-dom");
  assert.deepEqual(recognized.board, [
    [2, 0, 0, 4],
    [0, 0, 0, 0],
    [0, 8, 0, 0],
    [0, 0, 0, 0]
  ]);
});

test("recognition decodes current play2048.co storage format", () => {
  const state = {
    state: "playing",
    score: 64,
    board: [
      [{ value: 2, position: { x: 0, y: 0 } }, null, null, null],
      [null, { value: 4, position: { x: 1, y: 1 } }, null, null],
      [null, null, { value: 8, position: { x: 2, y: 2 } }, null],
      [null, null, null, { value: 16, position: { x: 3, y: 3 } }]
    ]
  };
  const key = play2048StorageKey("k-standard");
  const encoded = encodePlay2048Payload(state);

  assert.deepEqual(decodePlay2048Payload(encoded), state);

  const recognized = recognizeSnapshot({
    localStorageEntries: [[key, encoded]],
    locationPath: "/",
    tileClassNames: []
  });

  assert.equal(recognized.recognitionSource, "play2048-storage:standard");
  assert.equal(recognized.scoreText, "64");
  assert.deepEqual(recognized.board, [
    [2, 0, 0, 0],
    [0, 4, 0, 0],
    [0, 0, 8, 0],
    [0, 0, 0, 16]
  ]);
});

test("recognition prefers standard storage over stale tutorial storage on root URL", () => {
  const tutorialState = {
    state: "playing",
    score: 36,
    board: [
      [null, null, null, { value: 2, position: { x: 3, y: 0 } }],
      [{ value: 2, position: { x: 0, y: 1 } }, null, null, null],
      [{ value: 4, position: { x: 0, y: 2 } }, null, null, null],
      [{ value: 8, position: { x: 0, y: 3 } }, { value: 8, position: { x: 1, y: 3 } }, null, null]
    ]
  };
  const standardState = {
    state: "playing",
    score: 4,
    board: [
      [{ value: 2, position: { x: 0, y: 0 } }, { value: 2, position: { x: 1, y: 0 } }, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null]
    ]
  };

  const recognized = recognizeSnapshot({
    localStorageEntries: [
      [play2048StorageKey("k-tutorial"), encodePlay2048Payload(tutorialState)],
      [play2048StorageKey("k-standard"), encodePlay2048Payload(standardState)]
    ],
    locationPath: "/",
    tileClassNames: []
  });

  assert.equal(recognized.recognitionSource, "play2048-storage:standard");
  assert.deepEqual(recognized.board, [
    [2, 2, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ]);
});

test("recognition ignores tutorial storage on root URL when no playable storage exists", () => {
  const tutorialState = {
    state: "playing",
    score: 36,
    board: [
      [null, null, null, { value: 2, position: { x: 3, y: 0 } }],
      [{ value: 2, position: { x: 0, y: 1 } }, null, null, null],
      [{ value: 4, position: { x: 0, y: 2 } }, null, null, null],
      [{ value: 8, position: { x: 0, y: 3 } }, { value: 8, position: { x: 1, y: 3 } }, null, null]
    ]
  };

  const recognized = recognizeSnapshot({
    localStorageEntries: [[play2048StorageKey("k-tutorial"), encodePlay2048Payload(tutorialState)]],
    locationPath: "/",
    tileClassNames: []
  });

  assert.equal(recognized.recognitionSource, "unavailable");
  assert.equal(recognized.recognized, false);
});

test("recognition still reads tutorial storage on tutorial URL", () => {
  const tutorialState = {
    state: "playing",
    score: 36,
    board: [
      [null, null, null, { value: 2, position: { x: 3, y: 0 } }],
      [{ value: 2, position: { x: 0, y: 1 } }, null, null, null],
      [{ value: 4, position: { x: 0, y: 2 } }, null, null, null],
      [{ value: 8, position: { x: 0, y: 3 } }, { value: 8, position: { x: 1, y: 3 } }, null, null]
    ]
  };

  const recognized = recognizeSnapshot({
    localStorageEntries: [[play2048StorageKey("k-tutorial"), encodePlay2048Payload(tutorialState)]],
    locationPath: "/tutorial",
    tileClassNames: []
  });

  assert.equal(recognized.recognitionSource, "play2048-storage:tutorial");
  assert.deepEqual(recognized.board, [
    [0, 0, 0, 2],
    [2, 0, 0, 0],
    [4, 0, 0, 0],
    [8, 8, 0, 0]
  ]);
});

test("boardFromState handles selecting state via previousGameplay", () => {
  const parsed = boardFromState({
    state: "selecting",
    previousGameplay: {
      state: "playing",
      board: [
        [null, null, null, null],
        [null, null, null, null],
        [null, null, { value: 32, position: { x: 2, y: 2 } }, null],
        [null, null, null, null]
      ]
    }
  });

  assert.deepEqual(parsed.board, [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 32, 0],
    [0, 0, 0, 0]
  ]);
});
