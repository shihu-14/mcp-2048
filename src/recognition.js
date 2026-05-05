const APP_STATE_PREFIX = "k";
const APP_MODES = ["tutorial", "standard", "classic", "partner1"];
const OBFUSCATION_KEY = "dGhlIGJyb3duIGZveCBqdW1wcyBvdmVyIHRoZSBsYXp5IGRvZw==";
const BASE64_PADDING = ["", "=", "=="];

function textEncoder() {
  return new TextEncoder();
}

function textDecoder() {
  return new TextDecoder();
}

function base64Encode(binaryString) {
  if (typeof btoa === "function") {
    return btoa(binaryString);
  }
  return Buffer.from(binaryString, "binary").toString("base64");
}

function base64Decode(value) {
  if (typeof atob === "function") {
    return atob(value);
  }
  return Buffer.from(value, "base64").toString("binary");
}

function fixDecodePadding(value) {
  const length = value.length;
  let paddingLength = 0;
  if (length >= 2 && value.charCodeAt(length - 2) === 61) {
    paddingLength = 2;
  } else if (length >= 1 && value.charCodeAt(length - 1) === 61) {
    paddingLength = 1;
  }
  return value.substring(0, length - paddingLength) + BASE64_PADDING[(paddingLength + 1) % 3];
}

function fixEncodePadding(value) {
  const length = value.length;
  let paddingLength = 0;
  if (length >= 2 && value.charCodeAt(length - 2) === 61) {
    paddingLength = 2;
  } else if (length >= 1 && value.charCodeAt(length - 1) === 61) {
    paddingLength = 1;
  }
  return value.substring(0, length - paddingLength) + BASE64_PADDING[(paddingLength + 2) % 3];
}

export function play2048StorageKey(name) {
  const encoder = textEncoder();
  const saltSource = encoder.encode(name).reduce((total, byte) => total + Math.sin(byte), 0);
  const salt = Math.floor(1e7 * saltSource).toString(36);
  return encoder.encode(`${name}${salt}`).reduce((key, byte) => {
    return key + byte.toString(36).split("").reverse().join("");
  }, "");
}

export function decodePlay2048Payload(value) {
  try {
    return JSON.parse(value);
  } catch {
    const encodedSecret = textEncoder().encode(OBFUSCATION_KEY);
    const encrypted = base64Decode(fixDecodePadding(value));
    const decoded = new Uint8Array(encrypted.length);

    for (let index = 0; index < encrypted.length; index += 1) {
      decoded[index] = encrypted.charCodeAt(index) ^ encodedSecret[index % encodedSecret.length];
    }

    return JSON.parse(textDecoder().decode(decoded));
  }
}

export function encodePlay2048Payload(value) {
  const payload = textEncoder().encode(JSON.stringify(value));
  const encodedSecret = textEncoder().encode(OBFUSCATION_KEY);
  const encrypted = new Uint8Array(payload.length);

  for (let index = 0; index < payload.length; index += 1) {
    encrypted[index] = payload[index] ^ encodedSecret[index % encodedSecret.length];
  }

  return fixEncodePadding(base64Encode(String.fromCharCode(...encrypted)));
}

function emptyBoard() {
  return Array.from({ length: 4 }, () => Array(4).fill(0));
}

function isInsideBoard(x, y) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < 4 && y >= 0 && y < 4;
}

function tileValue(cell) {
  if (typeof cell === "number") {
    return cell > 0 ? cell : 0;
  }

  if (cell && typeof cell === "object" && Number.isInteger(cell.value) && cell.value > 0) {
    return cell.value;
  }

  return 0;
}

function tilePosition(cell, fallbackX, fallbackY) {
  const position = cell && typeof cell === "object" ? cell.position : null;
  if (position && isInsideBoard(position.x, position.y)) {
    return { x: position.x, y: position.y };
  }
  return { x: fallbackX, y: fallbackY };
}

function assignTile(board, cell, fallbackX, fallbackY) {
  const value = tileValue(cell);
  if (value === 0) {
    return 0;
  }

  const position = tilePosition(cell, fallbackX, fallbackY);
  if (!isInsideBoard(position.x, position.y)) {
    return 0;
  }

  board[position.y][position.x] = value;
  return 1;
}

function boardFromCells(cells) {
  if (!Array.isArray(cells)) {
    return null;
  }

  const board = emptyBoard();
  let tileCount = 0;

  if (cells.length === 4 && cells.every((row) => Array.isArray(row))) {
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        tileCount += assignTile(board, cells[y][x], x, y);
      }
    }
    return { board, tileCount };
  }

  if (cells.length === 16) {
    for (let index = 0; index < cells.length; index += 1) {
      const x = index % 4;
      const y = Math.floor(index / 4);
      tileCount += assignTile(board, cells[index], x, y);
    }
    return { board, tileCount };
  }

  return null;
}

export function boardFromState(state) {
  const gameplay = state?.state === "selecting" && state.previousGameplay ? state.previousGameplay : state;
  const candidates = [
    gameplay?.board,
    gameplay?.board?.cells,
    gameplay?.grid?.cells,
    gameplay?.grid,
    gameplay?.tiles
  ];

  for (const candidate of candidates) {
    const parsed = boardFromCells(candidate);
    if (parsed && parsed.tileCount > 0) {
      return parsed;
    }
  }

  return null;
}

export function statusFromState(state) {
  const gameplay = state?.state === "selecting" && state.previousGameplay ? state.previousGameplay : state;
  const status = typeof gameplay?.state === "string" ? gameplay.state.toLowerCase() : "";

  if (status === "gameover" || status === "game-over" || gameplay?.over === true) {
    return "game-over";
  }
  if (status === "gamewon" || status === "game-won" || gameplay?.won === true && gameplay?.keepPlaying !== true) {
    return "won";
  }
  return "playing";
}

function scoreFromState(state) {
  const gameplay = state?.state === "selecting" && state.previousGameplay ? state.previousGameplay : state;
  return Number.isFinite(gameplay?.score) ? String(gameplay.score) : "";
}

function modeOrder(locationPath = "") {
  const path = locationPath.toLowerCase();
  const preferred = APP_MODES.find((mode) => path.includes(mode));
  if (!preferred) {
    return APP_MODES;
  }
  return [preferred, ...APP_MODES.filter((mode) => mode !== preferred)];
}

function storageMap(entries = []) {
  return new Map(entries.filter(([key, value]) => typeof key === "string" && typeof value === "string"));
}

export function recognizeFromStorage(entries, locationPath = "") {
  const map = storageMap(entries);

  for (const mode of modeOrder(locationPath)) {
    const key = play2048StorageKey(`${APP_STATE_PREFIX}-${mode}`);
    const raw = map.get(key);
    if (!raw) {
      continue;
    }

    try {
      const state = decodePlay2048Payload(raw);
      const parsed = boardFromState(state);
      if (parsed) {
        return {
          board: parsed.board,
          status: statusFromState(state),
          scoreText: scoreFromState(state),
          messageText: "",
          tileCount: parsed.tileCount,
          duplicateTiles: 0,
          recognitionSource: `play2048-storage:${mode}`
        };
      }
    } catch {
      // Ignore malformed or stale storage and try the next source.
    }
  }

  const classicRaw = map.get("gameState");
  if (classicRaw) {
    try {
      const state = decodePlay2048Payload(classicRaw);
      const parsed = boardFromState(state);
      if (parsed) {
        return {
          board: parsed.board,
          status: statusFromState(state),
          scoreText: scoreFromState(state),
          messageText: "",
          tileCount: parsed.tileCount,
          duplicateTiles: 0,
          recognitionSource: "classic-storage"
        };
      }
    } catch {
      // Fall through to DOM recognition.
    }
  }

  return null;
}

export function recognizeFromDom(snapshot) {
  const board = emptyBoard();
  const positions = new Map();
  const tileClassNames = snapshot.tileClassNames ?? [];

  for (const className of tileClassNames) {
    const valueMatch = className.match(/(?:^|\s)tile-(\d+)(?:\s|$)/);
    const positionMatch = className.match(/(?:^|\s)tile-position-(\d+)-(\d+)(?:\s|$)/);

    if (!valueMatch || !positionMatch) {
      continue;
    }

    const value = Number.parseInt(valueMatch[1], 10);
    const x = Number.parseInt(positionMatch[1], 10) - 1;
    const y = Number.parseInt(positionMatch[2], 10) - 1;
    if (!isInsideBoard(x, y)) {
      continue;
    }

    const key = `${y}:${x}`;
    const current = positions.get(key);
    if (!current || value >= current.value) {
      positions.set(key, { x, y, value });
    }
  }

  for (const tile of positions.values()) {
    board[tile.y][tile.x] = tile.value;
  }

  if (positions.size === 0) {
    return null;
  }

  const messageClass = snapshot.messageClass ?? "";
  const messageText = snapshot.messageText ?? "";
  let status = "playing";
  if (/game-over/.test(messageClass) || /Game over/i.test(messageText)) {
    status = "game-over";
  } else if (/game-won/.test(messageClass) || /You win/i.test(messageText)) {
    status = "won";
  }

  return {
    board,
    status,
    scoreText: snapshot.scoreText ?? "",
    messageText,
    tileCount: positions.size,
    duplicateTiles: tileClassNames.length - positions.size,
    recognitionSource: "classic-dom"
  };
}

export function recognizeSnapshot(snapshot) {
  const storageRecognition = recognizeFromStorage(snapshot.localStorageEntries, snapshot.locationPath);
  if (storageRecognition) {
    return {
      ...storageRecognition,
      recognized: true
    };
  }

  const domRecognition = recognizeFromDom(snapshot);
  if (domRecognition) {
    return {
      ...domRecognition,
      recognized: true
    };
  }

  return {
    board: emptyBoard(),
    status: "unknown",
    scoreText: snapshot.scoreText ?? "",
    messageText: snapshot.messageText ?? "",
    tileCount: 0,
    duplicateTiles: 0,
    recognitionSource: "unavailable",
    recognized: false
  };
}
