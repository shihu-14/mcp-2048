import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { createServer } from "../../src/server.js";

const board = [
  [2, 2, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
];
const state = {
  board,
  status: "playing",
  score: 0,
  recognitionSource: "test",
  tileCount: 2,
  duplicateTiles: 0,
};
const decision = {
  direction: "left",
  scores: { left: 1 },
  legalMoves: ["left"],
  scoreGain: 4,
  resultingBoard: [
    [4, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  depth: 1,
  gameOver: false,
};

function fakeController() {
  return {
    async inspect() {
      return {
        state,
        emptyCellCount: 14,
        maxTile: 2,
        recommendation: decision,
      };
    },
    async step() {
      return {
        stopped: false,
        reason: null,
        direction: "left",
        before: state,
        after: state,
        recovered: false,
      };
    },
    async play() {
      return {
        stopped: true,
        reason: "max-steps",
        moveCount: 1,
        restartCount: 0,
        final: state,
        maxTile: 2,
        recentMoves: [
          {
            move: 1,
            direction: "left",
            score: 0,
            status: "playing",
            recovered: false,
          },
        ],
      };
    },
  };
}

test("official SDK lists four tools, validates input, and returns structured output", async () => {
  const server = createServer({ controller: fakeController() });
  const client = new Client({ name: "mcp-2048-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
      "choose_2048_move",
      "inspect_2048",
      "play_2048",
      "step_2048",
    ]);
    assert.equal(
      listed.tools.some((tool) => "targetUrl" in tool.inputSchema.properties),
      false,
    );
    assert.equal(
      listed.tools.some(
        (tool) => "browserExecutablePath" in tool.inputSchema.properties,
      ),
      false,
    );

    const inspected = await client.callTool({
      name: "inspect_2048",
      arguments: {},
    });
    assert.equal(inspected.isError, undefined);
    assert.equal(inspected.structuredContent.maxTile, 2);

    const chosen = await client.callTool({
      name: "choose_2048_move",
      arguments: { board, depth: 1 },
    });
    assert.ok(
      chosen.structuredContent.legalMoves.includes(
        chosen.structuredContent.direction,
      ),
    );

    const invalid = await client.callTool({
      name: "choose_2048_move",
      arguments: { board: [[3, 0, 0, 0], ...board.slice(1)], unexpected: true },
    });
    assert.equal(invalid.isError, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("tool handler failures are visible to the model", async () => {
  const controller = fakeController();
  controller.step = async () => {
    throw new Error("input failed");
  };
  const server = createServer({ controller });
  const client = new Client({ name: "mcp-2048-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const result = await client.callTool({ name: "step_2048", arguments: {} });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /input failed/);
  } finally {
    await client.close();
    await server.close();
  }
});

test(
  "stdio entrypoint initializes, lists tools, and shuts down",
  { timeout: 15000 },
  async () => {
    const client = new Client({
      name: "mcp-2048-stdio-test",
      version: "1.0.0",
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("../../src/index.js", import.meta.url))],
      stderr: "pipe",
    });
    await client.connect(transport);
    const listed = await client.listTools();
    assert.equal(listed.tools.length, 4);
    await client.close();
  },
);
