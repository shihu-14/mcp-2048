import assert from "node:assert/strict";

import { GameController } from "../src/controller.js";
import { boardsEqual } from "../src/game.js";

const controller = new GameController();

try {
  const result = await controller.step({
    browserMode: "launch",
    headless: true,
    delayMs: 50,
    depth: 1,
  });
  assert.equal(
    result.direction !== null,
    true,
    `No move was selected: ${result.reason}`,
  );
  assert.equal(boardsEqual(result.before.board, result.after.board), false);
  assert.match(result.before.recognitionSource, /storage|dom/);
  assert.match(result.after.recognitionSource, /storage|dom/);
  process.stdout.write(
    "play2048.co E2E passed: recognized a board and completed one move.\n",
  );
} finally {
  await controller.close();
}
