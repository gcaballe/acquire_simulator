// AI dispatcher: Easy (random), Medium (greedy 1-ply), Hard (determinized Monte Carlo).
import { getLegalActions, apply, determinize, netWorth } from "../engine/game.js";
import { scorePlacement, evaluateBuy } from "./heuristic.js";

export const DIFFICULTY = { EASY: "easy", MEDIUM: "medium", HARD: "hard" };

function randOf(arr, rand = Math.random) {
  return arr[(rand() * arr.length) | 0];
}

export function easyMove(state) {
  const acts = getLegalActions(state);
  return randOf(acts);
}

export function mediumMove(state) {
  const acts = getLegalActions(state);
  if (acts.length === 1) return acts[0];
  const me = state.turn.current;
  const kind = acts[0].type;
  if (kind === "place" || kind === "skipPlace") {
    let best = acts[0], bestV = -1e9;
    for (const a of acts) {
      if (a.type === "skipPlace") return a;
      const v = scorePlacement(state, me, a.tile) + Math.random() * 0.3;
      if (v > bestV) { bestV = v; best = a; }
    }
    return best;
  }
  if (kind === "found") {
    // pick highest base (expensive corps first), tie -> random
    const order = [...acts].sort((a, b) => corpBase(b.corp) - corpBase(a.corp));
    return order[0];
  }
  if (kind === "chooseSurvivor") {
    // survive the chain where we hold most (weighted by size)
    let best = acts[0], bestV = -1e9;
    for (const a of acts) {
      const v = state.players[me].shares[a.survivor] * 2 + (state.chains[a.survivor] || 0) * 0.1 + Math.random();
      if (v > bestV) { bestV = v; best = a; }
    }
    return best;
  }
  if (kind === "mergeDecision") {
    return greedyMerge(state, acts);
  }
  if (kind === "buy") {
    let best = acts[0], bestV = -1e9;
    for (const a of acts) {
      const v = evaluateBuy(state, me, a.buys) + Math.random() * 0.5 - Object.keys(a.buys).length * 0.05;
      if (v > bestV) { bestV = v; best = a; }
    }
    // sometimes buy nothing early is fine; keep greedy choice
    return best;
  }
  return randOf(acts);
}

function corpBase(c) {
  // import lazily to avoid cycles
  const bases = [200, 200, 300, 300, 300, 400, 400];
  return bases[c];
}

export function greedyMerge(state, acts) {
  // Prefer trade when survivor is big/safe and we can contest it; else sell; keep small stakes.
  const me = state.turn.current;
  const m = state.turn.merger;
  const survSize = state.chains[m.survivor] + (m.preySize || 0) + 1;
  const survSafeSoon = survSize >= 9;
  const mySurv = state.players[me].shares[m.survivor];
  const maxOtherSurv = Math.max(...state.players.map((p, i) => (i === me ? -1 : p.shares[m.survivor])));
  const tradeGood = survSafeSoon || mySurv + 3 >= maxOtherSurv;
  const scored = acts.map((a) => {
    let v = Math.random() * 0.5;
    v += a.sell * 0.6; // cash is useful
    if (tradeGood) v += a.trade * 0.9;
    else v += a.trade * 0.2;
    v += a.keep * (state.chains[m.prey] == null ? 0 : 0.1); // defunct paper rarely reforms
    // keep at least 1 if we hold many and prey might reform? tiny bonus
    return { a, v };
  });
  scored.sort((x, y) => y.v - x.v);
  return scored[0].a;
}

// ---- Hard: determinized Monte Carlo over root actions ----
export function hardMove(state, { simsPerMove = 60, maxPlayoutActions = 220, timeBudgetMs = 900 } = {}) {
  const acts = getLegalActions(state);
  if (acts.length === 1) return acts[0];
  const me = state.turn.current;
  const t0 = Date.now();
  // Reduce branching: for place (<=6 tiles) keep all; for buy (can be 50+), sample top by heuristic + random.
  let candidates = acts;
  if (acts[0]?.type === "buy" && acts.length > 24) {
    const ranked = acts.map((a) => ({ a, v: evaluateBuy(state, me, a.buys) + Math.random() * 0.4 }));
    ranked.sort((x, y) => y.v - x.v);
    candidates = [...ranked.slice(0, 12).map((r) => r.a)];
    if (!candidates.some((c) => Object.keys(c.buys).length === 0)) candidates.push({ type: "buy", player: me, buys: {} });
  }
  if (acts[0]?.type === "mergeDecision" && acts.length > 20) {
    candidates = [greedyMerge(state, acts), ...acts.slice(0, 8)];
  }
  if (candidates.length > 24) candidates = candidates.slice(0, 24);

  let best = candidates[0], bestScore = -Infinity;
  for (const cand of candidates) {
    if (Date.now() - t0 > timeBudgetMs) break;
    const sims = Math.max(8, Math.floor(simsPerMove * Math.min(1, timeBudgetMs / Math.max(1, candidates.length * 40))));
    let total = 0;
    for (let i = 0; i < sims; i++) {
      if (Date.now() - t0 > timeBudgetMs) break;
      total += rolloutValue(state, cand, me, maxPlayoutActions);
    }
    const avg = total / sims;
    if (avg > bestScore) { bestScore = avg; best = cand; }
  }
  return best;
}

function rolloutValue(rootState, firstAction, me, cap) {
  const s = determinize(rootState, me);
  let r = apply(s, firstAction);
  if (!r.ok) return -1e6;
  let st = r.state;
  let n = 0;
  while (!st.over && n++ < cap) {
    const acts = getLegalActions(st);
    if (!acts.length) break;
    // fast playout policy: medium-greedy for `me`, random-ish for others
    const cur = st.turn.current;
    let a;
    if (acts[0].type === "buy") {
      a = cur === me ? pickBest(acts, (x) => evaluateBuy(st, cur, x.buys)) : randomBuyOrSkip(st, acts);
    } else if (acts[0].type === "place") {
      a = pickBest(acts, (x) => (x.type === "skipPlace" ? 0 : scorePlacement(st, cur, x.tile)));
    } else if (acts[0].type === "mergeDecision") {
      a = greedyMerge(st, acts);
    } else {
      a = acts[(Math.random() * acts.length) | 0];
    }
    const rr = apply(st, a);
    if (!rr.ok) break;
    st = rr.state;
  }
  if (!st.over || !st.result) {
    // unfinished: use net worth diff as proxy
    const mine = netWorth(st, me);
    const bestOpp = Math.max(...st.players.map((p, i) => (i === me ? -Infinity : netWorth(st, i))));
    return mine - bestOpp;
  }
  const t = st.result.totals.find((x) => x.id === me);
  const win = st.result.winner === me ? 5000 : 0;
  return t.total + win;
}

function pickBest(acts, fn) {
  let best = acts[0], bv = -1e18;
  for (const a of acts) {
    const v = fn(a) + Math.random() * 0.2;
    if (v > bv) { bv = v; best = a; }
  }
  return best;
}

function randomBuyOrSkip(st, acts) {
  // bias to buying something affordable
  return acts[(Math.random() * acts.length) | 0];
}

export function getAiMove(state, difficulty = "medium", opts) {
  if (difficulty === "easy") return easyMove(state);
  if (difficulty === "hard") return hardMove(state, opts);
  return mediumMove(state);
}
