// Fast greedy heuristic shared by Medium AI and Hard rollouts.
import { corpPrice, corpBonuses, isSafe } from "../engine/rules.js";
import { neighbors } from "../engine/rules.js";

export function evaluateBuy(state, playerId, buys) {
  let score = 0;
  for (const [corp, n] of Object.entries(buys)) {
    const c = +corp;
    const size = state.chains[c];
    const price = corpPrice(c, size);
    const mine = state.players[playerId].shares[c];
    const holdings = state.players.map((p) => p.shares[c]);
    const maxOther = Math.max(...holdings.filter((_, i) => i !== playerId), 0);
    let v = 0;
    v += size >= 11 ? 3 : size >= 6 ? 2 : 1;
    if (mine + n > maxOther) v += 4;
    else if (mine + n === maxOther && mine > 0) v += 1.5;
    v += Math.max(0, (1200 - price) / 1200);
    if (isSafe(size)) v += 1;
    score += v * n;
  }
  return score;
}

export function scorePlacement(state, playerId, tile) {
  const nbs = neighbors(tile).map((i) => state.board[i]);
  const corps = [...new Set(nbs.filter((c) => c.t === "corp").map((c) => c.c))];
  const orphanAdj = nbs.filter((c) => c.t === "orphan").length;
  const me = state.players[playerId];
  if (corps.length >= 2) {
    let v = 5;
    const sizes = corps.map((c) => ({ c, size: state.chains[c] })).sort((a, b) => b.size - a.size);
    for (let i = 1; i < sizes.length; i++) {
      const { c, size } = sizes[i];
      const b = corpBonuses(c, size);
      if (!b || me.shares[c] === 0) { v -= 1; continue; }
      const others = state.players.map((p) => p.shares[c]);
      const maxOther = Math.max(...others.filter((_, k) => k !== playerId));
      if (me.shares[c] > maxOther) v += b.majority / 2000;
      else if (me.shares[c] === maxOther) v += (b.majority + b.minority) / 2 / 2000;
      else v += b.minority / 4000;
    }
    const surv = sizes[0].c;
    if (me.shares[surv] > 0) v += 1 + me.shares[surv] * 0.2;
    return v;
  }
  if (corps.length === 1) {
    const c = corps[0];
    let v = 1 + orphanAdj * 0.3;
    if (me.shares[c] > 0) v += 1 + me.shares[c] * 0.15;
    const others = state.players.map((p) => p.shares[c]);
    if (me.shares[c] >= Math.max(...others)) v += 1;
    if (isSafe(state.chains[c])) v += me.shares[c] > 0 ? 1 : -0.5;
    return v;
  }
  if (orphanAdj > 0) {
    let best = 0;
    for (let c = 0; c < 7; c++) {
      if (state.chains[c] != null) continue;
      const p = corpPrice(c, 2) || 300;
      best = Math.max(best, p / 500);
    }
    const r = Math.floor(tile / state.cols), col = tile % state.cols;
    const center = 1 - (Math.abs(r - 4) / 4 + Math.abs(col - 5.5) / 5.5) / 2;
    return 2.5 + best + center;
  }
  return 0.2;
}
