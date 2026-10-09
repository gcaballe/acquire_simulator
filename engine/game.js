// Pure Acquire engine — no DOM, JSON-serializable, multiplayer-ready.
// Classic tournament rules, 2016 corp names. See README + server/README for protocol.
//
// State shape (all plain data):
// {
//   rules: 'classic-2016', rows, cols,
//   players: [{id,name,isHuman,cash,shares:[7],tiles:[tileId,...]}],
//   bankShares:[7], board:[{t:'empty'|'orphan'|'corp', c?:corpId} x108],
//   chains:[size|null x7],
//   bag:[tileId,...] (facedown, back = top of draw pile),
//   turn: { whose, current, phase, tile:null|tileId, merger:null|{
//      adjacent:[corpId], survivor:null|corpId, pending:[corpId],
//      prey:null|corpId, preySize:null|number, preyIdx:int, order:[playerId],
//      done:Set-as-array } , bought:int },
//   over:bool, result:null|{bonuses, liquidated, totals, winner},
//   seed:int, log:[{t, msg}]
// }
// Phases: 'place','found','survivor','merge','buy','end','over'
// Action validation returns {ok, error} — never throws for bad client input.

import {
  ROWS, COLS, TOTAL_TILES, START_CASH, RACK_SIZE, SHARES_PER_CORP,
  SAFE_SIZE, neighbors, tileLabel, corpPrice, corpBonuses, isSafe,
  canEndGame, topShareholders, bonusPayouts,
} from "./rules.js";
import { CORPORATIONS } from "./corporations.js";

function shuffled(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createGame({ names, humans = null, seed = (Math.random() * 1e9) | 0 }) {
  const n = names.length;
  if (n < 2 || n > 6) throw new Error("2-6 players required");
  const rand = mulberry32(seed);
  const all = shuffled([...Array(TOTAL_TILES).keys()], rand);

  // Order tiles: one per player placed on board, closest to 1A starts.
  // 1A=0 ... closeness = id (row-major matches 1A,2A.. ordering? classic order: 1A closest,
  // 9A closer than 1B. Our id = r*12+c. Distance rank: compare row first? Classic: letter
  // dominates? "9A is closer than 1B" => row (letter) is major. rank = r + c*ROWS? Use that.)
  const rank = (id) => (id % COLS) * ROWS + Math.floor(id / COLS);
  const orderTiles = all.splice(all.length - n, n); // take n
  const order = orderTiles
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t) - rank(b.t));
  const turnOrder = order.map((o) => o.i); // player indices in seat order -> play order
  // Re-seat players in play order so players[0] starts.
  const seatedNames = turnOrder.map((i) => names[i]);
  const seatedHuman = humans ? turnOrder.map((i) => !!humans[i]) : turnOrder.map(() => false);

  const board = Array.from({ length: TOTAL_TILES }, () => ({ t: "empty" }));
  for (const { t } of order) board[t] = { t: "orphan" };

  const players = seatedNames.map((name, id) => ({
    id, name, isHuman: seatedHuman[id], cash: START_CASH, shares: Array(7).fill(0), tiles: [],
  }));
  // deal 6 each
  for (const p of players) for (let k = 0; k < RACK_SIZE; k++) p.tiles.push(all.pop());

  const state = {
    rules: "classic-2016",
    rows: ROWS, cols: COLS,
    players,
    bankShares: Array(7).fill(SHARES_PER_CORP),
    board,
    chains: Array(7).fill(null),
    bag: all,
    turn: { whose: 0, current: 0, phase: "place", tile: null, merger: null, bought: 0 },
    over: false, result: null,
    seed,
    log: [{ t: "setup", msg: `Game start — ${seatedNames.join(", ")}. ${seatedNames[0]} goes first.` }],
  };
  // If first player has no playable tile (rare with opening tiles), skip to buy.
  if (!hasPlayableTile(state, 0)) state.turn.phase = "buy";
  return state;
}

// ---------- queries ----------

export function chainSize(state, corp) { return state.chains[corp]; }
export function isActive(state, corp) { return state.chains[corp] != null; }
export function holdingsOf(state, corp) {
  return state.players.filter((p) => p.shares[corp] > 0).map((p) => ({ player: p.id, shares: p.shares[corp] }));
}

export function adjacentCorps(state, tile) {
  const set = new Set();
  for (const nb of neighbors(tile)) {
    const cell = state.board[nb];
    if (cell.t === "corp") set.add(cell.c);
  }
  return [...set];
}

export function adjacentOrphanCount(state, tile) {
  let n = 0;
  for (const nb of neighbors(tile)) if (state.board[nb].t === "orphan") n++;
  return n;
}

// Would this placement found a corp? (adjacent to orphan, no adjacent corp)
function placementKind(state, tile) {
  const nbs = neighbors(tile).map((i) => state.board[i]);
  const corps = new Set(nbs.filter((c) => c.t === "corp").map((c) => c.c));
  const orphan = nbs.some((c) => c.t === "orphan");
  if (corps.size >= 2) return "merge";
  if (corps.size === 1) return "expand";
  if (orphan) return "found";
  return "lone";
}

function allActive(state) { return state.chains.every((s) => s != null); }

export function isTileUnplayableMergeSafe(state, tile) {
  // empty required
  if (state.board[tile].t !== "empty") return false;
  const corps = adjacentCorps(state, tile);
  if (corps.length < 2) return false;
  return corps.every((c) => isSafe(state.chains[c]));
}

export function canPlaceTile(state, playerId, tile) {
  const p = state.players[playerId];
  if (!p.tiles.includes(tile)) return { ok: false, reason: "not-in-rack" };
  if (state.board[tile].t !== "empty") return { ok: false, reason: "occupied" };
  if (isTileUnplayableMergeSafe(state, tile)) return { ok: false, reason: "merges-two-safe" };
  const kind = placementKind(state, tile);
  if (kind === "found" && allActive(state)) return { ok: false, reason: "would-found-8th" };
  return { ok: true, kind };
}

export function playableTiles(state, playerId) {
  return state.players[playerId].tiles.filter((t) => canPlaceTile(state, playerId, t).ok);
}

export function hasPlayableTile(state, playerId) {
  return playableTiles(state, playerId).length > 0;
}

export function inactiveCorps(state) {
  return CORPORATIONS.map((c) => c.id).filter((id) => state.chains[id] == null);
}

// ---------- actions ----------
// getLegalActions returns UI/AI-friendly options for the CURRENT decision point.
export function getLegalActions(state) {
  if (state.over) return [];
  const t = state.turn;
  const me = t.current;
  if (t.phase === "place") {
    const tiles = playableTiles(state, me);
    if (tiles.length === 0) return [{ type: "skipPlace", player: me }];
    return tiles.map((tile) => ({ type: "place", player: me, tile, kind: placementKind(state, tile) }));
  }
  if (t.phase === "found") return inactiveCorps(state).map((corp) => ({ type: "found", player: me, corp }));
  if (t.phase === "survivor") {
    const m = t.merger;
    // tied largest among adjacent
    return m.tied.map((corp) => ({ type: "chooseSurvivor", player: me, survivor: corp }));
  }
  if (t.phase === "merge") {
    const m = t.merger;
    const hold = state.players[me].shares[m.prey];
    const survBank = state.bankShares[m.survivor];
    const opts = [];
    for (let trade = 0; trade <= hold; trade += 2) {
      if (trade / 2 > survBank) continue;
      for (let sell = 0; sell <= hold - trade; sell++) {
        opts.push({ type: "mergeDecision", player: me, prey: m.prey, survivor: m.survivor, keep: hold - trade - sell, sell, trade });
      }
    }
    return opts;
  }
  if (t.phase === "buy") {
    const p = state.players[me];
    const avail = CORPORATIONS.map((c) => c.id).filter((id) => {
      if (!isActive(state, id)) return false;
      if (state.bankShares[id] < 1) return false;
      const price = corpPrice(id, state.chains[id]);
      return price != null && price <= p.cash;
    });
    const combos = buyCombos(avail, state, p);
    return combos.map((buys) => ({ type: "buy", player: me, buys }));
  }
  if (t.phase === "end") {
    const canEnd = canEndGame(state.chains);
    const opts = [{ type: "endTurn", player: me, endGame: false }];
    if (canEnd) opts.push({ type: "endTurn", player: me, endGame: true });
    return opts;
  }
  return [];
}

function buyCombos(avail, state, player) {
  // all multisets of up to 3 affordable, respecting bank counts
  const res = new Map();
  const key = (m) => JSON.stringify(m);
  res.set(key({}), {});
  const price = (id) => corpPrice(id, state.chains[id]);
  const tryAdd = (m) => {
    const entries = Object.entries(m).map(([k, v]) => [+k, v]);
    let cost = 0;
    for (const [id, n] of entries) {
      if (state.bankShares[id] < n) return;
      cost += price(id) * n;
    }
    const total = entries.reduce((a, [, n]) => a + n, 0);
    if (total > 3 || cost > player.cash) return;
    res.set(key(m), Object.fromEntries(entries));
  };
  tryAdd({});
  for (const a of avail) tryAdd({ [a]: 1 });
  for (const a of avail) {
    if (state.bankShares[a] >= 2 && price(a) * 2 <= player.cash) tryAdd({ [a]: 2 });
    if (state.bankShares[a] >= 3 && price(a) * 3 <= player.cash) tryAdd({ [a]: 3 });
  }
  for (let i = 0; i < avail.length; i++) for (let j = i + 1; j < avail.length; j++) {
    const [a, b] = [avail[i], avail[j]];
    if (price(a) + price(b) <= player.cash) tryAdd({ [a]: 1, [b]: 1 });
    if (state.bankShares[a] >= 2 && price(a) * 2 + price(b) <= player.cash) tryAdd({ [a]: 2, [b]: 1 });
    if (state.bankShares[b] >= 2 && price(a) + price(b) * 2 <= player.cash) tryAdd({ [a]: 1, [b]: 2 });
  }
  for (let i = 0; i < avail.length; i++) for (let j = i + 1; j < avail.length; j++) for (let k = j + 1; k < avail.length; k++) {
    const [a, b, c] = [avail[i], avail[j], avail[k]];
    if (price(a) + price(b) + price(c) <= player.cash) tryAdd({ [a]: 1, [b]: 1, [c]: 1 });
  }
  return [...res.values()];
}

// applyAction mutates a draft; use apply(state, action) for immutable step.
export function apply(state, action) {
  const next = structuredClone(state);
  const r = applyInPlace(next, action);
  return { state: next, ...r };
}

export function applyInPlace(s, a) {
  if (s.over) return { ok: false, error: "game-over" };
  const t = s.turn;
  if (a.player !== t.current && !(a.type === "endTurn" && a.player === t.whose)) {
    return { ok: false, error: "not-your-decision" };
  }
  switch (a.type) {
    case "skipPlace": {
      if (t.phase !== "place") return { ok: false, error: "bad-phase" };
      if (playableTiles(s, t.current).length !== 0) return { ok: false, error: "has-playable" };
      t.phase = "buy";
      pushLog(s, `${name(s, t.current)} has no playable tile and skips to buying.`);
      return { ok: true };
    }
    case "place": return doPlace(s, a.player, a.tile);
    case "found": return doFound(s, a.player, a.corp);
    case "chooseSurvivor": return doChooseSurvivor(s, a.player, a.survivor);
    case "mergeDecision": return doMergeDecision(s, a.player, a);
    case "buy": return doBuy(s, a.player, a.buys || {});
    case "endTurn": return doEndTurn(s, a.player, !!a.endGame);
    default: return { ok: false, error: "unknown-action" };
  }
}

function name(s, id) { return s.players[id].name; }

function pushLog(s, msg) { s.log.push({ t: s.turn.phase, msg }); if (s.log.length > 400) s.log = s.log.slice(-400); }

// Flood-convert connected orphan region containing `start` (plus start) to corp.
function absorbRegion(s, start, corp) {
  let count = 0;
  const seen = new Set([start]);
  const q = [start];
  s.board[start] = { t: "corp", c: corp };
  count++;
  while (q.length) {
    const cur = q.pop();
    for (const nb of neighbors(cur)) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      if (s.board[nb].t === "orphan") {
        s.board[nb] = { t: "corp", c: corp };
        count++;
        q.push(nb);
      }
    }
  }
  return count;
}

function doPlace(s, player, tile) {
  const t = s.turn;
  if (t.phase !== "place") return { ok: false, error: "bad-phase" };
  if (t.whose !== player || t.current !== player) return { ok: false, error: "not-your-turn" };
  const chk = canPlaceTile(s, player, tile);
  if (!chk.ok) return { ok: false, error: chk.reason };
  // remove from rack, put orphan marker temporarily
  s.players[player].tiles = s.players[player].tiles.filter((x) => x !== tile);
  s.board[tile] = { t: "orphan" };
  t.tile = tile;
  const kind = chk.kind;
  pushLog(s, `${name(s, player)} places ${tileLabel(tile)}.`);
  if (kind === "lone") { t.phase = "buy"; return { ok: true }; }
  if (kind === "found") { t.phase = "found"; return { ok: true }; }
  if (kind === "expand") {
    const corps = adjacentCorps(s, tile);
    const corp = corps[0];
    const gained = absorbRegion(s, tile, corp);
    s.chains[corp] += gained;
    pushLog(s, `${CORPORATIONS[corp].name} grows to ${s.chains[corp]}.`);
    t.phase = "buy";
    return { ok: true };
  }
  // merge
  const adjacent = adjacentCorps(s, tile);
  const sizes = adjacent.map((c) => ({ c, size: s.chains[c] }));
  const maxSize = Math.max(...sizes.map((x) => x.size));
  const tied = sizes.filter((x) => x.size === maxSize).map((x) => x.c);
  // unplayable already excluded; safe-vs-safe excluded
  t.merger = {
    adjacent, tied, survivor: null, pending: [], prey: null, preySize: null,
    preyIdx: -1, order: [], orderPos: 0, maker: player,
  };
  if (tied.length === 1) {
    beginMergerWithSurvivor(s, tied[0]);
  } else {
    t.phase = "survivor";
    pushLog(s, `Merger! ${adjacent.map((c) => CORPORATIONS[c].name).join(" + ")} — ${name(s, player)} chooses survivor.`);
  }
  return { ok: true };
}

function beginMergerWithSurvivor(s, survivor) {
  const t = s.turn;
  const m = t.merger;
  m.survivor = survivor;
  m.pending = m.adjacent.filter((c) => c !== survivor).sort((a, b) => s.chains[b] - s.chains[a]);
  pushLog(s, `${CORPORATIONS[survivor].name} will survive.`);
  nextPrey(s);
}

function nextPrey(s) {
  const t = s.turn;
  const m = t.merger;
  m.preyIdx++;
  if (m.preyIdx >= m.pending.length) {
    // all defunct resolved -> finalize board
    finalizeMerger(s);
    return;
  }
  const prey = m.pending[m.preyIdx];
  m.prey = prey;
  m.preySize = s.chains[prey]; // frozen BEFORE merger tile counts
  // pay bonuses now (classic)
  const holdings = holdingsOf(s, prey);
  const b = corpBonuses(prey, m.preySize);
  const payouts = bonusPayouts(holdings, b.majority, b.minority);
  for (const [pid, amt] of payouts) {
    s.players[pid].cash += amt;
  }
  const desc = holdings.length
    ? [...payouts.entries()].map(([p, amt]) => `${name(s, p)} +$${amt}`).join("; ")
    : "no shareholders";
  pushLog(s, `${CORPORATIONS[prey].name} (${m.preySize}) is defunct — bonuses: ${desc}.`);
  // decision order: maker clockwise
  const n = s.players.length;
  m.order = Array.from({ length: n }, (_, k) => (m.maker + k) % n);
  m.orderPos = 0;
  t.current = m.order[0];
  t.phase = "merge";
}

function doChooseSurvivor(s, player, survivor) {
  const t = s.turn;
  if (t.phase !== "survivor") return { ok: false, error: "bad-phase" };
  if (!t.merger.tied.includes(survivor)) return { ok: false, error: "not-tied" };
  beginMergerWithSurvivor(s, survivor);
  return { ok: true };
}

function doMergeDecision(s, player, { keep = 0, sell = 0, trade = 0, prey, survivor }) {
  const t = s.turn;
  const m = t.merger;
  if (t.phase !== "merge") return { ok: false, error: "bad-phase" };
  if (player !== t.current) return { ok: false, error: "not-your-decision" };
  if (prey !== m.prey || survivor !== m.survivor) return { ok: false, error: "stale-merger" };
  const p = s.players[player];
  if (trade % 2 !== 0) return { ok: false, error: "trade-must-be-even" };
  if (keep + sell + trade !== p.shares[prey]) return { ok: false, error: "must-account-all-shares" };
  if (trade / 2 > s.bankShares[survivor]) return { ok: false, error: "no-survivor-shares" };
  const price = corpPrice(prey, m.preySize);
  // execute: sell -> cash, trade -> bank swap, keep stays
  if (sell > 0) {
    p.shares[prey] -= sell;
    s.bankShares[prey] += sell;
    p.cash += sell * price;
  }
  if (trade > 0) {
    p.shares[prey] -= trade;
    s.bankShares[prey] += trade;
    const got = trade / 2;
    s.bankShares[survivor] -= got;
    p.shares[survivor] += got;
  }
  pushLog(s, `${name(s, player)} ${keep} keep / ${sell} sell / ${trade} trade (${CORPORATIONS[prey].name}→${CORPORATIONS[survivor].name}).`);
  // advance
  m.orderPos++;
  if (m.orderPos < m.order.length) {
    t.current = m.order[m.orderPos];
    return { ok: true };
  }
  // prey done -> convert its tiles to survivor
  convertCorp(s, prey, survivor);
  nextPrey(s);
  if (!s.over && s.turn.phase === "buy") {
    // merger chain finished; control returns to maker for buying
    s.turn.current = s.turn.whose;
  }
  return { ok: true };
}

function convertCorp(s, prey, survivor) {
  let preyCount = 0;
  for (let i = 0; i < s.board.length; i++) {
    if (s.board[i].t === "corp" && s.board[i].c === prey) {
      s.board[i] = { t: "corp", c: survivor };
      preyCount++;
    }
  }
  const survBefore = s.chains[survivor] || 0;
  s.chains[survivor] = survBefore + preyCount;
  s.chains[prey] = null;
  pushLog(s, `${CORPORATIONS[survivor].name} absorbs ${CORPORATIONS[prey].name} → ${s.chains[survivor]} tiles.`);
}

function finalizeMerger(s) {
  const t = s.turn;
  const m = t.merger;
  // merging tile + adjacent orphans join survivor
  const gained = absorbRegion(s, t.tile, m.survivor);
  s.chains[m.survivor] += gained;
  pushLog(s, `${CORPORATIONS[m.survivor].name} now ${s.chains[m.survivor]} tiles (incl. merger tile).`);
  t.merger = null;
  t.current = t.whose;
  t.phase = "buy";
}

function doFound(s, player, corp) {
  const t = s.turn;
  if (t.phase !== "found") return { ok: false, error: "bad-phase" };
  if (s.chains[corp] != null) return { ok: false, error: "already-active" };
  const gained = absorbRegion(s, t.tile, corp);
  s.chains[corp] = gained;
  let bonus = "";
  if (s.bankShares[corp] > 0) {
    s.bankShares[corp]--;
    s.players[player].shares[corp]++;
    bonus = " +1 free share";
  }
  pushLog(s, `${name(s, player)} founds ${CORPORATIONS[corp].name} (${gained} tiles)${bonus}.`);
  t.phase = "buy";
  return { ok: true };
}

function doBuy(s, player, buys) {
  const t = s.turn;
  if (t.phase !== "buy") return { ok: false, error: "bad-phase" };
  if (player !== t.current) return { ok: false, error: "not-your-decision" };
  const entries = Object.entries(buys || {}).map(([k, v]) => [+k, v]);
  const total = entries.reduce((a, [, n]) => a + n, 0);
  if (total > 3) return { ok: false, error: "max-3-shares" };
  let cost = 0;
  for (const [id, n] of entries) {
    if (!Number.isInteger(n) || n < 0) return { ok: false, error: "bad-count" };
    if (!isActive(s, id)) return { ok: false, error: "inactive-corp" };
    if (s.bankShares[id] < n) return { ok: false, error: "bank-empty" };
    cost += corpPrice(id, s.chains[id]) * n;
  }
  const p = s.players[player];
  if (cost > p.cash) return { ok: false, error: "insufficient-cash" };
  for (const [id, n] of entries) {
    if (n === 0) continue;
    s.bankShares[id] -= n;
    p.shares[id] += n;
    p.cash -= corpPrice(id, s.chains[id]) * n;
  }
  const desc = entries.filter(([, n]) => n > 0).map(([id, n]) => `${n}×${CORPORATIONS[id].name}`).join(", ") || "nothing";
  pushLog(s, `${name(s, player)} buys ${desc}.`);
  t.bought = total;
  t.current = t.whose;
  t.phase = "end";
  return { ok: true };
}

function doEndTurn(s, player, endGame) {
  const t = s.turn;
  if (t.phase !== "end") return { ok: false, error: "bad-phase" };
  if (player !== t.whose) return { ok: false, error: "not-your-turn" };
  if (endGame) {
    if (!canEndGame(s.chains)) return { ok: false, error: "cannot-end" };
    finishGame(s, `${name(s, player)} ends the game.`);
    return { ok: true, ended: true };
  }
  // discard permanently unplayable (merge-two-safe), redraw to 6
  const p = s.players[player];
  const dead = p.tiles.filter((tile) => s.board[tile].t === "empty" && isTileUnplayableMergeSafe(s, tile));
  if (dead.length) {
    p.tiles = p.tiles.filter((x) => !dead.includes(x));
    pushLog(s, `${name(s, player)} discards ${dead.length} dead tile(s).`);
  }
  while (p.tiles.length < RACK_SIZE && s.bag.length) p.tiles.push(s.bag.pop());
  // next player
  const next = (t.whose + 1) % s.players.length;
  s.turn = { whose: next, current: next, phase: hasPlayableTile(s, next) ? "place" : "buy", tile: null, merger: null, bought: 0 };
  if (s.turn.phase === "buy") pushLog(s, `${name(s, next)} has no playable tile.`);
  return { ok: true };
}

function finishGame(s, why) {
  pushLog(s, why);
  // bonuses for all active corps
  for (let c = 0; c < 7; c++) {
    if (s.chains[c] == null) continue;
    const holdings = holdingsOf(s, c);
    const b = corpBonuses(c, s.chains[c]);
    const payouts = bonusPayouts(holdings, b.majority, b.minority);
    for (const [pid, amt] of payouts) s.players[pid].cash += amt;
  }
  // liquidate
  const totals = s.players.map((p) => {
    let shareValue = 0;
    for (let c = 0; c < 7; c++) {
      if (s.chains[c] == null) continue;
      shareValue += p.shares[c] * corpPrice(c, s.chains[c]);
    }
    return { id: p.id, name: p.name, cash: p.cash, shareValue, total: p.cash + shareValue };
  });
  totals.sort((a, b) => b.total - a.total);
  s.over = true;
  s.turn.phase = "over";
  s.result = { totals, winner: totals[0].id };
  pushLog(s, `Game over — ${totals[0].name} wins with $${totals[0].total}.`);
}

export function netWorth(s, playerId) {
  const p = s.players[playerId];
  let v = p.cash;
  for (let c = 0; c < 7; c++) if (s.chains[c] != null) v += p.shares[c] * corpPrice(c, s.chains[c]);
  return v;
}

// Public view for multiplayer: hide other players' tiles (show count only).
export function publicView(state, viewerId) {
  const v = structuredClone(state);
  for (const p of v.players) {
    if (p.id !== viewerId) {
      p.tiles = { hidden: p.tiles.length };
    }
  }
  return v;
}

// Determinize hidden info for AI search: randomly reassign opponents' tiles + bag.
export function determinize(state, perspective, rand = Math.random) {
  const s = structuredClone(state);
  const hidden = [];
  for (const p of s.players) {
    if (p.id === perspective) continue;
    const n = Array.isArray(p.tiles) ? p.tiles.length : p.tiles.hidden;
    hidden.push(...(Array.isArray(p.tiles) ? p.tiles : []));
    p._n = n;
  }
  // collect bag + all hidden tiles, reshuffle
  const pool = [...s.bag, ...hidden];
  // also tiles hidden inside p.tiles already collected; clear
  for (const p of s.players) if (p.id !== perspective) p.tiles = [];
  const sh = pool.slice();
  for (let i = sh.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [sh[i], sh[j]] = [sh[j], sh[i]];
  }
  for (const p of s.players) {
    if (p.id === perspective) continue;
    for (let k = 0; k < p._n; k++) p.tiles.push(sh.pop());
    delete p._n;
  }
  s.bag = sh;
  return s;
}

export function serialize(state) { return JSON.stringify(state); }
export function deserialize(json) { return JSON.parse(json); }
