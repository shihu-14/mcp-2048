import assert from "node:assert/strict";
import test from "node:test";

import {
  boardFromState,
  clearStoredGame,
  decodePlay2048Payload,
  parseScoreText,
  play2048StorageKey,
  readGameState,
  recognizeFromDom,
  recognizeSnapshot,
  statusFromState,
  waitForStableState,
} from "../../src/recognition.js";

const OBFUSCATED_FIXTURE =
  "H2UbGCgzL1tYERQZKD4zGAJhblMXNF4FBlt4QkhPNBYoOjZNYAgZCHsuEVk8InBMaFsfTQs0ARggKCRbWEhGDWt9alpHOmBLVCpMWxhbNBcIGDNbc3p+TSo8MRotMR9ba30pVCJVBwxIZRFOc3c3BE5dERklazQDCS8fXT85RBsPVSwDCAF6FzwkPkM0Ji4fBHQrWzwrPlo0AlFRSCkdACVrJAwOXzlZEikvGglvLAQIOx0ZFhUuWgoYOhUUFS8";

function state(score = 64) {
  return {
    state: "playing",
    score,
    board: [
      [{ value: 2, position: { x: 0, y: 0 } }, null, null, null],
      [null, { value: 4, position: { x: 1, y: 1 } }, null, null],
      [null, null, { value: 8, position: { x: 2, y: 2 } }, null],
      [null, null, null, { value: 16, position: { x: 3, y: 3 } }],
    ],
  };
}

function domSnapshot(overrides = {}) {
  return {
    tileClassNames: [
      "tile tile-2 tile-position-1-1 tile-new",
      "tile tile-4 tile-position-4-1",
      "tile tile-8 tile-position-2-3",
    ],
    messageClass: "",
    messageText: "",
    scoreText: "1,234 +16",
    localStorageEntries: [],
    locationPath: "/",
    ...overrides,
  };
}

test("storage key and payload decoder support current play2048.co data", () => {
  assert.equal(
    play2048StorageKey("k-standard"),
    "z2917383p223s2p263s2v2f163c3e3",
  );
  assert.equal(decodePlay2048Payload(JSON.stringify(state())).score, 64);
  const decoded = decodePlay2048Payload(OBFUSCATED_FIXTURE);
  assert.equal(decoded.score, 4);
  assert.equal(decoded.board[0][0].value, 2);
});

test("recognition prefers standard storage on the root path", () => {
  const recognized = recognizeSnapshot({
    ...domSnapshot(),
    localStorageEntries: [
      [play2048StorageKey("k-tutorial"), JSON.stringify(state(1))],
      [play2048StorageKey("k-standard"), JSON.stringify(state(64))],
    ],
  });
  assert.equal(recognized.recognitionSource, "play2048-storage:standard");
  assert.equal(recognized.score, 64);
  assert.deepEqual(recognized.board[0], [2, 0, 0, 0]);
});

test("tutorial storage is isolated to the tutorial path", () => {
  const entries = [
    [play2048StorageKey("k-tutorial"), JSON.stringify(state(12))],
  ];
  assert.equal(
    recognizeSnapshot({
      ...domSnapshot(),
      tileClassNames: [],
      localStorageEntries: entries,
    }),
    null,
  );
  assert.equal(
    recognizeSnapshot({
      ...domSnapshot(),
      locationPath: "/tutorial",
      tileClassNames: [],
      localStorageEntries: entries,
    }).recognitionSource,
    "play2048-storage:tutorial",
  );
});

test("invalid storage falls through to classic storage and DOM", () => {
  const duplicate = state();
  duplicate.board[0][1] = { value: 4, position: { x: 0, y: 0 } };
  const classic = recognizeSnapshot({
    ...domSnapshot(),
    localStorageEntries: [
      [play2048StorageKey("k-standard"), JSON.stringify(duplicate)],
      ["gameState", JSON.stringify(state(32))],
    ],
  });
  assert.equal(classic.recognitionSource, "classic-storage");

  const dom = recognizeSnapshot({
    ...domSnapshot(),
    localStorageEntries: [
      [play2048StorageKey("k-standard"), "not-valid-base64"],
    ],
  });
  assert.equal(dom.recognitionSource, "classic-dom");
});

test("DOM recognition handles animation duplicates, status, and score", () => {
  const recognized = recognizeFromDom(
    domSnapshot({
      tileClassNames: [
        "tile tile-2 tile-position-1-1",
        "tile tile-4 tile-position-1-1 tile-merged",
        "tile tile-3 tile-position-2-1",
      ],
      messageClass: "game-message game-won",
      messageText: "You win!",
    }),
  );
  assert.deepEqual(recognized.board[0], [4, 0, 0, 0]);
  assert.equal(recognized.duplicateTiles, 1);
  assert.equal(recognized.status, "won");
  assert.equal(recognized.score, 1234);
  assert.equal(parseScoreText("Score unavailable"), null);
  assert.equal(recognizeFromDom(domSnapshot({ tileClassNames: [] })), null);
});

test("state parser supports selecting, flat boards, and status variants", () => {
  const selecting = boardFromState({
    state: "selecting",
    previousGameplay: state(),
  });
  assert.equal(selecting.board[3][3], 16);
  assert.equal(boardFromState({ board: Array(16).fill(null) }), null);
  assert.equal(statusFromState({ state: "gameover" }), "game-over");
  assert.equal(statusFromState({ won: true, keepPlaying: false }), "won");
  assert.equal(statusFromState({ won: true, keepPlaying: true }), "playing");
});

test("page reading and stability polling use the canonical snapshot", async () => {
  let calls = 0;
  const page = {
    async evaluate() {
      calls += 1;
      return domSnapshot();
    },
  };
  assert.equal((await readGameState(page)).score, 1234);
  assert.equal(
    (await waitForStableState(page, { intervalMs: 0 })).recognitionSource,
    "classic-dom",
  );
  assert.ok(calls >= 3);

  const unavailable = {
    async evaluate() {
      return domSnapshot({ tileClassNames: [] });
    },
  };
  await assert.rejects(() => readGameState(unavailable), /Could not recognize/);
  await assert.rejects(
    () => waitForStableState(unavailable, { intervalMs: 0, maxAttempts: 2 }),
    /Could not recognize/,
  );
});

test("DOM stability waits until animation duplicates disappear", async () => {
  const duplicate = domSnapshot({
    tileClassNames: [
      "tile tile-2 tile-position-1-1",
      "tile tile-4 tile-position-1-1 tile-merged",
    ],
  });
  const settled = domSnapshot({
    tileClassNames: ["tile tile-4 tile-position-1-1"],
  });
  const snapshots = [duplicate, settled, settled];
  let calls = 0;
  const page = {
    async evaluate() {
      return snapshots[Math.min(calls++, snapshots.length - 1)];
    },
  };

  const recognized = await waitForStableState(page, {
    intervalMs: 0,
    maxAttempts: 3,
  });
  assert.equal(calls, 3);
  assert.equal(recognized.duplicateTiles, 0);
  assert.deepEqual(recognized.board[0], [4, 0, 0, 0]);
});

test("DOM stability never confirms a snapshot with duplicate tiles", async () => {
  const page = {
    async evaluate() {
      return domSnapshot({
        tileClassNames: [
          "tile tile-2 tile-position-1-1",
          "tile tile-4 tile-position-1-1 tile-merged",
        ],
      });
    },
  };

  await assert.rejects(
    () => waitForStableState(page, { intervalMs: 0, maxAttempts: 3 }),
    /did not become stable/,
  );
});

test("storage stability does not wait for DOM duplicate tiles", async () => {
  let calls = 0;
  const snapshot = domSnapshot({
    tileClassNames: [
      "tile tile-2 tile-position-1-1",
      "tile tile-4 tile-position-1-1 tile-merged",
    ],
    localStorageEntries: [
      [play2048StorageKey("k-standard"), JSON.stringify(state())],
    ],
  });
  const page = {
    async evaluate() {
      calls += 1;
      return snapshot;
    },
  };

  const recognized = await waitForStableState(page, {
    intervalMs: 0,
    maxAttempts: 3,
  });
  assert.equal(calls, 2);
  assert.equal(recognized.recognitionSource, "play2048-storage:standard");
});

test("clearStoredGame removes all known storage keys", async () => {
  let removed = [];
  const page = {
    async evaluate(callback, keys) {
      const previous = globalThis.localStorage;
      globalThis.localStorage = {
        removeItem(key) {
          removed.push(key);
        },
      };
      try {
        callback(keys);
      } finally {
        globalThis.localStorage = previous;
      }
    },
  };
  await clearStoredGame(page);
  assert.equal(removed.length, 5);
  assert.ok(removed.includes("gameState"));
});
