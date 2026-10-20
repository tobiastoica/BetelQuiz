import { io } from 'socket.io-client';

export type SocketSession =
  | { role: 'player'; userUuid: string; pin?: string }
  | { role: 'host'; pin: string; hostSecret: string };

let session: SocketSession | null = null;

// One connection per tab. The server binds it to `session` during the handshake, and the same auth is
// sent on every automatic reconnect, so the server re-attaches the socket and replays the current game
// state before it processes anything the page emitted while offline.
export const socket = io(window.location.origin, {
  autoConnect: false,
  // WebSocket first; long-polling when a network or proxy blocks WebSockets
  transports: ['websocket', 'polling'],
  tryAllTransports: true,
  reconnectionDelay: 1000,
  auth: (cb) => cb(session ?? {}),
});

// Starts a fresh connection with the page's identity. Returns the effect cleanup.
export function openSession(next: SocketSession): () => void {
  session = next;
  socket.disconnect().connect();
  return () => {
    session = null;
    socket.disconnect();
  };
}

// The game a player reconnects into (set after joining, cleared after leaving).
export function setPlayerPin(pin: string | undefined): void {
  if (session?.role === 'player') {
    session = { ...session, pin };
  }
}
