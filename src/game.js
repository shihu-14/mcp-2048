export const DIRECTIONS = ["up", "down", "left", "right"];

const DIRECTION_ORDER = ["down", "left", "right", "up"];
const SPAWN_VALUES = [
  { value: 2, probability: 0.9 },
  { value: 4, probability: 0.1 }
];

const CORNER_WEIGHTS = [
  [4, 3, 2, 1],
  [5, 6, 7, 8],
  [12, 11, 10, 9],
  [13, 14, 15, 16]
];

export function normalizeBoard(board) {
  if (!Array.isArray(board) || board.length !== 4) {
    throw new Error("Board must be a 4x4 array.");
  }

  return board.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== 4) {
      throw new Error(`Board row ${rowIndex} must contain exactly 4 cells.`);
    }

    return row.map((cell, columnIndex) => {
      if (!Number.isInteger(cell) || cell < 0) {
        throw new Error(`Board cell [${rowIndex}, ${columnIndex}] must be a non-negative integer.`);
      }
      return cell;
    });
  });
}

export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

export function boardsEqual(first, second) {
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      if (first[row][column] !== second[row][column]) {
        return false;
      }
    }
  }
  return true;
}

export function emptyCells(board) {
  const cells = [];
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      if (board[row][column] === 0) {
        cells.push({ row, column });
      }
    }
  }
  return cells;
}

export function slideLineLeft(line) {
  const compacted = line.filter((value) => value !== 0);
  const merged = [];
  let scoreGain = 0;

  for (let index = 0; index < compacted.length; index += 1) {
    const current = compacted[index];
    const next = compacted[index + 1];

    if (current === next) {
      const combined = current * 2;
      merged.push(combined);
      scoreGain += combined;
      index += 1;
    } else {
      merged.push(current);
    }
  }

  while (merged.length < 4) {
    merged.push(0);
  }

  return {
    line: merged,
    scoreGain,
    moved: merged.some((value, index) => value !== line[index])
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
    moved = moved || result.moved;
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
    return {
      board: reverseRows(moved.board),
      moved: moved.moved,
      scoreGain: moved.scoreGain
    };
  }

  if (direction === "up") {
    const moved = moveLeft(transpose(board));
    return {
      board: transpose(moved.board),
      moved: moved.moved,
      scoreGain: moved.scoreGain
    };
  }

  const moved = moveLeft(reverseRows(transpose(board)));
  return {
    board: transpose(reverseRows(moved.board)),
    moved: moved.moved,
    scoreGain: moved.scoreGain
  };
}

export function legalMoves(board) {
  return DIRECTIONS.map((direction) => ({
    direction,
    result: moveBoard(board, direction)
  })).filter(({ result }) => result.moved);
}

export function isGameOver(board) {
  return emptyCells(board).length === 0 && legalMoves(board).length === 0;
}

function logTile(value) {
  return value > 0 ? Math.log2(value) : 0;
}

function countMergeOpportunities(board) {
  let opportunities = 0;

  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const value = board[row][column];
      if (value === 0) {
        continue;
      }
      if (column < 3 && board[row][column + 1] === value) {
        opportunities += 1;
      }
      if (row < 3 && board[row + 1][column] === value) {
        opportunities += 1;
      }
    }
  }

  return opportunities;
}

function smoothnessScore(board) {
  let penalty = 0;

  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const value = board[row][column];
      if (value === 0) {
        continue;
      }

      if (column < 3 && board[row][column + 1] !== 0) {
        penalty += Math.abs(logTile(value) - logTile(board[row][column + 1]));
      }
      if (row < 3 && board[row + 1][column] !== 0) {
        penalty += Math.abs(logTile(value) - logTile(board[row + 1][column]));
      }
    }
  }

  return -penalty;
}

function monotonicityScore(board) {
  let score = 0;

  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const left = logTile(board[row][column]);
      const right = logTile(board[row][column + 1]);
      if (row >= 2) {
        score += left >= right ? 1.5 : -1.5;
      } else {
        score += left <= right ? 0.75 : -0.75;
      }
    }
  }

  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 3; row += 1) {
      const upper = logTile(board[row][column]);
      const lower = logTile(board[row + 1][column]);
      score += lower >= upper ? 1.5 : -1.5;
    }
  }

  return score;
}

function cornerScore(board) {
  const maxTile = Math.max(...board.flat());
  if (maxTile === 0) {
    return 0;
  }

  let score = board[3][0] === maxTile ? 30 : -30;

  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      score += logTile(board[row][column]) * CORNER_WEIGHTS[row][column];
    }
  }

  return score;
}

export function evaluateBoard(board) {
  const normalized = normalizeBoard(board);
  const empties = emptyCells(normalized).length;
  const maxTile = Math.max(...normalized.flat());

  if (isGameOver(normalized)) {
    return -100000;
  }

  return (
    empties * 120 +
    Math.log2(maxTile || 2) * 40 +
    countMergeOpportunities(normalized) * 45 +
    monotonicityScore(normalized) * 16 +
    smoothnessScore(normalized) * 8 +
    cornerScore(normalized) * 3
  );
}

function chanceScore(board, depth) {
  const cells = emptyCells(board);

  if (depth <= 0 || cells.length === 0) {
    return evaluateBoard(board);
  }

  let total = 0;
  for (const cell of cells) {
    for (const spawn of SPAWN_VALUES) {
      const nextBoard = cloneBoard(board);
      nextBoard[cell.row][cell.column] = spawn.value;
      total += (spawn.probability / cells.length) * searchScore(nextBoard, depth - 1);
    }
  }

  return total;
}

function searchScore(board, depth) {
  const moves = legalMoves(board);
  if (depth <= 0 || moves.length === 0) {
    return evaluateBoard(board);
  }

  let best = -Infinity;
  for (const move of moves) {
    const score = move.result.scoreGain * 2 + chanceScore(move.result.board, depth);
    if (score > best) {
      best = score;
    }
  }

  return best;
}

function defaultDepth(board) {
  const empties = emptyCells(board).length;
  if (empties >= 8) {
    return 2;
  }
  if (empties >= 4) {
    return 3;
  }
  return 4;
}

export function chooseMove(inputBoard, options = {}) {
  const board = normalizeBoard(inputBoard);
  const depth = Number.isInteger(options.depth) ? options.depth : defaultDepth(board);
  const moves = legalMoves(board);

  if (moves.length === 0) {
    return {
      direction: null,
      scores: {},
      legalMoves: [],
      gameOver: true
    };
  }

  const scoredMoves = moves.map((move) => {
    const score = move.result.scoreGain * 2 + chanceScore(move.result.board, Math.max(0, depth - 1));
    const orderBonus = (DIRECTION_ORDER.length - DIRECTION_ORDER.indexOf(move.direction)) / 1000;
    return {
      direction: move.direction,
      score: score + orderBonus,
      scoreGain: move.result.scoreGain,
      resultingBoard: move.result.board
    };
  }).sort((first, second) => {
    if (second.score !== first.score) {
      return second.score - first.score;
    }
    return DIRECTION_ORDER.indexOf(first.direction) - DIRECTION_ORDER.indexOf(second.direction);
  });

  return {
    direction: scoredMoves[0].direction,
    scores: Object.fromEntries(scoredMoves.map((move) => [move.direction, move.score])),
    legalMoves: scoredMoves.map((move) => move.direction),
    scoreGain: scoredMoves[0].scoreGain,
    resultingBoard: scoredMoves[0].resultingBoard,
    depth,
    gameOver: false
  };
}

export function keyForDirection(direction) {
  const keys = {
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight"
  };

  if (!keys[direction]) {
    throw new Error(`Unsupported direction: ${direction}`);
  }

  return keys[direction];
}

export function delay(value) {
  return new Promise((resolve) => {
    setTimeout(resolve, value);
  });
}
