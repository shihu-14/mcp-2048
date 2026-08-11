import { boardsEqual, isTileValue, normalizeBoard } from "./game.js";

export const PLAY2048_URL = "https://play2048.co/";

const APP_STATE_PREFIX = "k";
const TUTORIAL_MODE = "tutorial";
const PLAYABLE_MODES = ["standard", "classic", "partner1"];
const STORAGE_MODES = [TUTORIAL_MODE, ...PLAYABLE_MODES];
const OBFUSCATION_KEY = "dGhlIGJyb3duIGZveCBqdW1wcyBvdmVyIHRoZSBsYXp5IGRvZw==";
const BASE64_PADDING = ["", "=", "=="];

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function base64Decode(value) {
  if (typeof atob === "function") return atob(value);
  return Buffer.from(value, "base64").toString("binary");
}

function fixDecodePadding(value) {
  let paddingLength = 0;
  if (value.endsWith("==")) paddingLength = 2;
  else if (value.endsWith("=")) paddingLength = 1;
  return (
    value.slice(0, value.length - paddingLength) +
    BASE64_PADDING[(paddingLength + 1) % 3]
  );
}

export function play2048StorageKey(name) {
  const encoder = new TextEncoder();
  const saltSource = encoder
    .encode(name)
    .reduce((total, byte) => total + Math.sin(byte), 0);
  const salt = Math.floor(1e7 * saltSource).toString(36);
  return encoder.encode(`${name}${salt}`).reduce((key, byte) => {
    return key + byte.toString(36).split("").reverse().join("");
  }, "");
}

export function decodePlay2048Payload(value) {
  try {
    return JSON.parse(value);
  } catch {
    const encodedSecret = new TextEncoder().encode(OBFUSCATION_KEY);
    const encrypted = base64Decode(fixDecodePadding(value));
    const decoded = new Uint8Array(encrypted.length);
    for (let index = 0; index < encrypted.length; index += 1) {
      decoded[index] =
        encrypted.charCodeAt(index) ^
        encodedSecret[index % encodedSecret.length];
    }
    return JSON.parse(new TextDecoder().decode(decoded));
  }
}

function emptyBoard() {
  return Array.from({ length: 4 }, () => Array(4).fill(0));
}

function isInsideBoard(x, y) {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    x < 4 &&
    y >= 0 &&
    y < 4
  );
}

function readCell(cell, fallbackX, fallbackY) {
  if (cell == null || cell === 0) return { empty: true };

  const value = typeof cell === "number" ? cell : cell?.value;
  if (!isTileValue(value) || value === 0) return null;

  const position = typeof cell === "object" ? cell.position : null;
  const x = position == null ? fallbackX : position.x;
  const y = position == null ? fallbackY : position.y;
  if (!isInsideBoard(x, y)) return null;
  return { empty: false, value, x, y };
}

function boardFromCells(cells) {
  const isMatrix =
    Array.isArray(cells) &&
    cells.length === 4 &&
    cells.every((row) => Array.isArray(row) && row.length === 4);
  const isFlat = Array.isArray(cells) && cells.length === 16;
  if (!isMatrix && !isFlat) return null;

  const board = emptyBoard();
  const occupied = new Set();
  let tileCount = 0;

  for (let index = 0; index < 16; index += 1) {
    const fallbackX = index % 4;
    const fallbackY = Math.floor(index / 4);
    const cell = isMatrix ? cells[fallbackY][fallbackX] : cells[index];
    const parsed = readCell(cell, fallbackX, fallbackY);
    if (!parsed) return null;
    if (parsed.empty) continue;

    const key = `${parsed.y}:${parsed.x}`;
    if (occupied.has(key)) return null;
    occupied.add(key);
    board[parsed.y][parsed.x] = parsed.value;
    tileCount += 1;
  }

  if (tileCount === 0) return null;
  return { board: normalizeBoard(board), tileCount };
}

function gameplayState(state) {
  return state?.state === "selecting" && state.previousGameplay
    ? state.previousGameplay
    : state;
}

export function boardFromState(state) {
  const gameplay = gameplayState(state);
  const candidates = [
    gameplay?.board,
    gameplay?.board?.cells,
    gameplay?.grid?.cells,
    gameplay?.grid,
    gameplay?.tiles,
  ];
  for (const candidate of candidates) {
    const parsed = boardFromCells(candidate);
    if (parsed) return parsed;
  }
  return null;
}

export function statusFromState(state) {
  const gameplay = gameplayState(state);
  const status =
    typeof gameplay?.state === "string" ? gameplay.state.toLowerCase() : "";
  if (
    status === "gameover" ||
    status === "game-over" ||
    gameplay?.over === true
  )
    return "game-over";
  if (
    status === "gamewon" ||
    status === "game-won" ||
    (gameplay?.won === true && gameplay?.keepPlaying !== true)
  ) {
    return "won";
  }
  return "playing";
}

function scoreFromState(state) {
  const score = gameplayState(state)?.score;
  return Number.isFinite(score) && score >= 0 ? Math.trunc(score) : null;
}

export function parseScoreText(value) {
  if (typeof value !== "string") return null;
  const match = value.replaceAll(",", "").match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function modeOrder(locationPath = "") {
  const path = locationPath.toLowerCase();
  if (path.includes(TUTORIAL_MODE)) return [TUTORIAL_MODE];
  const preferred = PLAYABLE_MODES.find((mode) => path.includes(mode));
  if (!preferred) return PLAYABLE_MODES;
  return [preferred, ...PLAYABLE_MODES.filter((mode) => mode !== preferred)];
}

export function recognizeFromStorage(entries = [], locationPath = "") {
  const storage = new Map(
    entries.filter(
      ([key, value]) => typeof key === "string" && typeof value === "string",
    ),
  );

  for (const mode of modeOrder(locationPath)) {
    const raw = storage.get(play2048StorageKey(`${APP_STATE_PREFIX}-${mode}`));
    if (!raw) continue;
    try {
      const state = decodePlay2048Payload(raw);
      const parsed = boardFromState(state);
      if (parsed) {
        return {
          ...parsed,
          status: statusFromState(state),
          score: scoreFromState(state),
          duplicateTiles: 0,
          recognitionSource: `play2048-storage:${mode}`,
        };
      }
    } catch {
      // A malformed storage source is expected to fall through to the next source.
    }
  }

  const classicRaw = storage.get("gameState");
  if (classicRaw) {
    try {
      const state = decodePlay2048Payload(classicRaw);
      const parsed = boardFromState(state);
      if (parsed) {
        return {
          ...parsed,
          status: statusFromState(state),
          score: scoreFromState(state),
          duplicateTiles: 0,
          recognitionSource: "classic-storage",
        };
      }
    } catch {
      // DOM recognition is the final fallback for malformed classic storage.
    }
  }
  return null;
}

export function recognizeFromDom(snapshot) {
  const positions = new Map();
  let validTileCount = 0;
  const tileClassNames = Array.isArray(snapshot.tileClassNames)
    ? snapshot.tileClassNames
    : [];

  for (const className of tileClassNames) {
    if (typeof className !== "string") continue;
    const valueMatch = className.match(/(?:^|\s)tile-(\d+)(?:\s|$)/);
    const positionMatch = className.match(
      /(?:^|\s)tile-position-(\d+)-(\d+)(?:\s|$)/,
    );
    if (!valueMatch || !positionMatch) continue;

    const value = Number.parseInt(valueMatch[1], 10);
    const x = Number.parseInt(positionMatch[1], 10) - 1;
    const y = Number.parseInt(positionMatch[2], 10) - 1;
    if (!isTileValue(value) || value === 0 || !isInsideBoard(x, y)) continue;

    validTileCount += 1;
    const key = `${y}:${x}`;
    const current = positions.get(key);
    if (!current || value >= current.value) positions.set(key, { x, y, value });
  }

  if (positions.size === 0) return null;
  const board = emptyBoard();
  for (const tile of positions.values()) board[tile.y][tile.x] = tile.value;

  const messageClass =
    typeof snapshot.messageClass === "string" ? snapshot.messageClass : "";
  const messageText =
    typeof snapshot.messageText === "string" ? snapshot.messageText : "";
  let status = "playing";
  if (/game-over/.test(messageClass) || /Game over/i.test(messageText))
    status = "game-over";
  else if (/game-won/.test(messageClass) || /You win/i.test(messageText))
    status = "won";

  return {
    board: normalizeBoard(board),
    status,
    score: parseScoreText(snapshot.scoreText),
    tileCount: positions.size,
    duplicateTiles: validTileCount - positions.size,
    recognitionSource: "classic-dom",
  };
}

export function recognizeSnapshot(snapshot) {
  return (
    recognizeFromStorage(snapshot.localStorageEntries, snapshot.locationPath) ??
    recognizeFromDom(snapshot)
  );
}

export async function snapshotPage(page) {
  return page.evaluate(() => {
    const tiles = Array.from(
      document.querySelectorAll(".tile-container .tile"),
    );
    const messageElement = document.querySelector(".game-message");
    const localStorageEntries = [];
    try {
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        const value = key ? localStorage.getItem(key) : null;
        if (key && value) localStorageEntries.push([key, value]);
      }
    } catch {
      // Some contexts block localStorage; DOM recognition can still succeed.
    }
    return {
      tileClassNames: tiles.map((tile) =>
        typeof tile.className === "string"
          ? tile.className
          : (tile.className?.baseVal ?? ""),
      ),
      localStorageEntries,
      locationPath: window.location?.pathname ?? "",
      scoreText:
        document
          .querySelector(".score-container")
          ?.textContent?.replace(/\s+/g, " ")
          .trim() ?? "",
      messageText:
        messageElement?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      messageClass: messageElement?.className ?? "",
    };
  });
}

export async function readGameState(page) {
  const recognized = recognizeSnapshot(await snapshotPage(page));
  if (!recognized) {
    throw new Error(
      "Could not recognize a 2048 board from play2048.co storage or DOM.",
    );
  }
  return recognized;
}

function statesEqual(first, second) {
  return (
    boardsEqual(first.board, second.board) &&
    first.status === second.status &&
    first.score === second.score &&
    first.recognitionSource === second.recognitionSource &&
    first.duplicateTiles === second.duplicateTiles
  );
}

function isStableCandidate(state) {
  return (
    state.recognitionSource !== "classic-dom" || state.duplicateTiles === 0
  );
}

export async function waitForStableState(page, options = {}) {
  const samples = options.samples ?? 2;
  const intervalMs = options.intervalMs ?? 50;
  const maxAttempts = options.maxAttempts ?? 20;
  let previous = null;
  let stableCount = 0;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const current = await readGameState(page);
      lastError = null;
      if (!isStableCandidate(current)) {
        previous = null;
        stableCount = 0;
        await delay(intervalMs);
        continue;
      }
      if (previous && statesEqual(previous, current)) {
        stableCount += 1;
        if (stableCount >= samples - 1) return current;
      } else {
        previous = current;
        stableCount = 0;
      }
    } catch (error) {
      lastError = error;
      previous = null;
      stableCount = 0;
    }
    await delay(intervalMs);
  }

  if (lastError) throw lastError;
  if (previous) return previous;
  throw new Error("2048 board did not become stable.");
}

export async function clearStoredGame(page) {
  const keys = [
    "gameState",
    ...STORAGE_MODES.map((mode) =>
      play2048StorageKey(`${APP_STATE_PREFIX}-${mode}`),
    ),
  ];
  await page.evaluate((storageKeys) => {
    for (const key of storageKeys) localStorage.removeItem(key);
  }, keys);
}
