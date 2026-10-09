import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGame, getLegalActions, apply, netWorth } from "../engine/game.js";
import { corpPrice, priceLevel, canEndGame } from "../engine/rules.js";
import { easyMove, mediumMove, hardMove } from "../ai/index.js";

describe("rules", () => {
  it("classic price levels", () => {
    assert.equal(priceLevel(2), 2);
    assert.equal(priceLevel(5), 5);
    assert.equal(priceLevel(6), 6);
    assert.equal(priceLevel(11), 7);
    assert.equal(priceLevel(41), 10);
    assert.equal(corpPrice(0, 2), 200); // Tower base 200
    assert.equal(corpPrice(5, 2), 400); // Imperial base 400
  });
  it("end conditions classic", () => {
    assert.equal(canEndGame([41, null, null, null, null, null, null]), true);
    assert.equal(canEndGame([11, 12, null, null, null, null, null]), true);
    assert.equal(canEndGame([11, 5, null, null, null, null, null]), false);
  });
});

describe("engine", () => {
  it("creates 3-6 player games with racks and opening tiles", () => {
    const s = createGame({ names: ["A", "B", "C", "D"], humans: [true, false, false, false], seed: 42 });
    assert.equal(s.players.length, 4);
    for (const p of s.players) assert.equal(p.tiles.length, 6);
    const orphans = s.board.filter((c) => c.t === "orphan").length;
    assert.equal(orphans, 4);
  });
  it("full random game terminates", () => {
    let s = createGame({ names: ["A", "B", "C"], humans: [false, false, false], seed: 7 });
    let guard = 0;
    while (!s.over && guard++ < 3000) {
      const acts = getLegalActions(s);
      assert.ok(acts.length > 0, `stuck at phase ${s.turn.phase}`);
      const a = acts[(Math.random() * acts.length) | 0];
      const r = apply(s, a);
      assert.ok(r.ok, JSON.stringify(a) + " " + r.error);
      s = r.state;
    }
    assert.ok(s.over, "game should end");
    assert.ok(s.result.totals.length === 3);
  });
  it("AI movers return legal actions", () => {
    const s = createGame({ names: ["H", "A", "B"], humans: [true, false, false], seed: 99 });
    assert.ok(getLegalActions(s).length > 0);
    const m = mediumMove(s);
    assert.ok(m && m.type);
    const h = hardMove(s, { timeBudgetMs: 150, simsPerMove: 10 });
    assert.ok(h && h.type);
    const e = easyMove(s);
    assert.ok(e && e.type);
  });
  it("net worth consistent", () => {
    const s = createGame({ names: ["A", "B", "C"], humans: [true, false, false], seed: 5 });
    assert.equal(netWorth(s, 0), 6000);
  });
});
