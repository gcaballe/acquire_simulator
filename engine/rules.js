// Classic Acquire pricing/bonus rules (tournament standard).
// Board 9 rows (A-I) x 12 cols (1-12) = 108 tiles. Safe = 11+. End = 41+ or all active safe.

import { CORPORATIONS } from "./corporations.js";

export const ROWS = 9;
export const COLS = 12;
export const TOTAL_TILES = ROWS * COLS; // 108
export const START_CASH = 6000;
export const RACK_SIZE = 6;
export const SHARES_PER_CORP = 25;
export const SAFE_SIZE = 11;
export const END_SIZE = 41;

export const ROW_LETTERS = "ABCDEFGHI";

export function tileLabel(id) {
  const r = Math.floor(id / COLS);
  const c = id % COLS;
  return `${c + 1}${ROW_LETTERS[r]}`;
}

export function parseTileLabel(label) {
  const m = /^(\d{1,2})([A-I])$/i.exec(label.trim());
  if (!m) return null;
  const c = parseInt(m[1], 10) - 1;
  const r = ROW_LETTERS.indexOf(m[2].toUpperCase());
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
  return r * COLS + c;
}

export function neighbors(id) {
  const r = Math.floor(id / COLS);
  const c = id % COLS;
  const out = [];
  if (r > 0) out.push(id - COLS);
  if (r < ROWS - 1) out.push(id + COLS);
  if (c > 0) out.push(id - 1);
  if (c < COLS - 1) out.push(id + 1);
  return out;
}

// Classic price level from chain size.
export function priceLevel(size) {
  if (size == null || size < 2) return null;
  if (size <= 5) return size;
  if (size <= 40) return Math.floor((size - 1) / 10) + 6;
  return 10;
}

export function sharePrice(base, size) {
  const lvl = priceLevel(size);
  if (lvl == null) return null;
  return base + 100 * (lvl - 2);
}

export function corpPrice(corpId, size) {
  return sharePrice(CORPORATIONS[corpId].base, size);
}

// Classic bonuses: majority 10x, minority 5x.
export function corpBonuses(corpId, size) {
  const p = corpPrice(corpId, size);
  if (p == null) return null;
  return { majority: p * 10, minority: p * 5 };
}

export function isSafe(size) {
  return size != null && size >= SAFE_SIZE;
}

export function canEndGame(chainSizes) {
  // chainSizes: array of size|null
  const active = chainSizes.filter((s) => s != null);
  if (active.length === 0) return false;
  if (active.some((s) => s >= END_SIZE)) return true;
  return active.every((s) => s >= SAFE_SIZE);
}

// Returns { majority: [playerIds], minority: [playerIds] } (classic 2-holder model)
export function topShareholders(holdings) {
  // holdings: [{player, shares}] with shares>0
  if (holdings.length === 0) return { majority: [], minority: [] };
  const max = Math.max(...holdings.map((h) => h.shares));
  const maj = holdings.filter((h) => h.shares === max).map((h) => h.player);
  const rest = holdings.filter((h) => h.shares !== max);
  if (maj.length > 1 || rest.length === 0) return { majority: maj, minority: [] };
  const max2 = Math.max(...rest.map((h) => h.shares));
  return { majority: maj, minority: rest.filter((h) => h.shares === max2).map((h) => h.player) };
}

// Classic payout map player->bonus for a defunct corp.
export function bonusPayouts(holdings, majorityBonus, minorityBonus) {
  const { majority, minority } = topShareholders(holdings);
  const out = new Map();
  if (majority.length === 0) return out;
  if (minority.length === 0) {
    // tie for majority OR sole holder: split majority+minority
    const total = majorityBonus + minorityBonus;
    const each = Math.ceil(total / majority.length / 100) * 100;
    for (const p of majority) out.set(p, each);
    return out;
  }
  for (const p of majority) out.set(p, majorityBonus);
  const eachMin = Math.ceil(minorityBonus / minority.length / 100) * 100;
  for (const p of minority) out.set(p, eachMin);
  return out;
}
