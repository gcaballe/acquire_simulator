# Acquire — Tournament Practice Simulator

Browser simulator for **Acquire** using **classic tournament rules**.

- Rules: board 9×12 (108 tiles), start $6,000, 6 tiles in hand, 25 shares/corp.
- Safe at **11+** tiles. Game ends at **41+** in one chain or all-active-safe.
- Bonuses classic: **majority 10×, minority 5×** current price. Tie-majority splits majority+minority; tie-minority splits minority; sole holder gets both.
- Corps (classic price tiers):
  - $200 tier: **Tower** (yellow), **Sackson** (red, replaces Luxor)
  - $300 tier: **American** (dark blue), **Worldwide** (purple), **Festival** (dark green)
  - $400 tier: **Imperial** (orange), **Continental** (light blue)
- Reference: rules cross-checked against Hasbro C0096 manual (2016) + `zou3519/acquire` Scala engine for turn/merge flow. 2016 box differs (safe 10, end 38, tertiary bonus) — this build intentionally uses **classic** mechanics per tournament choice; switch constants in `engine/rules.js` if needed.

## Run

No build step. Serve the folder and open `ui/index.html`:

```powershell
npx serve . -l 8080
# open http://localhost:8080/ui/
```

Or simply open `ui/index.html` directly (ES modules require http — use the serve command).

## Play

- 3–6 players, you + AI (Easy/Medium/Hard per seat).
- AI speed slider controls pacing. Medium = greedy 1-ply; Hard = determinized Monte Carlo (~0.9s/move).
- Price table + How-to-play buttons in header.

## Project layout (multiplayer-ready)

```
engine/  pure game logic, no DOM (future server can import as-is)
  corporations.js  corp ids/names/colors/tiers
  rules.js         pricing, bonuses, board geometry, end conditions
  game.js          createGame, getLegalActions, apply, determinize, publicView, serialize
ai/
  heuristic.js     fast evaluation
  index.js         easy/medium/hard dispatcher + Monte Carlo
ui/                rendering + human input (only layer that touches DOM)
server/            stub protocol + lobby for future online multiplayer
test/              node --test engine tests
```

Engine actions are JSON-serializable (see `server/README.md`):
`place / found / chooseSurvivor / mergeDecision / buy / endTurn`, plus `publicView(state, viewerId)` to hide racks.

## Tests

```powershell
npm test
```
