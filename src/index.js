#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { GameController } from "./controller.js";
import { createServer } from "./server.js";

const controller = new GameController();
const handle = serveStdio(() => createServer({ controller }), {
  onerror(error) {
    console.error(error instanceof Error ? error.message : String(error));
  },
});

let shutdownPromise = null;

function shutdown(exitCode = 0) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    try {
      await handle.close();
      await controller.close();
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
      return;
    }
    process.exitCode = exitCode;
  })();
  return shutdownPromise;
}

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));
process.stdin.once("end", () => void shutdown(0));
