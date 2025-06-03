const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });

const rooms = {}; // { roomName: Set of clients }

wss.on('connection', (ws) => {
  ws.room = null;

  ws.on('message', (message) => {
    // Expect messages as JSON: { type, room, data }
    try {
      const msg = JSON.parse(message);

      if (msg.type === 'join') {
        // Join a room
        if (ws.room) {
          // Leave previous room
          rooms[ws.room].delete(ws);
          if (rooms[ws.room].size === 0) {
            delete rooms[ws.room];
          }
        }

        ws.room = msg.room;
        if (!rooms[ws.room]) {
          rooms[ws.room] = new Set();
        }
        rooms[ws.room].add(ws);

        console.log(`Client joined room: ${ws.room}`);

      } else if (msg.type === 'jam') {
        // Broadcast to others in the same room
        if (!ws.room) return;

        rooms[ws.room].forEach(client => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'jam', data: msg.data }));
          }
        });
      }
    } catch (e) {
      console.error('Invalid message:', e);
    }
  });

  ws.on('close', () => {
    if (ws.room && rooms[ws.room]) {
      rooms[ws.room].delete(ws);
      if (rooms[ws.room].size === 0) {
        delete rooms[ws.room];
      }
    }
  });
});

console.log('WebSocket server running on ws://localhost:8080');
