import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  DEFAULT_DELAY_MS,
  DEFAULT_DEPTH,
  DEFAULT_MAX_RESTARTS,
  DEFAULT_MAX_STEPS,
  MAX_DELAY_MS,
  MAX_RESTARTS,
  MAX_STEPS,
  MIN_DELAY_MS,
  GameController,
} from "./controller.js";
import { DEFAULT_BROWSER_MODE, DEFAULT_CONNECT_URL } from "./browser.js";
import { isTileValue } from "./game.js";
import { chooseMove } from "./solver.js";

const directionSchema = z.enum(["up", "down", "left", "right"]);
const boardSchema = z
  .array(z.array(z.number().int()).length(4))
  .length(4)
  .refine((board) => board.every((row) => row.every(isTileValue)), {
    message: "Board cells must be 0 or powers of two greater than 1.",
  });

const browserShape = {
  browserMode: z
    .enum(["auto", "connect", "launch"])
    .default(DEFAULT_BROWSER_MODE),
  connectUrl: z.url().default(DEFAULT_CONNECT_URL),
  headless: z.boolean().default(false),
};

const depthSchema = z.number().int().min(0).max(5).default(DEFAULT_DEPTH);
const delaySchema = z
  .number()
  .int()
  .min(MIN_DELAY_MS)
  .max(MAX_DELAY_MS)
  .default(DEFAULT_DELAY_MS);
const gameStateSchema = z.strictObject({
  board: boardSchema,
  status: z.enum(["playing", "won", "game-over"]),
  score: z.number().int().nonnegative().nullable(),
  recognitionSource: z.string(),
  tileCount: z.number().int().min(1).max(16),
  duplicateTiles: z.number().int().nonnegative(),
});
const decisionSchema = z.strictObject({
  direction: directionSchema.nullable(),
  scores: z.record(z.string(), z.number()),
  legalMoves: z.array(directionSchema),
  scoreGain: z.number().int().nonnegative().optional(),
  resultingBoard: boardSchema.optional(),
  depth: z.number().int().min(0).max(5),
  gameOver: z.boolean(),
});
const inspectOutputSchema = z.strictObject({
  state: gameStateSchema,
  emptyCellCount: z.number().int().min(0).max(16),
  maxTile: z.number().int().nonnegative(),
  recommendation: decisionSchema,
});
const stepOutputSchema = z.strictObject({
  stopped: z.boolean(),
  reason: z
    .enum(["won", "game-over", "no-legal-moves", "unchanged-board"])
    .nullable(),
  direction: directionSchema.nullable(),
  before: gameStateSchema,
  after: gameStateSchema,
  recovered: z.boolean(),
});
const playOutputSchema = z.strictObject({
  stopped: z.literal(true),
  reason: z.enum([
    "won",
    "game-over",
    "no-legal-moves",
    "unchanged-board",
    "max-steps",
  ]),
  moveCount: z.number().int().nonnegative(),
  restartCount: z.number().int().nonnegative(),
  final: gameStateSchema,
  maxTile: z.number().int().nonnegative(),
  recentMoves: z
    .array(
      z.strictObject({
        move: z.number().int().positive(),
        direction: directionSchema,
        score: z.number().int().nonnegative().nullable(),
        status: z.enum(["playing", "won", "game-over"]),
        recovered: z.boolean(),
      }),
    )
    .max(20),
});

function success(result) {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result,
  };
}

function failure(error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function registerTool(server, name, config, handler) {
  server.registerTool(name, config, async (args) => {
    try {
      return success(await handler(args));
    } catch (error) {
      return failure(error);
    }
  });
}

export function createServer({ controller = new GameController() } = {}) {
  const server = new McpServer(
    { name: "mcp-2048", version: "0.1.0" },
    {
      instructions:
        "Use inspect_2048 to read the game, step_2048 for one move, play_2048 for autoplay, and choose_2048_move for an offline board. The browser target is always https://play2048.co/.",
    },
  );

  registerTool(
    server,
    "inspect_2048",
    {
      title: "Inspect 2048",
      description:
        "Read the current play2048.co board and recommend a legal move.",
      inputSchema: z.strictObject({ ...browserShape, depth: depthSchema }),
      outputSchema: inspectOutputSchema,
    },
    (args) => controller.inspect(args),
  );

  registerTool(
    server,
    "choose_2048_move",
    {
      title: "Choose 2048 Move",
      description:
        "Choose a legal move for a provided 4x4 board without using a browser.",
      inputSchema: z.strictObject({ board: boardSchema, depth: depthSchema }),
      outputSchema: decisionSchema,
      annotations: { readOnlyHint: true },
    },
    ({ board, depth }) => chooseMove(board, { depth }),
  );

  registerTool(
    server,
    "step_2048",
    {
      title: "Step 2048",
      description:
        "Read the current board, choose one move, press its arrow key, and verify the result.",
      inputSchema: z.strictObject({
        ...browserShape,
        delayMs: delaySchema,
        depth: depthSchema,
      }),
      outputSchema: stepOutputSchema,
    },
    (args) => controller.step(args),
  );

  registerTool(
    server,
    "play_2048",
    {
      title: "Play 2048",
      description:
        "Autonomously play on play2048.co and return a compact final summary.",
      inputSchema: z.strictObject({
        ...browserShape,
        delayMs: delaySchema,
        depth: depthSchema,
        maxSteps: z
          .number()
          .int()
          .min(1)
          .max(MAX_STEPS)
          .default(DEFAULT_MAX_STEPS),
        maxRestarts: z
          .number()
          .int()
          .min(0)
          .max(MAX_RESTARTS)
          .default(DEFAULT_MAX_RESTARTS),
        restartOnGameOver: z.boolean().default(true),
      }),
      outputSchema: playOutputSchema,
    },
    (args) => controller.play(args),
  );

  return server;
}
