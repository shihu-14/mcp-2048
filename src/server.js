#!/usr/bin/env node
import { chooseMove } from "./game.js";
import {
  DEFAULT_BROWSER_EXECUTABLE_PATH,
  DEFAULT_BROWSER_MODE,
  DEFAULT_CONNECT_URL,
  DEFAULT_DELAY_MS,
  DEFAULT_MAX_STEPS,
  DEFAULT_MAX_RESTARTS,
  DEFAULT_TARGET_URL,
  MAX_DELAY_MS,
  MIN_DELAY_MS,
  inspect2048,
  play2048,
  step2048
} from "./browser.js";

const PROTOCOL_VERSION = "2024-11-05";

const browserProperties = {
  browserMode: {
    type: "string",
    enum: ["auto", "connect", "launch"],
    default: DEFAULT_BROWSER_MODE,
    description: "auto tries connectUrl first, then launches Chrome if the default debugging port is unavailable."
  },
  connectUrl: {
    type: "string",
    description: "Chrome DevTools browser URL used when browserMode is auto or connect.",
    default: DEFAULT_CONNECT_URL
  },
  browserExecutablePath: {
    type: "string",
    description: "Chromium executable path used when launching a controlled browser.",
    default: DEFAULT_BROWSER_EXECUTABLE_PATH
  },
  headless: {
    type: "boolean",
    description: "Launch browser in headless mode when browserMode is launch or auto falls back to launch.",
    default: false
  },
  targetUrl: {
    type: "string",
    description: "URL for the 2048 game tab.",
    default: DEFAULT_TARGET_URL
  }
};

const toolDefinitions = [
  {
    name: "inspect_2048",
    description: "Read the current 2048 board from a browser tab and return status plus a recommended move.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...browserProperties,
        depth: {
          type: "integer",
          minimum: 0,
          maximum: 5,
          description: "Search depth override."
        }
      }
    }
  },
  {
    name: "choose_2048_move",
    description: "Choose the best legal move for a provided 4x4 2048 board without controlling the browser.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["board"],
      properties: {
        board: {
          type: "array",
          minItems: 4,
          maxItems: 4,
          items: {
            type: "array",
            minItems: 4,
            maxItems: 4,
            items: {
              type: "integer",
              minimum: 0
            }
          }
        },
        depth: {
          type: "integer",
          minimum: 0,
          maximum: 5,
          description: "Search depth override."
        }
      }
    }
  },
  {
    name: "step_2048",
    description: "Read the current board, choose one legal move, send the matching arrow key, and wait for the board to settle.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...browserProperties,
        delayMs: {
          type: "integer",
          minimum: MIN_DELAY_MS,
          maximum: MAX_DELAY_MS,
          default: DEFAULT_DELAY_MS
        },
        depth: {
          type: "integer",
          minimum: 0,
          maximum: 5
        }
      }
    }
  },
  {
    name: "play_2048",
    description: "Run the autonomous recognize, reason, and arrow-key loop until win, game over, no legal moves, or maxSteps.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        ...browserProperties,
        maxSteps: {
          type: "integer",
          minimum: 1,
          default: DEFAULT_MAX_STEPS
        },
        maxRestarts: {
          type: "integer",
          minimum: 0,
          default: DEFAULT_MAX_RESTARTS
        },
        restartOnGameOver: {
          type: "boolean",
          default: true
        },
        delayMs: {
          type: "integer",
          minimum: MIN_DELAY_MS,
          maximum: MAX_DELAY_MS,
          default: DEFAULT_DELAY_MS
        },
        depth: {
          type: "integer",
          minimum: 0,
          maximum: 5
        }
      }
    }
  }
];

async function callTool(name, args = {}) {
  if (name === "inspect_2048") {
    return inspect2048(args);
  }
  if (name === "choose_2048_move") {
    return chooseMove(args.board, { depth: args.depth });
  }
  if (name === "step_2048") {
    return step2048(args);
  }
  if (name === "play_2048") {
    return play2048(args);
  }
  throw new Error(`Unknown tool: ${name}`);
}

function response(id, result) {
  return {
    jsonrpc: "2.0",
    id,
    result
  };
}

function errorResponse(id, code, message, data) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      data
    }
  };
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function handleRequest(message) {
  const { id, method, params } = message;

  if (method === "initialize") {
    return response(id, {
      protocolVersion: params?.protocolVersion ?? PROTOCOL_VERSION,
      capabilities: {
        tools: {}
      },
      serverInfo: {
        name: "mcp-2048",
        version: "0.1.0"
      }
    });
  }

  if (method === "tools/list") {
    return response(id, {
      tools: toolDefinitions
    });
  }

  if (method === "tools/call") {
    try {
      const result = await callTool(params?.name, params?.arguments ?? {});
      return response(id, {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ],
        isError: false
      });
    } catch (error) {
      return response(id, {
        content: [
          {
            type: "text",
            text: error instanceof Error ? error.message : String(error)
          }
        ],
        isError: true
      });
    }
  }

  if (method === "ping") {
    return response(id, {});
  }

  if (method?.startsWith("notifications/")) {
    return null;
  }

  return errorResponse(id, -32601, `Method not found: ${method}`);
}

let buffer = "";

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    void (async () => {
      try {
        const message = JSON.parse(trimmed);
        const result = await handleRequest(message);
        if (result && message.id !== undefined) {
          writeMessage(result);
        }
      } catch (error) {
        writeMessage(errorResponse(null, -32700, "Parse error", error instanceof Error ? error.message : String(error)));
      }
    })();
  }
});

process.stdin.on("end", () => {
  process.exit(0);
});
