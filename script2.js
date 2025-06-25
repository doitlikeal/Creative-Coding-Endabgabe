// -------------------------------
// Unique Client ID, Cursor Setup, Nicknames
// -------------------------------
let clientId = null;
const cursors = {}; // clientId → DOM element
const nicknames = {}; // clientId → nickname
let clientCount = 1;

const NICKNAME_POOL = [
  'JazzBear', 'LoopZilla', 'BassDuck', 'SynthKitty', 'FunkyFrog',
  'EchoFox', 'DrumBug', 'GrooveBot', 'BoomBoi', 'WubWizard'
];

function getRandomNickname() {
  return NICKNAME_POOL[Math.floor(Math.random() * NICKNAME_POOL.length)];
}

const link = document.createElement('link');
link.rel = 'stylesheet';
link.href = 'style.css';
document.head.appendChild(link);

const clientCountDisplay = document.createElement('div');
clientCountDisplay.id = 'client-count-display';
clientCountDisplay.textContent = `Clients: ${clientCount}`;
document.body.appendChild(clientCountDisplay);

const systemMessage = document.createElement('div');
systemMessage.id = 'system-message';
document.body.appendChild(systemMessage);

const chatContainer = document.createElement('div');
chatContainer.id = 'chat-container';
document.body.appendChild(chatContainer);

function showSystemMessage(text) {
  const msg = document.createElement('div');
  msg.className = 'system-message';
  msg.textContent = text;
  document.body.appendChild(msg);

  setTimeout(() => {
    msg.style.opacity = '0';
    setTimeout(() => msg.remove(), 1000);
  }, 8000);
}

function updateClientCount(count) {
  clientCount = count;
  clientCountDisplay.textContent = `Clients: ${clientCount}`;
}

function appendChatMessage(sender, text) {
  const container = document.getElementById('chat-messages');
  const msg = document.createElement('div');
  msg.className = 'chat-message';
  msg.innerHTML = `<strong>${sender}:</strong> ${text}`;
  container.appendChild(msg);
  container.scrollTop = container.scrollHeight;
}

// -------------------------------
// Touch Circles Setup
// -------------------------------
const touches = new Map();
const circleRadius = 50;

class Touch {
  constructor(id, x, y, own = false) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.own = own;
  }
  move(x, y) {
    this.x = x;
    this.y = y;
  }
}

function createTouch(id, x, y, own = false) {
  touches.set(id, new Touch(id, x, y, own));
}
function moveTouch(id, x, y) {
  const touch = touches.get(id);
  if (touch) touch.move(x, y);
}
function deleteTouch(id) {
  touches.delete(id);
}

// -------------------------------
// WebSocket + Room Logic
// -------------------------------
let socket;
const currentRoom = 'loopy-loops';

function connectToRoom(room) {
  if (socket) socket.close();
  socket = new WebSocket('wss://nosch.uber.space/web-rooms/');

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify(["*enter-room*", room]));
    socket.send(JSON.stringify(["*subscribe-client-count*"]));
    console.log(`🔗 Connected to room: ${room}`);
  });

  socket.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (e) {
      return;
    }

    const selector = msg[0];

    switch (selector) {
      case '*client-id*': {
        clientId = String(msg[1]);
        const nickname = getRandomNickname();
        nicknames[clientId] = nickname;
        socket.send(JSON.stringify(['*broadcast-message*', ['nickname', clientId, nickname]]));
        break;
      }
      case '*client-count*':
        updateClientCount(msg[1]);
        break;
      case 'start':
        if (msg[1] !== clientId) createTouch(msg[1], msg[2], msg[3]);
        break;
      case 'move':
        if (msg[1] !== clientId) moveTouch(msg[1], msg[2], msg[3]);
        break;
      case 'end':
        deleteTouch(msg[1]);
        break;
      case 'nickname': {
        const id = msg[1];
        const name = msg[2];
        nicknames[id] = name;
        showSystemMessage(`${name} joined`);
        break;
      }
      case 'leave': {
        const id = msg[1];
        let name = nicknames[id];
        if (!name && id && typeof id === 'string') {
          name = `User-${id.slice(-4)}`;
        }
        showSystemMessage(`${name} left`);

        if (cursors[id]) {
          cursors[id].remove();
          delete cursors[id];
        }
        delete nicknames[id];
        break;
      }
      case 'chat': {
        const id = msg[1];
        const text = msg[2];

        if (!nicknames[id]) {
          nicknames[id] = getRandomNickname();
        }

        const name = nicknames[id];
        appendChatMessage(name, text);
        break;
      }
    }
  });

  setInterval(() => socket?.send(''), 30000);
}
connectToRoom(currentRoom);

window.addEventListener('beforeunload', () => {
  if (socket && socket.readyState === WebSocket.OPEN && clientId) {
    socket.send(JSON.stringify(['*broadcast-message*', ['leave', clientId]]));
  }
});

// -------------------------------
// Pointer Events (Touch + Mouse)
// -------------------------------
let pointerId = null;

document.body.addEventListener('pointerdown', e => {
  if (pointerId === null) {
    pointerId = e.pointerId;
    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;
    createTouch(clientId, x, y, true);
    socket.send(JSON.stringify(['*broadcast-message*', ['start', clientId, x, y]]));
  }
});

document.body.addEventListener('pointermove', e => {
  if (e.pointerId === pointerId) {
    const x = e.clientX / window.innerWidth;
    const y = e.clientY / window.innerHeight;
    moveTouch(clientId, x, y);
    socket.send(JSON.stringify(['*broadcast-message*', ['move', clientId, x, y]]));
  }
});

document.body.addEventListener('pointerup', e => {
  if (e.pointerId === pointerId) {
    deleteTouch(clientId);
    socket.send(JSON.stringify(['*broadcast-message*', ['end', clientId]]));
    pointerId = null;
  }
});

document.addEventListener('mousemove', e => {
  const x = e.clientX;
  const y = e.clientY;
  if (!clientId) return;
  handleIncomingPointer({ id: clientId, x, y });
});

function handleIncomingPointer({ id, x, y }) {
  if (id === clientId) return;
  let c = cursors[id];
  if (!c) {
    c = document.createElement('div');
    c.classList.add('remote-cursor');
    if (id === clientId) c.classList.add('own');
    const label = document.createElement('div');
    label.className = 'cursor-label';
    label.textContent = nicknames[id] || id;
    c.appendChild(label);
    document.body.appendChild(c);
    cursors[id] = c;
  } else {
    c.querySelector('.cursor-label').textContent = nicknames[id] || id;
  }
  c.style.left = x + 'px';
  c.style.top = y + 'px';
}

// -------------------------------
// Jam / Loop Logic (Tone.js)
// -------------------------------
function handleIncomingJam(data) {
  const { group, index, action } = data;
  if (!players[group] || !players[group][index]) return;
  if (action === 'start') {
    if (!active[group][index]) {
      active[group][index] = true;
      players[group][index].sync().start(0);
      document.querySelector(`.box[data-group="${group}"][data-index="${index}"]`).classList.add('active');
    }
  } else if (action === 'stop') {
    if (active[group][index]) {
      active[group][index] = false;
      players[group][index].unsync().stop(Tone.now());
      document.querySelector(`.box[data-group="${group}"][data-group="${group}"][data-index="${index}"]`).classList.remove('active');
    }
  }
}

function broadcastLoop(data) {
  broadcastJam({ ...data, event: 'loop' });
}

Tone.Transport.bpm.value = 150;
const ctx = Tone.getContext().rawContext;
const eq3 = new Tone.EQ3({ low: 0, mid: 0, high: 0 });
const panner = new Tone.Panner(0);
const compressor = ctx.createDynamicsCompressor();
const gainNode = ctx.createGain(); gainNode.gain.value = 1;
const reverb = new Tone.Reverb({ decay: 3, wet: 0.2 });
const delay = new Tone.FeedbackDelay("8n", 0.1);

delay.disconnect(); delay.connect(panner);
panner.connect(eq3); eq3.connect(reverb);
reverb.connect(compressor); compressor.connect(gainNode);

const analyser = ctx.createAnalyser();
analyser.fftSize = 256;
const bufferLength = analyser.frequencyBinCount;
const dataArray = new Uint8Array(bufferLength);
gainNode.disconnect(); gainNode.connect(analyser); analyser.connect(ctx.destination);

const groups = {
  drums: ["audio/drumloop1.wav", "audio/drumloop2.wav", "audio/drumloop3.wav", "audio/drumloop4.wav"],
  bass: ["audio/bassloop1.wav", "audio/bassloop2.wav", "audio/bassloop3.wav", "audio/bassloop4.wav"],
  pad: ["audio/padloop1.wav", "audio/padloop2.wav", "audio/padloop3.wav", "audio/padloop4.wav"]
};
const players = { drums: [], bass: [], pad: [] };
const active = { drums: [false, false, false, false], bass: [false, false, false, false], pad: [false, false, false, false] };

let transportStarted = false, eqEnabled = true;

function loadAllPlayers() {
  for (let g in groups) {
    players[g] = groups[g].map(url =>
      new Tone.Player({ url, loop: true, autostart: false }).connect(delay)
    );
  }
}

function toggleEQ() {
  delay.disconnect(); panner.disconnect();
  if (eqEnabled) {
    delay.connect(panner); panner.connect(reverb);
  } else {
    delay.connect(panner); panner.connect(eq3); eq3.connect(reverb);
  }
  eqEnabled = !eqEnabled;
}

// -------------------------------
// UI Setup & Event Listeners
// -------------------------------
document.addEventListener("DOMContentLoaded", () => {
  // Avoid duplicating chat container
  if (!document.getElementById('chat-container')) {
    const chatContainer = document.createElement('div');
    chatContainer.id = 'chat-container';
    chatContainer.innerHTML = `
      <div id="chat-toggle">Chat ⬇</div> <!-- Chat toggle button -->
      <div id="chat-panel" class="collapsed">
        <div id="chat-messages"></div>
        <input type="text" id="chat-input" placeholder="Type your message..." autocomplete="off">
      </div>
    `;
    document.body.appendChild(chatContainer);
  }

  // Add chat input event listener safely
  const chatInput = document.getElementById('chat-input');
  if (chatInput && !chatInput.dataset.bound) {
    chatInput.dataset.bound = 'true'; // prevent double-binding
    chatInput.addEventListener('keydown', e => {
      if (
        e.key === 'Enter' &&
        chatInput.value.trim() &&
        socket?.readyState === WebSocket.OPEN &&
        clientId
      ) {
        e.preventDefault();
        const text = chatInput.value.trim();
        const nickname = nicknames[clientId] || getRandomNickname(clientId);

        // ✅ Show own message immediately
        appendChatMessage(nickname, text);

        socket.send(JSON.stringify(['*broadcast-message*', ['chat', clientId, text]]));
        chatInput.value = '';
      }
    });
  }

  // Chat toggle functionality
  // 👇 Chat toggle
  const chatToggle = document.getElementById('chat-toggle');
  const chatPanel = document.getElementById('chat-panel');

  chatToggle.addEventListener('click', () => {
    playClickSound(); // 🔉 play click sound
    chatPanel.classList.toggle('collapsed');
    chatPanel.classList.toggle('open');
    chatToggle.textContent = chatPanel.classList.contains('collapsed') ? 'Chat ⬇' : 'Chat ⬆';
  });

  // Function to append chat messages
  function appendChatMessage(sender, text) {
    const container = document.getElementById('chat-messages');
    const msg = document.createElement('div');
    msg.className = 'chat-message';
    msg.innerHTML = `<strong>${sender}:</strong> ${text}`;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight; // Scroll to the bottom
  }

  // Load Tone.js players
  loadAllPlayers();

  document.querySelectorAll(".box").forEach(box => {
    const group = box.dataset.group;
    const index = parseInt(box.dataset.index, 10);
    box.addEventListener("click", async () => {
      if (!transportStarted) {
        await Tone.start();
        Tone.Transport.start();
        transportStarted = true;
      }
      active[group][index] = !active[group][index];
      box.classList.toggle("active", active[group][index]);
      const player = players[group][index];
      if (active[group][index]) {
        player.sync().start(0);
        broadcastLoop({ group, index, action: 'start' });
      } else {
        player.unsync().stop(Tone.now());
        broadcastLoop({ group, index, action: 'stop' });
      }
    });
  });

  // 🟡 Click Sound Player Setup
  const clickSound = new Tone.Player({
    url: "sounds/click.mp3",
    volume: -12  // softer
  }).toDestination();

  const muteSound = new Tone.Player({
    url: "sounds/mute.mp3",
    volume: -10
  }).toDestination();

  const teleportSound = new Tone.Player({
    url: "sounds/teleport.mp3",
    volume: -8
  }).toDestination();

  // 🟢 One-time Tone Context Init
  document.body.addEventListener('click', async () => {
    if (Tone.context.state !== 'running') {
      await Tone.start();
      console.log('✅ Tone.js AudioContext started');
    }
  }, { once: true });

  // 🔊 Click sound with pitch variation
  function playClickSound() {
    if (Tone.context.state === 'running') {
      clickSound.playbackRate = 1 + (Math.random() - 0.5) * 0.2;
      clickSound.start();
    }
  }

  const muteBtn = document.getElementById('muteBtn');
  const volumeSlider = document.getElementById('volumeSlider');
  const volumeValue = document.getElementById('volumeValue');
  let isMuted = false;

  // 🎚️ Dynamic Fill Function
  function updateVolumeSliderFill(slider) {
    const min = parseFloat(slider.min || 0);
    const max = parseFloat(slider.max || 1);
    const val = parseFloat(slider.value);
    const percent = ((val - min) / (max - min)) * 100;
    slider.style.background = `linear-gradient(90deg, #0ff ${percent}%, #111 ${percent}%)`;
  }

  // ✅ Single definition with dynamic fill
  function updateVolumeUI() {
    const val = parseFloat(volumeSlider.value);
    const percent = Math.round(val * 100);
    volumeValue.textContent = `Volume: ${percent}%`;

    if (!isMuted) {
      gainNode.gain.value = val;
    }

    updateVolumeSliderFill(volumeSlider);
  }

  volumeSlider.addEventListener('input', updateVolumeUI);
  updateVolumeUI(); // Initialize once

  muteBtn.addEventListener('click', () => {
    muteSound.start(); // 🔉 unique mute toggle sound
    isMuted = !isMuted;
    gainNode.gain.value = isMuted ? 0 : parseFloat(volumeSlider.value);
    muteBtn.classList.toggle('muted', isMuted);
    muteBtn.textContent = isMuted ? 'Muted' : 'Mute';
  });

  // Reverb, delay, EQ, pan controls
  document.getElementById("reverbSlider").addEventListener("input", e => {
    reverb.wet.value = parseFloat(e.target.value);
  });
  document.getElementById("delaySlider").addEventListener("input", e => {
    delay.delayTime.value = parseFloat(e.target.value);
  });
  document.getElementById("lowEQ").addEventListener("input", e => {
    eq3.low.value = parseFloat(e.target.value);
  });
  document.getElementById("midEQ").addEventListener("input", e => {
    eq3.mid.value = parseFloat(e.target.value);
  });
  document.getElementById("highEQ").addEventListener("input", e => {
    eq3.high.value = parseFloat(e.target.value);
  });
  document.getElementById("panSlider").addEventListener("input", e => {
    panner.pan.value = parseFloat(e.target.value);
  });

  // EQ toggle
  const eqToggleBtn = document.getElementById("toggleEQ");
  eqToggleBtn.addEventListener("click", () => {
    toggleEQ();
    eqToggleBtn.textContent = eqEnabled ? "On" : "Off";
  });
  eqToggleBtn.textContent = "On";


  // -------------------------------
  // Spectrum Visualizer + Touch Circles
  // -------------------------------
  const canvas = document.getElementById('spectrum');
  const canvasCtx = canvas.getContext('2d');
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight * 0.8;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  function drawTouchCircles(ctx, width, height) {
    for (let [, touch] of touches) {
      const x = width * touch.x;
      const y = height * touch.y;
      ctx.globalAlpha = touch.own ? 0.666 : 0.5;
      ctx.fillStyle = touch.own ? '#0ff' : '#fff';
      ctx.beginPath();
      ctx.arc(x, y, circleRadius, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  function draw() {
    requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    const barWidth = (canvas.width / bufferLength) * 2.5;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const barHeight = dataArray[i];
      canvasCtx.fillStyle = `rgb(${barHeight + 100},50,${255 - barHeight})`;
      canvasCtx.fillRect(x, canvas.height - barHeight / 2, barWidth, barHeight / 2);
      x += barWidth + 1;
    }
    drawTouchCircles(canvasCtx, canvas.width, canvas.height);
  }
  draw();

  // -------------------------------
  // Navigation Button
  // -------------------------------
  document.getElementById('oneShotsBtn').addEventListener('click', async () => {
    await Tone.start(); // Ensure audio context is resumed
    teleportSound.start();

    // Wait briefly to let the teleport sound play before redirecting
    setTimeout(() => {
      window.location.href = 'index.html';
    }, 700); // Adjust delay to match sound length if needed
  });
});
