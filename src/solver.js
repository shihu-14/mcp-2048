import {
  cloneBoard,
  emptyCells,
  isGameOver,
  legalMoves,
  normalizeBoard,
} from "./game.js";

const DIRECTION_ORDER = ["down", "left", "right", "up"];
const SPAWN_VALUES = [
  { value: 2, probability: 0.9 },
  { value: 4, probability: 0.1 },
];
const CORNER_WEIGHTS = [
  [4, 3, 2, 1],
  [5, 6, 7, 8],
  [12, 11, 10, 9],
  [13, 14, 15, 16],
];

function logTile(value) {
  return value > 0 ? Math.log2(value) : 0;
}

function countMergeOpportunities(board) {
  let opportunities = 0;
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const value = board[row][column];
      if (value === 0) continue;
      if (column < 3 && board[row][column + 1] === value) opportunities += 1;
      if (row < 3 && board[row + 1][column] === value) opportunities += 1;
    }
  }
  return opportunities;
}

function smoothnessScore(board) {
  let penalty = 0;
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      const value = board[row][column];
      if (value === 0) continue;
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
      score +=
        row >= 2 ? (left >= right ? 1.5 : -1.5) : left <= right ? 0.75 : -0.75;
    }
  }
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 3; row += 1) {
      score +=
        logTile(board[row + 1][column]) >= logTile(board[row][column])
          ? 1.5
          : -1.5;
    }
  }
  return score;
}

function cornerScore(board) {
  const maxTile = Math.max(...board.flat());
  if (maxTile === 0) return 0;

  let score = board[3][0] === maxTile ? 30 : -30;
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      score += logTile(board[row][column]) * CORNER_WEIGHTS[row][column];
    }
  }
  return score;
}

export function evaluateBoard(inputBoard) {
  const board = normalizeBoard(inputBoard);
  if (isGameOver(board)) return -100000;

  const empties = emptyCells(board).length;
  const maxTile = Math.max(...board.flat());
  return (
    empties * 120 +
    Math.log2(maxTile || 2) * 40 +
    countMergeOpportunities(board) * 45 +
    monotonicityScore(board) * 16 +
    smoothnessScore(board) * 8 +
    cornerScore(board) * 3
  );
}

function chanceScore(board, depth) {
  const cells = emptyCells(board);
  if (depth <= 0 || cells.length === 0) return evaluateBoard(board);

  let total = 0;
  for (const cell of cells) {
    for (const spawn of SPAWN_VALUES) {
      const nextBoard = cloneBoard(board);
      nextBoard[cell.row][cell.column] = spawn.value;
      total +=
        (spawn.probability / cells.length) * searchScore(nextBoard, depth - 1);
    }
  }
  return total;
}

function searchScore(board, depth) {
  const moves = legalMoves(board);
  if (depth <= 0 || moves.length === 0) return evaluateBoard(board);

  return Math.max(
    ...moves.map(
      (move) =>
        move.result.scoreGain * 2 + chanceScore(move.result.board, depth),
    ),
  );
}

function defaultDepth(board) {
  const empties = emptyCells(board).length;
  if (empties >= 8) return 2;
  if (empties >= 4) return 3;
  return 4;
}

export function chooseMove(inputBoard, options = {}) {
  const board = normalizeBoard(inputBoard);
  const depth = options.depth ?? defaultDepth(board);
  if (!Number.isInteger(depth) || depth < 0 || depth > 5) {
    throw new Error("depth must be an integer from 0 to 5.");
  }

  const moves = legalMoves(board);
  if (moves.length === 0) {
    return {
      direction: null,
      scores: {},
      legalMoves: [],
      depth,
      gameOver: true,
    };
  }

  const scoredMoves = moves
    .map((move) => {
      const score =
        move.result.scoreGain * 2 +
        chanceScore(move.result.board, Math.max(0, depth - 1));
      const orderBonus =
        (DIRECTION_ORDER.length - DIRECTION_ORDER.indexOf(move.direction)) /
        1000;
      return {
        direction: move.direction,
        score: score + orderBonus,
        scoreGain: move.result.scoreGain,
        resultingBoard: move.result.board,
      };
    })
    .sort((first, second) => {
      if (second.score !== first.score) return second.score - first.score;
      return (
        DIRECTION_ORDER.indexOf(first.direction) -
        DIRECTION_ORDER.indexOf(second.direction)
      );
    });

  return {
    direction: scoredMoves[0].direction,
    scores: Object.fromEntries(
      scoredMoves.map((move) => [move.direction, move.score]),
    ),
    legalMoves: scoredMoves.map((move) => move.direction),
    scoreGain: scoredMoves[0].scoreGain,
    resultingBoard: scoredMoves[0].resultingBoard,
    depth,
    gameOver: false,
  };
}
