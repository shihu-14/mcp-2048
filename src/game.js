export const BOARD_SIZE = 4;
export const DIRECTIONS = Object.freeze(["up", "down", "left", "right"]);

export function isTileValue(value) {
  return (
    value === 0 ||
    (Number.isSafeInteger(value) &&
      value >= 2 &&
      2 ** Math.round(Math.log2(value)) === value)
  );
}

export function normalizeBoard(board) {
  if (!Array.isArray(board) || board.length !== BOARD_SIZE) {
    throw new Error("Board must be a 4x4 array.");
  }

  return board.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== BOARD_SIZE) {
      throw new Error(`Board row ${rowIndex} must contain exactly 4 cells.`);
    }

    return row.map((cell, columnIndex) => {
      if (!isTileValue(cell)) {
        throw new Error(
          `Board cell [${rowIndex}, ${columnIndex}] must be 0 or a power of two greater than 1.`,
        );
      }
      return cell;
    });
  });
}

export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

export function boardsEqual(first, second) {
  const normalizedFirst = normalizeBoard(first);
  const normalizedSecond = normalizeBoard(second);

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let column = 0; column < BOARD_SIZE; column += 1) {
      if (normalizedFirst[row][column] !== normalizedSecond[row][column]) {
        return false;
      }
    }
  }
  return true;
}

function findEmptyCells(board) {
  const cells = [];
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let column = 0; column < BOARD_SIZE; column += 1) {
      if (board[row][column] === 0) {
        cells.push({ row, column });
      }
    }
  }
  return cells;
}

export function emptyCells(board) {
  return findEmptyCells(normalizeBoard(board));
}

export function slideLineLeft(line) {
  if (
    !Array.isArray(line) ||
    line.length !== BOARD_SIZE ||
    line.some((value) => !isTileValue(value))
  ) {
    throw new Error("Line must contain exactly 4 valid 2048 cells.");
  }

  const compacted = line.filter((value) => value !== 0);
  const merged = [];
  let scoreGain = 0;

  for (let index = 0; index < compacted.length; index += 1) {
    const current = compacted[index];
    if (current === compacted[index + 1]) {
      const combined = current * 2;
      merged.push(combined);
      scoreGain += combined;
      index += 1;
    } else {
      merged.push(current);
    }
  }

  while (merged.length < BOARD_SIZE) {
    merged.push(0);
  }

  return {
    line: merged,
    scoreGain,
    moved: merged.some((value, index) => value !== line[index]),
  };
}

function reverseRows(board) {
  return board.map((row) => row.slice().reverse());
}

function transpose(board) {
  return board[0].map((_, column) => board.map((row) => row[column]));
}

function moveLeft(board) {
  let moved = false;
  let scoreGain = 0;
  const nextBoard = board.map((row) => {
    const result = slideLineLeft(row);
    moved ||= result.moved;
    scoreGain += result.scoreGain;
    return result.line;
  });
  return { board: nextBoard, moved, scoreGain };
}

export function moveBoard(inputBoard, direction) {
  const board = normalizeBoard(inputBoard);
  if (!DIRECTIONS.includes(direction)) {
    throw new Error(`Unsupported direction: ${direction}`);
  }

  if (direction === "left") {
    return moveLeft(board);
  }
  if (direction === "right") {
    const moved = moveLeft(reverseRows(board));
    return { ...moved, board: reverseRows(moved.board) };
  }
  if (direction === "up") {
    const moved = moveLeft(transpose(board));
    return { ...moved, board: transpose(moved.board) };
  }

  const moved = moveLeft(reverseRows(transpose(board)));
  return { ...moved, board: transpose(reverseRows(moved.board)) };
}

export function legalMoves(board) {
  return DIRECTIONS.map((direction) => ({
    direction,
    result: moveBoard(board, direction),
  })).filter(({ result }) => result.moved);
}

export function isGameOver(board) {
  const normalized = normalizeBoard(board);
  return (
    findEmptyCells(normalized).length === 0 &&
    legalMoves(normalized).length === 0
  );
}
