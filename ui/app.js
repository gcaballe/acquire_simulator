import { CORPORATIONS } from "../engine/corporations.js";
import { ROWS, COLS, tileLabel, corpPrice, corpBonuses, canEndGame } from "../engine/rules.js";
import {
  createGame, getLegalActions, apply, playableTiles, canPlaceTile, netWorth,
} from "../engine/game.js";
import { getAiMove } from "../ai/index.js";

const $ = (id) => document.getElementById(id);
let state = null;
let seats = []; // {name, human, difficulty}
let aiTimer = null;
let fastMode = false; // off by default: AI advances one decision per manual click

function aiDelay() { return +$("aiDelay").value; }

function initSetup() {
  const renderSeats = () => {
    const n = +$("numPlayers").value;
    const wrap = $("seatRows");
    wrap.innerHTML = "";
    seats = [];
    for (let i = 0; i < n; i++) {
      const human = i === 0;
      const div = document.createElement("div");
      div.className = "seat";
      div.innerHTML = `<b>P${i + 1}</b>`;
      const nm = document.createElement("input");
      nm.value = human ? $("humanName").value : `AI-${i + 1}`;
      nm.maxLength = 12;
      const sel = document.createElement("select");
      if (human) {
        sel.innerHTML = `<option value="human" selected>You (human)</option>`;
      } else {
        sel.innerHTML = `<option value="easy">AI easy</option><option value="medium" selected>AI medium</option><option value="hard">AI hard</option>`;
      }
      div.append(nm, sel);
      wrap.append(div);
      seats.push({ elName: nm, elDiff: sel });
    }
  };
  $("numPlayers").onchange = renderSeats;
  $("humanName").oninput = () => { if (seats[0]) seats[0].elName.value = $("humanName").value; };
  $("aiDelay").oninput = () => ($("aiDelayVal").textContent = `${$("aiDelay").value}ms`);
  $("fastModeLive").onchange = () => {
    fastMode = $("fastModeLive").checked;
    if (fastMode) pumpAi(); else stopAi();
    renderAction();
    updateAiBar();
  };
  $("btnNextAi").onclick = () => stepAiOnce();
  renderSeats();
  $("btnStart").onclick = startGame;
  $("btnNew").onclick = () => { $("setup").classList.remove("hidden"); $("game").classList.add("hidden"); stopAi(); };
  $("btnAgain").onclick = () => { $("gameover").classList.add("hidden"); $("setup").classList.remove("hidden"); $("game").classList.add("hidden"); };
  $("btnPrices").onclick = () => showModal(priceTableHTML());
  $("btnHelp").onclick = () => showModal(helpHTML());
  $("modalClose").onclick = () => $("modal").classList.add("hidden");
}

function startGame() {
  const names = seats.map((s, i) => s.elName.value.trim() || (i === 0 ? "You" : `AI-${i + 1}`));
  const diffs = seats.map((s) => s.elDiff.value);
  const humans = diffs.map((d) => d === "human");
  state = createGame({ names, humans });
  state._diffs = diffs;
  fastMode = $("fastMode").checked; // off by default
  $("fastModeLive").checked = fastMode;
  $("setup").classList.add("hidden");
  $("game").classList.remove("hidden");
  $("gameover").classList.add("hidden");
  render();
  pumpAi();
}

function stopAi() { if (aiTimer) clearTimeout(aiTimer); aiTimer = null; }

function currentDiff() {
  const cur = state.turn.current;
  return state._diffs[cur] || "medium";
}
function isAiTurn() {
  if (!state || state.over) return false;
  return !state.players[state.turn.current].isHuman;
}

function pumpAi() {
  stopAi();
  updateAiBar();
  if (!state || state.over) return;
  if (!isAiTurn()) return;
  if (!fastMode) return; // step mode: wait for manual "Next AI step"
  aiTimer = setTimeout(stepAiOnce, aiDelay());
}

// Advance exactly one AI decision (used by fast-mode timer and manual stepping).
function stepAiOnce() {
  stopAi();
  if (!state || state.over || !isAiTurn()) return;
  const diff = currentDiff();
  const mv = getAiMove(state, diff);
  const r = apply(state, mv);
  if (!r.ok) {
    // fallback: first legal
    const legals = getLegalActions(state);
    if (legals.length) { const r2 = apply(state, legals[0]); if (r2.ok) state = withDiffs(r2.state); }
  } else {
    state = withDiffs(r.state);
  }
  render();
  if (state.over) return showGameOver();
  pumpAi(); // in fast mode chains; in step mode just refreshes the Next button
}

function updateAiBar() {
  const bar = $("aiBar");
  if (!bar) return;
  if (!state || state.over) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  const live = $("fastModeLive");
  if (live && live.checked !== fastMode) live.checked = fastMode;
  const btn = $("btnNextAi");
  if (btn) btn.style.display = isAiTurn() && !fastMode ? "" : "none";
}

function withDiffs(s) { s._diffs = state._diffs; return s; }

// ---------- rendering ----------
function render() {
  renderBoard();
  renderRack();
  renderPlayers();
  renderAction();
  renderLog();
  renderBanner();
  updateAiBar();
}

function renderBanner() {
  const b = $("turnBanner");
  if (state.over) { b.textContent = `Game over — ${state.players[state.result.winner].name} wins!`; return; }
  const p = state.players[state.turn.current];
  const phase = state.turn.phase;
  const whose = state.players[state.turn.whose].name;
  b.textContent = `${p.name} to act (${p.isHuman ? "you" : "AI " + currentDiff()} · phase: ${phase}) — turn of ${whose}. Bag: ${state.bag.length}`;
}

function renderBoard() {
  const el = $("board");
  el.innerHTML = "";
  for (let i = 0; i < ROWS * COLS; i++) {
    const d = document.createElement("div");
    const cell = state.board[i];
    d.className = "cell " + (cell.t === "empty" ? "empty" : cell.t === "orphan" ? "orphan" : "");
    d.dataset.cell = i;
    d.title = tileLabel(i);
    if (cell.t === "corp") {
      const c = CORPORATIONS[cell.c];
      d.style.background = c.color;
      d.style.color = c.textOn;
      d.textContent = c.short;
    } else if (cell.t === "orphan") {
      d.textContent = "•";
    } else {
      d.textContent = "";
    }
    el.append(d);
  }
  $("legend").innerHTML = CORPORATIONS.map((c) => {
    const sz = state.chains[c.id];
    return `<span class="pill" style="background:${c.color};color:${c.textOn}">${c.name} ${sz == null ? "—" : sz + " · $" + corpPrice(c.id, sz)}</span>`;
  }).join("");
}

function renderRack() {
  const me = state.players.find((p) => p.isHuman) ?? state.players[0];
  const isMyDecision = state.turn.current === me.id && me.isHuman && (state.turn.phase === "place");
  $("rackWho").textContent = `(${me.name})`;
  const rack = $("rack");
  rack.innerHTML = "";
  const hint = $("rackHint");
  const tiles = [...me.tiles].sort((a, b) => a - b);
  for (const t of tiles) {
    const chk = canPlaceTile(state, me.id, t);
    const allowed = isMyDecision && chk.ok;
    const d = document.createElement("button");
    d.className = "tile " + (chk.ok ? "playable" : "unplayable");
    d.textContent = tileLabel(t);
    d.title = chk.ok ? `Place → ${chk.kind}` : `Unplayable (${chk.reason})`;
    const highlight = (on) => {
      const cell = document.querySelector(`#board [data-cell="${t}"]`);
      if (cell) cell.classList.toggle("highlight", on);
    };
    d.onmouseenter = () => highlight(true);
    d.onmouseleave = () => highlight(false);
    d.onfocus = () => highlight(true);
    d.onblur = () => highlight(false);
    d.onclick = () => {
      if (!allowed) return;
      const r = apply(state, { type: "place", player: me.id, tile: t });
      if (r.ok) { state = withDiffs(r.state); render(); pumpAi(); }
    };
    rack.append(d);
  }
  hint.textContent = isMyDecision
    ? "Click a highlighted tile to place it. Grey tiles are permanently/illegally unplayable right now."
    : `Waiting… (${state.turn.phase}). Your tiles shown for planning; you act on your turn.`;
}

function renderPlayers() {
  const el = $("players");
  const head = CORPORATIONS.map((c) => `<span class="pill shr" style="background:${c.color};color:${c.textOn}">${c.short}</span>`).join("");
  el.innerHTML = `<table class="scores"><tr><th>P</th><th>Cash</th><th>Net*</th><th>T</th><th>Shares<br/>${head}</th></tr>` +
    state.players.map((p) => {
      const nw = netWorth(state, p.id);
      const turn = p.id === state.turn.whose ? "▶" : "";
      const shr = p.shares.map((n, i) => {
        const c = CORPORATIONS[i];
        return n > 0
          ? `<span class="pill shr" style="background:${c.color};color:${c.textOn}">${n}</span>`
          : `<span class="pill shr zero">0</span>`;
      }).join("");
      return `<tr><td>${turn}${escapeHtml(p.name)}${p.isHuman ? " (you)" : ""}</td><td>$${p.cash}</td><td>$${nw}</td><td>${p.tiles.length}</td><td>${shr}</td></tr>`;
    }).join("") + `</table><p class="hint">*Net = cash + shares at current prices. Share counts follow header order.</p>`;
}

function renderLog() {
  const el = $("log");
  el.innerHTML = state.log.slice(-60).reverse().map((e) => `<div>${colorize(escapeHtml(e.msg))}</div>`).join("");
}

function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// Colored corp pill + auto-colorizer for log/action text (applied AFTER escaping).
function pill(c) { return `<span class="pill" style="background:${c.color};color:${c.textOn}">${c.name}</span>`; }
const CORP_NAME_RE = new RegExp(`\\b(${CORPORATIONS.map((c) => c.name).sort((a, b) => b.length - a.length).join("|")})\\b`, "g");
function colorize(escapedHtml) {
  return escapedHtml.replace(CORP_NAME_RE, (m) => {
    const c = CORPORATIONS.find((x) => x.name === m);
    return `<span class="pill" style="background:${c.color};color:${c.textOn}">${m}</span>`;
  });
}

function describeAiDecision() {
  const t = state.turn;
  const p = state.players[t.current];
  switch (t.phase) {
    case "place": {
      const n = playableTiles(state, t.current).length;
      return n === 0 ? `${p.name} has no playable tile — will skip to buying.` : `${p.name} will place a tile.`;
    }
    case "found":
      return `${p.name} will found a corporation (free share included).`;
    case "survivor": {
      const tied = t.merger.tied.map((c) => `${CORPORATIONS[c].name} (${state.chains[c]})`).join(" vs ");
      return `${p.name} will choose the merger survivor: ${tied}.`;
    }
    case "merge": {
      const m = t.merger;
      const hold = state.players[t.current].shares[m.prey];
      return `${p.name} splits ${hold} × ${CORPORATIONS[m.prey].name} (keep/sell/trade → ${CORPORATIONS[m.survivor].name}).`;
    }
    case "buy":
      return `${p.name} will buy shares (up to 3, cash $${state.players[t.current].cash}).`;
    case "end":
      return canEndGame(state.chains) ? `${p.name} may END THE GAME on this turn.` : `${p.name} will end the turn and draw back to 6 tiles.`;
    default:
      return `${p.name} is deciding (${t.phase}).`;
  }
}

function renderAction() {
  const el = $("action");
  if (state.over) { el.innerHTML = `<h3>Game over</h3><p>${escapeHtml(state.log.at(-1)?.msg ?? "")}</p>`; return; }
  const me = state.turn.current;
  const p = state.players[me];
  if (!p.isHuman) {
    el.innerHTML = `<h3>${escapeHtml(p.name)} (${currentDiff()}) to act</h3>
      <p class="hint">${colorize(escapeHtml(describeAiDecision()))}</p>` +
      (fastMode ? `<p class="hint">Fast mode on — playing automatically.</p>`
                : `<button id="btnNextAi2">Next AI step ▶</button>`);
    const nb = $("btnNextAi2");
    if (nb) nb.onclick = () => stepAiOnce();
    return;
  }
  const phase = state.turn.phase;
  if (phase === "place") {
    const n = playableTiles(state, me).length;
    el.innerHTML = `<h3>Place a tile</h3><p class="hint">${n === 0 ? "No playable tiles — continuing to buy phase." : "Choose a highlighted tile on the left."}</p>` +
      (n === 0 ? `<button id="aSkip">Continue</button>` : "");
    const b = $("aSkip");
    if (b) b.onclick = () => doHuman({ type: "skipPlace", player: me });
    return;
  }
  if (phase === "found") {
    el.innerHTML = `<h3>Found a corporation</h3><p class="hint">You connected unincorporated tiles. Pick an inactive corp — you get 1 free share if available.</p>` +
      CORPORATIONS.filter((c) => state.chains[c.id] == null).map((c) =>
        `<div class="buyrow"><span class="pill" style="background:${c.color};color:${c.textOn}">${c.name}${c.oldName !== c.name ? ` (was ${c.oldName})` : ""}</span><button data-corp="${c.id}">Found ${c.name}</button></div>`).join("");
    el.querySelectorAll("[data-corp]").forEach((btn) => (btn.onclick = () => doHuman({ type: "found", player: me, corp: +btn.dataset.corp })));
    return;
  }
  if (phase === "survivor") {
    const tied = state.turn.merger.tied;
    el.innerHTML = `<h3>Merger — choose survivor</h3><p class="hint">Tied largest chains; mergermaker decides which survives.</p>` +
      tied.map((c) => `<div class="buyrow"><span>${pill(CORPORATIONS[c])} (${state.chains[c]})</span><button data-c="${c}">Survives</button></div>`).join("");
    el.querySelectorAll("[data-c]").forEach((btn) => (btn.onclick = () => doHuman({ type: "chooseSurvivor", player: me, survivor: +btn.dataset.c })));
    return;
  }
  if (phase === "merge") {
    renderMergeDecision(el, me);
    return;
  }
  if (phase === "buy") {
    renderBuy(el, me);
    return;
  }
  if (phase === "end") {
    const canEnd = canEndGame(state.chains);
    el.innerHTML = `<h3>End turn</h3><p class="hint">${canEnd ? "You may END THE GAME now (38+… classic: 41+ or all safe)." : "End your turn to draw back to 6 tiles."}</p>
      <div class="row"><button id="aEnd">End turn</button>${canEnd ? `<button id="aEndGame">End GAME</button>` : ""}</div>`;
    $("aEnd").onclick = () => doHuman({ type: "endTurn", player: me, endGame: false });
    const g = $("aEndGame");
    if (g) g.onclick = () => doHuman({ type: "endTurn", player: me, endGame: true });
    return;
  }
}

function renderMergeDecision(el, me) {
  const m = state.turn.merger;
  const prey = CORPORATIONS[m.prey], surv = CORPORATIONS[m.survivor];
  const hold = state.players[me].shares[m.prey];
  const price = corpPrice(m.prey, m.preySize);
  const b = corpBonuses(m.prey, m.preySize);
  el.innerHTML = `<h3>Merger: ${pill(prey)} → ${pill(surv)}</h3>
    <div class="mergebox">You hold <b>${hold}</b> × ${pill(prey)} (defunct size ${m.preySize}, sell $${price}/share). Survivor bank has ${state.bankShares[m.survivor]} × ${pill(surv)}.<br/>Bonuses already paid. Now split YOUR ${hold} shares into keep/sell/trade (2 ${pill(prey)} = 1 ${pill(surv)}).</div>
    <label>Sell <input id="mSell" type="number" min="0" max="${hold}" value="${Math.min(hold, 2)}" /></label>
    <label>Trade (even) <input id="mTrade" type="number" min="0" max="${hold}" step="2" value="0" /></label>
    <p class="hint">Keep = <span id="mKeep">${hold}</span>. Trade limited by survivor bank (${state.bankShares[m.survivor]} available → max ${Math.min(hold - (hold % 2), state.bankShares[m.survivor] * 2)} trade).</p>
    <button id="mOk">Confirm (keep/sell/trade)</button>`;
  const upd = () => {
    const sell = Math.max(0, Math.min(hold, +$("mSell").value || 0));
    let trade = Math.max(0, Math.min(hold - sell, +$("mTrade").value || 0));
    trade -= trade % 2;
    $("mTrade").value = trade;
    $("mKeep").textContent = hold - sell - trade;
  };
  $("mSell").oninput = upd; $("mTrade").oninput = upd; upd();
  $("mOk").onclick = () => {
    const sell = +$("mSell").value || 0;
    const trade = +$("mTrade").value || 0;
    const keep = hold - sell - trade;
    doHuman({ type: "mergeDecision", player: me, prey: m.prey, survivor: m.survivor, keep, sell, trade });
  };
}

function renderBuy(el, me) {
  const p = state.players[me];
  const active = CORPORATIONS.filter((c) => state.chains[c.id] != null);
  const counts = Object.fromEntries(active.map((c) => [c.id, 0]));
  const costOf = () => Object.entries(counts).reduce((a, [id, n]) => a + n * corpPrice(+id, state.chains[+id]), 0);
  const totalOf = () => Object.values(counts).reduce((a, b) => a + b, 0);
  el.innerHTML = `<h3>Buy shares (up to 3)</h3><p class="hint">Cash $${p.cash}. Prices at current sizes.</p>` +
    (active.length === 0 ? `<p class="hint">No active corporations.</p>` : "") +
    active.map((c) => {
      const price = corpPrice(c.id, state.chains[c.id]);
      return `<div class="buyrow"><span class="pill" style="background:${c.color};color:${c.textOn}">${c.name}</span><span>${state.chains[c.id]} tiles · $${price} · bank ${state.bankShares[c.id]} · you ${p.shares[c.id]}</span>
      <span class="stepper"><button data-a="-" data-c="${c.id}">−</button><b id="n${c.id}">0</b><button data-a="+" data-c="${c.id}">+</button></span></div>`;
    }).join("") +
    `<p>Selected: <b id="bTot">0</b> shares · Cost <b id="bCost">$0</b></p><div class="row"><button id="bOk">Confirm purchase</button><button id="bSkip" class="ghost">Buy none</button></div>`;
  const refresh = () => {
    for (const c of active) $("n" + c.id).textContent = counts[c.id];
    $("bTot").textContent = totalOf();
    $("bCost").textContent = "$" + costOf();
  };
  el.querySelectorAll(".stepper button").forEach((btn) => (btn.onclick = () => {
    const c = +btn.dataset.c;
    const d = btn.dataset.a === "+" ? 1 : -1;
    const nu = counts[c] + d;
    if (nu < 0) return;
    counts[c] = nu;
    if (totalOf() > 3 || costOf() > p.cash || counts[c] > state.bankShares[c]) counts[c] -= d;
    refresh();
  }));
  refresh();
  $("bOk").onclick = () => {
    const buys = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
    doHuman({ type: "buy", player: me, buys });
  };
  $("bSkip").onclick = () => doHuman({ type: "buy", player: me, buys: {} });
}

function doHuman(action) {
  const r = apply(state, action);
  if (!r.ok) { alert("Illegal move: " + r.error); return; }
  state = withDiffs(r.state);
  render();
  if (state.over) return showGameOver();
  pumpAi();
}

function showGameOver() {
  const t = state.result.totals;
  $("finalTable").innerHTML = `<table class="scores"><tr><th>Player</th><th>Cash</th><th>Shares</th><th>Total</th></tr>` +
    t.map((r) => `<tr><td>${escapeHtml(r.name)}${r.id === t[0].id ? " 🏆" : ""}</td><td>$${r.cash}</td><td>$${r.shareValue}</td><td><b>$${r.total}</b></td></tr>`).join("") + `</table>`;
  $("gameover").classList.remove("hidden");
}

function priceTableHTML() {
  const rows = [[2, 2], [3, 3], [4, 4], [5, 5], ["6–7", 6], ["8–17", 8], ["18–27", 18], ["28–37", 28], ["38–40", 38], ["41+", 41]];
  const lvl = (s) => (s <= 5 ? s : s >= 41 ? 10 : Math.floor((s - 1) / 10) + 6);
  return `<h3>Classic price table (tournament)</h3><table class="scores"><tr><th>Size</th><th>Tower/Sackson $200</th><th>American/Worldwide/Festival $300</th><th>Imperial/Continental $400</th><th>Majority / Minority</th></tr>` +
    rows.map(([lab, s]) => {
      const l = lvl(s);
      const p = (b) => b + 100 * (l - 2);
      return `<tr><td>${lab}</td><td>$${p(200)}</td><td>$${p(300)}</td><td>$${p(400)}</td><td>$${p(200) * 10}/$${p(200) * 5} … $${p(400) * 10}/$${p(400) * 5}</td></tr>`;
    }).join("") + `</table><p class="hint">Safe at 11+. Bonuses = 10×/5× current price. Tie majority splits majority+minority; tie minority splits minority. Sole holder gets both.</p>`;
}

function helpHTML() {
  return `<h3>How Acquire works (60-second version)</h3>
  <p><b>Goal:</b> richest at game end. <b>Turn:</b> 1) place a tile, 2) buy ≤3 shares, 3) draw back to 6.</p>
  <ul>
  <li><b>Found:</b> tile touches lone tile(s) → pick an inactive corp, get 1 free share.</li>
  <li><b>Grow:</b> tile touches one corp → it absorbs tile + connected lone tiles.</li>
  <li><b>Merge:</b> tile touches 2+ corps → biggest survives (ties: mergermaker picks). Smaller pays <b>majority/minority</b> bonuses, then each holder keep/sell/trade (2-for-1 into survivor).</li>
  <li><b>Safe:</b> 11+ tiles can't be eaten; two safes can't merge (tile is dead/discarded).</li>
  <li><b>End:</b> on your turn if a chain is 41+ or all active chains are safe. Bonuses for all actives, liquidate shares, richest wins.</li>
  </ul><p class="hint">Practice tips: fight for majorities in small chains near each other; don't run out of cash; trade into survivors that will go safe; time the game end when you're ahead.</p>`;
}

function showModal(html) { $("modalContent").innerHTML = html; $("modal").classList.remove("hidden"); }

initSetup();
