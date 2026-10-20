// In-memory stand-in for the parts of a Socket.IO server that GameManager uses:
// io.to(room).emit, io.sockets.adapter.rooms (room -> Set of socket ids) and io.sockets.sockets.
// Every event a socket would receive (direct emits and room broadcasts) lands in socket.received.
export function createFakeIo() {
  const rooms = new Map();
  const sockets = new Map();
  const emitted = []; // every io.to(room).emit as { room, event, payload }

  const io = {
    sockets: { adapter: { rooms }, sockets },
    emitted,

    to(room) {
      return {
        emit(event, payload) {
          emitted.push({ room, event, payload });
          for (const id of rooms.get(room) ?? []) {
            sockets.get(id)?.received.push({ event, payload });
          }
        },
      };
    },

    // Payloads broadcast to `room` for `event`, in order
    sent(room, event) {
      return emitted.filter((e) => e.room === room && e.event === event).map((e) => e.payload);
    },

    createSocket(id) {
      const socket = {
        id,
        data: {},
        received: [],
        join(roomOrRooms) {
          for (const room of [].concat(roomOrRooms)) {
            if (!rooms.has(room)) rooms.set(room, new Set());
            rooms.get(room).add(id);
          }
        },
        leave(room) {
          const members = rooms.get(room);
          if (!members) return;
          members.delete(id);
          if (members.size === 0) rooms.delete(room); // the real adapter drops empty rooms too
        },
        emit(event, payload) {
          socket.received.push({ event, payload });
        },
        // What Socket.IO does before firing 'disconnect': leave every room and forget the socket
        drop() {
          for (const room of [...rooms.keys()]) socket.leave(room);
          sockets.delete(id);
        },
        events(event) {
          return socket.received.filter((e) => e.event === event).map((e) => e.payload);
        },
      };
      sockets.set(id, socket);
      return socket;
    },
  };
  return io;
}
