# Future multiplayer — planned protocol (stub)

The engine is already pure + serializable so a server only needs to relay
validated actions. Suggested minimal design:

## Messages (JSON over WebSocket)

Client → Server:
- `{t:"join", room, name}` → `{t:"joined", playerId, state}`
- `{t:"action", room, action}` where action is one engine action:
  - `{type:"place", player, tile}`
  - `{type:"found", player, corp}`
  - `{type:"chooseSurvivor", player, survivor}`
  - `{type:"mergeDecision", player, prey, survivor, keep, sell, trade}`
  - `{type:"buy", player, buys:{corpId:count}}`
  - `{type:"endTurn", player, endGame}`
- `{t:"state", room}` → full state (server) / public view (others)

Server → Clients (broadcast):
- `{t:"update", room, state: publicView(full, viewerId), legal: getLegalActionsFor(viewer)}`
- `{t:"error", message}` on invalid action (engine returns `{ok:false, error}`)

## Server responsibilities

1. Own canonical `state` per room (`createGame` at lobby fill).
2. On action: `applyInPlace(state, action)`; reject if `!ok`.
3. Broadcast `publicView(state, eachViewer)` — never leak `tiles` of others.
4. Enforce turn: `action.player === state.turn.current` (except endTurn by whose).
5. Persist `serialize(state)` for reconnects.

See `lobby.js` for an in-memory room stub matching this API.
