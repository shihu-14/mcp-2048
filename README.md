# mcp-2048

`mcp-2048` is a local [Model Context Protocol](https://modelcontextprotocol.io/) server that lets an LLM inspect and play 2048 at [play2048.co](https://play2048.co/).

The server reads the board from the site's local storage or DOM, chooses a legal move with a heuristic expectimax solver, and sends arrow-key input through Puppeteer. The target URL is intentionally fixed to `https://play2048.co/`.

## Requirements

- Node.js 22 or newer
- Google Chrome or a Chromium-based browser installed in a standard location

## Setup

```sh
git clone https://github.com/shihu-14/mcp-2048.git
cd mcp-2048
npm install
```

## MCP configuration

Configure your MCP client to start the stdio server with Node.js:

```json
{
  "mcpServers": {
    "mcp-2048": {
      "command": "node",
      "args": ["<repository-path>/src/index.js"]
    }
  }
}
```

Replace `<repository-path>` with the absolute path to this repository. The server writes MCP messages only to stdout and sends diagnostics to stderr.

## Usage

Ask the MCP client to call one of the following tools:

| Tool               | Purpose                                                                           |
| ------------------ | --------------------------------------------------------------------------------- |
| `inspect_2048`     | Read the current board, score, status, recognition source, and recommended move.  |
| `choose_2048_move` | Choose a move for a supplied 4x4 board without opening a browser.                 |
| `step_2048`        | Recognize the board, choose one move, press its arrow key, and verify the result. |
| `play_2048`        | Run the autonomous loop and return a compact summary plus the latest 20 moves.    |

Example prompt:

```text
Use play_2048 to play 2048. Launch a visible browser and stop after at most 3000 moves.
```

The game URL is not a tool argument. All browser tools operate only on `https://play2048.co/`.

## Browser modes

All browser tools accept these common options:

- `browserMode`: `auto` (default), `connect`, or `launch`.
- `connectUrl`: Chrome DevTools HTTP endpoint; defaults to `http://127.0.0.1:9222`.
- `browserExecutablePath`: optional explicit Chrome/Chromium executable path.
- `headless`: whether a launched browser is hidden; defaults to `false`.

`auto` first attempts the DevTools endpoint and launches Chrome if the connection fails. `connect` only attaches to a browser started with remote debugging and disconnects after each tool call. `launch` starts a server-owned browser, reuses it between calls, and closes it when the MCP server shuts down.

When launching, the executable is resolved in this order:

1. `browserExecutablePath`
2. `MCP_2048_BROWSER_EXECUTABLE_PATH`
3. Puppeteer's standard `chrome` channel lookup

`step_2048` and `play_2048` also accept `delayMs` from 5 to 1000 and solver `depth` from 0 to 5. `play_2048` accepts `maxSteps` from 1 to 10000, `maxRestarts` from 0 to 20, and `restartOnGameOver`.

## Development

```sh
npm run lint
npm run format:check
npm test
npm run test:coverage
npm audit --omit=dev --audit-level=high
```

The live test launches Chrome, accesses the third-party game site, recognizes a board, and performs one move:

```sh
npm run test:e2e
```

The live test is intentionally excluded from CI. CI runs lint, formatting, unit/integration tests, coverage, and the production dependency audit on Node.js 22 and 24.

## Project structure

```text
src/
├── index.js         stdio entrypoint and shutdown
├── server.js        official MCP SDK tool registration and schemas
├── controller.js    inspect, step, autoplay, restart, and concurrency control
├── browser.js       browser ownership, page selection, focus, and keyboard input
├── recognition.js   play2048.co storage/DOM recognition
├── game.js          pure 2048 board rules
└── solver.js        pure heuristic and expectimax move selection

test/unit/           pure logic and recognition tests
test/integration/    browser, controller, and MCP integration tests
e2e/                 explicit live-site test
```

## Limitations

- Board recognition depends on the current `play2048.co` storage and DOM formats. A site update can require an adapter update.
- 2048 uses random tile placement, so autoplay cannot guarantee a win.
- Only one browser-controlling tool may run at a time. Concurrent browser calls return a busy error; offline move selection remains available.
- Long autoplay calls are still bounded by the MCP client's request timeout. Responses retain only aggregate counts, the final board, and the latest 20 moves.
- The project uses `puppeteer-core` and does not download a bundled browser.

## License

MIT
