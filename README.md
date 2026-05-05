# mcp-2048

MCP server for autonomously playing the browser version of 2048 at `https://play2048.co/tutorial`.

The server recognizes the 4x4 board from the current `play2048.co` browser state or from classic 2048 DOM tiles, chooses a move with a corner-oriented heuristic and expectimax search, sends `ArrowUp`, `ArrowDown`, `ArrowLeft`, or `ArrowRight` through Puppeteer, waits between moves, and stops on `Game Over` or `You win!`.

## Requirements

- Node.js 20 or newer
- A Chromium-based browser started with remote debugging, for example:

```sh
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

Open `https://play2048.co/tutorial` in that browser and move through any tutorial screen until the game is playable.

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
      "args": ["/absolute/path/to/mcp-2048/src/server.js"]
    }
  }
}
```

## Tools

- `inspect_2048`: connects to the browser and reads the current board, empty cells, score text, game status, and recognition source.
- `choose_2048_move`: chooses the best move for a provided 4x4 board without touching the browser.
- `step_2048`: reads the current browser board, chooses one legal move, sends the arrow key, and waits for the board to settle.
- `play_2048`: runs the autonomous loop until win, game over, no legal moves, or `maxSteps`.

Common arguments:

- `connectUrl`: Chrome DevTools endpoint. Defaults to `http://127.0.0.1:9222`.
- `targetUrl`: URL substring used to find an existing tab. Defaults to `https://play2048.co/tutorial`.
- `maxSteps`: upper bound for a run. Defaults to `200`.
- `delayMs`: delay after each action. Defaults to `700`. Values below `500` are rejected to keep inputs slower than the animation threshold.

Example MCP tool input:

```json
{
  "targetUrl": "https://play2048.co/tutorial",
  "connectUrl": "http://127.0.0.1:9222",
  "maxSteps": 200,
  "delayMs": 700
}
```

## Strategy

The decision engine evaluates only legal moves. It combines expected random tile spawns with heuristics for:

- preserving empty cells,
- increasing merge opportunities,
- keeping large tiles in a stable lower-left corner pattern,
- maintaining monotonic rows and columns,
- avoiding rough neighboring tile jumps.

The implementation does not assume a guaranteed win; it exposes the reasoning score for every legal direction so an LLM or user can inspect each decision.

## Test

```sh
npm test
```
