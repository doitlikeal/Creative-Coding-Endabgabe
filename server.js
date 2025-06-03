const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const easyRTC = require('easyrtc'); // für Audio/Video falls benötigt

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const PORT = 3000;

// Statischer Pfad (für index.html, JS, Sounds etc.)
app.use(express.static('public'));

io.on('connection', (socket) => {
  console.log(`🔌 Client verbunden: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`❌ Client getrennt: ${socket.id}`);
  });
});

// Für Netzwerk-Kommunikation mit networked-aframe
const naffAdapter = require('networked-aframe-server')(io);

server.listen(PORT, () => {
  console.log(`🌐 Server läuft auf http://localhost:${PORT}`);
});
