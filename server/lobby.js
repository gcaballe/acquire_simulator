// In-memory room stub — same API a future WebSocket server would wrap.
// No network here; lets UI or tests simulate 2 clients sharing one canonical state.
import { createGame, applyInPlace, publicView, getLegalActions } from "../engine/game.js";

export function createRoom({ room = "local", names, humans, seed }) {
  const full = createGame({ names, humans, seed });
  return { room, full };
}

export function dispatch(roomObj, action) {
  const r = applyInPlace(roomObj.full, action);
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, full: roomObj.full };
}

export function viewFor(roomObj, viewerId) {
  return {
    state: publicView(roomObj.full, viewerId),
    legal: viewerId === roomObj.full.turn.current ? getLegalActions(roomObj.full) : [],
  };
}
