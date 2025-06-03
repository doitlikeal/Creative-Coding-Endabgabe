let socket;
let currentRoom = null;

function connectToRoom(room) {
  if (socket) {
    socket.close();
  }

  socket = new WebSocket('ws://localhost:8080');

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'join', room }));
    currentRoom = room;
    console.log(`Connected to room: ${room}`);
  });

  socket.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'jam') {
      // Incoming jam data from other clients
      handleIncomingJam(msg.data);
    }
  });
}

// Broadcast your action to the room
function broadcastJam(data) {
  if (socket && socket.readyState === WebSocket.OPEN && currentRoom) {
    socket.send(JSON.stringify({ type: 'jam', room: currentRoom, data }));
  }
}

// Handle incoming jam data (other clients’ actions)
function handleIncomingJam(data) {
  // For example: data = { group: 'drums', index: 0, action: 'start'/'stop' }

  const { group, index, action } = data;

  if (!players[group] || !players[group][index]) return;

  if (action === 'start') {
    if (!active[group][index]) {
      active[group][index] = true;
      players[group][index].sync().start(0);
      // Update UI:
      document.querySelector(`.box[data-group="${group}"][data-index="${index}"]`).classList.add('active');
    }
  } else if (action === 'stop') {
    if (active[group][index]) {
      active[group][index] = false;
      players[group][index].unsync().stop(Tone.now());
      // Update UI:
      document.querySelector(`.box[data-group="${group}"][data-index="${index}"]`).classList.remove('active');
    }
  }
}

Tone.Transport.bpm.value = 150;

const ctx = Tone.getContext().rawContext;

// --- Effects Setup ---

// EQ3 setup
const eq3 = new Tone.EQ3({ low: 0, mid: 0, high: 0 });

// Panner node
const panner = new Tone.Panner(0); // centered initially

// Main compressor and gain (native Web Audio nodes)
const compressor = ctx.createDynamicsCompressor();
const gainNode = ctx.createGain();
gainNode.gain.value = 1;

// Reverb (ToneJS)
const reverb = new Tone.Reverb({ decay: 3, wet: 0.2 });

// Delay (ToneJS)
const delay = new Tone.FeedbackDelay("8n", 0.1);

// Routing: delay -> panner -> eq3 -> reverb -> compressor -> gainNode -> analyser -> destination
delay.disconnect();
delay.connect(panner);
panner.connect(eq3);
eq3.connect(reverb);
reverb.connect(compressor);
compressor.connect(gainNode);

// --- Setup analyser ---
const analyser = ctx.createAnalyser();
analyser.fftSize = 256;
const bufferLength = analyser.frequencyBinCount;
const dataArray = new Uint8Array(bufferLength);

// Connect gainNode to analyser, analyser to destination
gainNode.disconnect();
gainNode.connect(analyser);
analyser.connect(ctx.destination);

// --- Sample Groups ---

const groups = {
  drums: [
    "audio/drumloop1.wav",
    "audio/drumloop2.wav",
    "audio/drumloop3.wav",
    "audio/drumloop4.wav"
  ],
  bass: [
    "audio/bassloop1.wav",
    "audio/bassloop2.wav",
    "audio/bassloop3.wav",
    "audio/bassloop4.wav"
  ],
  pad: [
    "audio/padloop1.wav",
    "audio/padloop2.wav",
    "audio/padloop3.wav",
    "audio/padloop4.wav"
  ]
};

const players = {
  drums: [],
  bass: [],
  pad: []
};

const active = {
  drums: [false, false, false, false],
  bass: [false, false, false, false],
  pad: [false, false, false, false]
};

let transportStarted = false;
let eqEnabled = true; // start with EQ on

// Load samples into Tone.Player and connect to delay (start of chain)
function loadAllPlayers() {
  for (let group in groups) {
    players[group] = groups[group].map(url =>
      new Tone.Player({ url, loop: true, autostart: false }).connect(delay)
    );
  }
}

// Toggle EQ routing
function toggleEQ() {
  delay.disconnect();
  panner.disconnect();

  if (eqEnabled) {
    // Bypass EQ: delay -> panner -> reverb
    delay.connect(panner);
    panner.connect(reverb);
  } else {
    // Use EQ: delay -> panner -> eq3 -> reverb
    delay.connect(panner);
    panner.connect(eq3);
    eq3.connect(reverb);
  }
  eqEnabled = !eqEnabled;
}

// --- UI Setup ---

document.addEventListener("DOMContentLoaded", () => {
  loadAllPlayers();

  // Loop buttons toggle playback
  document.querySelectorAll(".box").forEach(box => {
    const group = box.dataset.group;
    const index = parseInt(box.dataset.index);

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
    broadcastJam({ group, index, action: 'start' });
  } else {
    player.unsync().stop(Tone.now());
    broadcastJam({ group, index, action: 'stop' });
  }
});
  });

let lastGain = gainNode.gain.value; // remember last gain before mute

const muteBtn = document.getElementById('muteBtn');
let isMuted = false;

muteBtn.addEventListener('click', () => {
  isMuted = !isMuted;
  gainNode.gain.value = isMuted ? 0 : parseFloat(document.getElementById('volumeSlider').value);
  
  muteBtn.classList.toggle('muted', isMuted);
  muteBtn.textContent = isMuted ? 'Muted' : 'Mute';
});

  // FX Controls
  document.getElementById("reverbSlider").addEventListener("input", e => {
    reverb.wet.value = parseFloat(e.target.value);
  });

  document.getElementById("delaySlider").addEventListener("input", e => {
    delay.delayTime.value = parseFloat(e.target.value);
  });

  document.getElementById("volumeSlider").addEventListener("input", e => {
    gainNode.gain.value = parseFloat(e.target.value);
  });

  // EQ Controls
  document.getElementById("lowEQ").addEventListener("input", e => {
    eq3.low.value = parseFloat(e.target.value);
  });

  document.getElementById("midEQ").addEventListener("input", e => {
    eq3.mid.value = parseFloat(e.target.value);
  });

  document.getElementById("highEQ").addEventListener("input", e => {
    eq3.high.value = parseFloat(e.target.value);
  });

  // Pan Control
  document.getElementById("panSlider").addEventListener("input", e => {
    panner.pan.value = parseFloat(e.target.value);
  });

  // EQ toggle button
  const eqToggleBtn = document.getElementById("toggleEQ");
  eqToggleBtn.addEventListener("click", () => {
    toggleEQ();
    eqToggleBtn.textContent = eqEnabled ? "On" : "Off";
  });

  // Initialize button text
  eqToggleBtn.textContent = "On";
});


// --- Spectrum Visualizer Setup ---

const canvas = document.getElementById('spectrum');
const canvasCtx = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

function draw() {
  requestAnimationFrame(draw);

  analyser.getByteFrequencyData(dataArray);

  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);

  const barWidth = (canvas.width / bufferLength) * 2.5;
  let barHeight;
  let x = 0;

  for(let i = 0; i < bufferLength; i++) {
    barHeight = dataArray[i];

    canvasCtx.fillStyle = `rgb(${barHeight + 100},50,${255 - barHeight})`;
    canvasCtx.fillRect(x, canvas.height - barHeight / 2, barWidth, barHeight / 2);

    x += barWidth + 1;
  }
}

draw();

document.getElementById('oneShotsBtn').addEventListener('click', () => {
  window.location.href = 'index.html';  // change to your actual file name
});
