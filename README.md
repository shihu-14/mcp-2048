# mcp-2048

MCP server for autonomously playing the browser version of 2048 at `https://play2048.co/`.

The server recognizes the 4x4 board from the current `play2048.co` browser state or from classic 2048 DOM tiles, chooses a move with a corner-oriented heuristic and expectimax search, sends `ArrowUp`, `ArrowDown`, `ArrowLeft`, or `ArrowRight` through Puppeteer, waits between moves, and stops on win, game over, max steps, or repeated input failure.

## Requirements

- Node.js 20 or newer
- Google Chrome or another Chromium-based browser

Manual remote debugging is optional. By default, `browserMode: "auto"` tries `http://127.0.0.1:9222` first and launches a controlled Chrome window automatically if that debugging endpoint is not available.

Remote debugging is only needed when you want the MCP server to attach to a browser window you started yourself. A normal Chrome window does not expose an automation endpoint for security and profile-locking reasons, so Puppeteer cannot control an arbitrary already-open browser unless Chrome was started with `--remote-debugging-port`.

Chrome may print GoogleUpdater, GCM, TensorFlow Lite, Metal, IME, or SSL handshake messages to the terminal. Those messages are Chrome diagnostics, not 2048 failures. The MCP-launched browser uses quieter launch flags and does not require you to keep a noisy Chrome command open in Terminal.

## Install

```sh
npm install
```

## MCP Configuration

Example MCP client configuration:

```json
{
  "mcpServers": {
    "mcp-2048": {
      "command": "node",
      "args": ["/Users/eiichi/mcp_2048/src/server.js"]
    }
  }
}
```

If your client already has other MCP servers, add `mcp-2048` under the same `mcpServers` object.

## Chat Prompts

Shortest start prompt:

```text
mcp-2048で2048を開始して。
```

The intended tool is `start_2048`. It already uses `https://play2048.co/`, automatic browser launch, `maxSteps: 3000`, `delayMs: 75`, `restartOnGameOver: true`, `maxRestarts: 5`, and `depth: 2`.

One move only:

```text
mcp-2048 の step_2048 を使って現在の盤面を読んで1手だけ操作して。
targetUrl は https://play2048.co/、delayMs は 75。
```

Inspect only:

```text
mcp-2048 の inspect_2048 を使って現在の2048の盤面、空きマス、推奨手を読んで。
```

Attach to a browser you manually started with remote debugging:

```text
mcp-2048 の play_2048 を使って。
browserMode は connect、connectUrl は http://127.0.0.1:9222、targetUrl は https://play2048.co/。
```

## Tools

- `start_2048`: starts autoplay with reliable defaults. No arguments are required.
- `inspect_2048`: connects to the browser and reads the current board, empty cells, score text, game status, recognition source, and recommended move.
- `choose_2048_move`: chooses the best move for a provided 4x4 board without touching the browser.
- `step_2048`: reads the current browser board, chooses one legal move, sends the arrow key, waits for the board to settle, and retries focus once if the board did not change.
- `play_2048`: runs the autonomous loop until win, game over, no legal moves, unchanged board failure, or `maxSteps`. It can reset and retry after game over.

Common arguments:

- `browserMode`: `auto`, `connect`, or `launch`. Defaults to `auto`.
- `connectUrl`: Chrome DevTools endpoint used by `auto` and `connect`. Defaults to `http://127.0.0.1:9222`.
- `browserExecutablePath`: Chromium executable used by `launch`. Defaults to `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
- `headless`: launch without a visible window. Defaults to `false`.
- `targetUrl`: game URL. Defaults to `https://play2048.co/`.
- `maxSteps`: upper bound for a run. Defaults to `3000`.
- `delayMs`: delay after each key action. Defaults to `75`. Valid range is `50` to `1000`.
- `restartOnGameOver`: reset and retry when the board reaches game over. Defaults to `true`.
- `maxRestarts`: maximum reset count in one `play_2048` run. Defaults to `5`.
- `depth`: search depth override. Defaults to `2`. Higher can improve moves but slows each step.

Example MCP tool input:

```json
{
  "browserMode": "auto",
  "targetUrl": "https://play2048.co/",
  "maxSteps": 3000,
  "delayMs": 75,
  "restartOnGameOver": true,
  "maxRestarts": 5,
  "depth": 2
}
```

## Rules

- The board is 4x4.
- A move is one of `ArrowUp`, `ArrowDown`, `ArrowLeft`, or `ArrowRight`.
- Every tile slides as far as possible in the selected direction.
- Equal tiles that collide merge into one tile with the summed value.
- A tile created by a merge cannot merge again in the same move.
- After a valid move, the game adds one random `2` or `4` tile to an empty cell.
- The run is won when the page reports the 2048 win state.
- The run is game over when the board is full and no direction can move or merge tiles.

## Completion Strategy

Use this for the most reliable run:

```json
{
  "browserMode": "auto",
  "targetUrl": "https://play2048.co/",
  "maxSteps": 3000,
  "delayMs": 75,
  "restartOnGameOver": true,
  "maxRestarts": 5,
  "depth": 2
}
```

The decision engine evaluates only legal moves. It combines expected random tile spawns with heuristics for:

- preserving empty cells,
- increasing merge opportunities,
- keeping large tiles in a stable lower-left corner pattern,
- maintaining monotonic rows and columns,
- avoiding rough neighboring tile jumps.

2048 includes random tile spawns, so a win cannot be mathematically guaranteed by one run. `restartOnGameOver` and `maxRestarts` are the intended completion path when randomness or an earlier weak board causes a loss.

## Stop Reasons And Recovery

- `won`: complete. Stop.
- `game-over`: no legal moves remain. Run again with `restartOnGameOver: true` or increase `maxRestarts`.
- `no-legal-moves`: the recognizer sees a full immovable board before the page reports game over. Treat it like game over.
- `max-steps`: the run hit the step cap before winning or losing. Increase `maxSteps`, for example to `3000`.
- `unchanged-board`: the chosen legal key did not change the board after focus retry. Click the game window, close overlays, or use `browserMode: "launch"` so the controlled browser owns focus.
- Recognition error: the page is not loaded, blocked, or not at `https://play2048.co/`. Reload the target URL or call `inspect_2048` first.
- Slow run: reduce `depth` or use `delayMs: 50`. Do not go below `50`; the page may miss inputs or storage may not settle.

## Manual Remote Debugging Mode

Only use this when you want to control a browser window you opened yourself:

```sh
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/private/tmp/mcp-2048-chrome \
  --disable-background-networking \
  --disable-component-update \
  --disable-sync \
  --log-level=3 \
  --no-first-run
```

If you do not want Chrome diagnostics in the terminal, redirect stderr:

```sh
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/private/tmp/mcp-2048-chrome \
  --disable-background-networking \
  --disable-component-update \
  --disable-sync \
  --log-level=3 \
  --no-first-run 2>/dev/null &
```

Then open `https://play2048.co/` and call tools with:

```json
{
  "browserMode": "connect",
  "connectUrl": "http://127.0.0.1:9222",
  "targetUrl": "https://play2048.co/"
}
```

## Test

```sh
npm test
```
