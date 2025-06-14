// -------------------------------
// Unique Client ID & Cursor Setup
// -------------------------------
const clientId = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
const cursors = {}; // clientId → DOM element

// inject basic CSS for remote cursors
const style = document.createElement('style');
style.textContent = `
  .remote-cursor {
    position: absolute;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: rgba(255, 0, 0, 0.7);
    pointer-events: none;
    transform: translate(-50%, -50%);
    z-index: 9999;
  }
`;
document.head.appendChild(style);


// -------------------------------
// WebSocket + Room Logic
// -------------------------------
let socket;
let currentRoom = null;

function connectToRoom(room) {
  if (socket) socket.close();

  socket = new WebSocket('wss://nosch.uber.space/web-rooms/');

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ type: 'join', room }));
    currentRoom = room;
    console.log(`🔗 Connected to room: ${room}`);
  });

  socket.addEventListener('message', ({ data: raw }) => {
    let msg;
    try { msg = JSON.parse(raw); }
    catch (e) { return; }

    if (msg.type === 'jam') {
      const d = msg.data;
      if (d.event === 'pointer') {
        handleIncomingPointer(d);
      } else if (d.event === 'loop') {
        handleIncomingJam(d);
      }
    }
  });
}

function broadcastJam(data) {
  if (socket && socket.readyState === WebSocket.OPEN && currentRoom) {
    socket.send(JSON.stringify({ type: 'jam', room: currentRoom, data }));
  }
}


// -------------------------------
// Mouse → Broadcast Pointer Events
// -------------------------------
document.addEventListener('mousemove', e => {
  broadcastJam({
    event: 'pointer',
    id: clientId,
    x: e.clientX,
    y: e.clientY
  });
});

function handleIncomingPointer({ id, x, y }) {
  if (id === clientId) return; // ignore our own

  let c = cursors[id];
  if (!c) {
    c = document.createElement('div');
    c.classList.add('remote-cursor');
    document.body.appendChild(c);
    cursors[id] = c;
  }
  c.style.left = x + 'px';
  c.style.top  = y + 'px';
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
      document
        .querySelector(`.box[data-group="${group}"][data-index="${index}"]`)
        .classList.add('active');
    }
  } else if (action === 'stop') {
    if (active[group][index]) {
      active[group][index] = false;
      players[group][index].unsync().stop(Tone.now());
      document
        .querySelector(`.box[data-group="${group}"][data-group="${group}"][data-index="${index}"]`)
        .classList.remove('active');
    }
  }
}

function broadcastLoop(data) {
  broadcastJam({ ...data, event: 'loop' });
}

Tone.Transport.bpm.value = 150;
const ctx = Tone.getContext().rawContext;

// Effects
const eq3        = new Tone.EQ3({ low: 0, mid: 0, high: 0 });
const panner     = new Tone.Panner(0);
const compressor = ctx.createDynamicsCompressor();
const gainNode   = ctx.createGain(); gainNode.gain.value = 1;
const reverb     = new Tone.Reverb({ decay: 3, wet: 0.2 });
const delay      = new Tone.FeedbackDelay("8n", 0.1);

// Routing: delay → panner → eq3 → reverb → compressor → gainNode → analyser → destination
delay.disconnect(); delay.connect(panner);
panner.connect(eq3); eq3.connect(reverb);
reverb.connect(compressor); compressor.connect(gainNode);

// Analyser
const analyser     = ctx.createAnalyser();
analyser.fftSize   = 256;
const bufferLength = analyser.frequencyBinCount;
const dataArray    = new Uint8Array(bufferLength);
gainNode.disconnect(); gainNode.connect(analyser); analyser.connect(ctx.destination);

// Sample groups
const groups = {
  drums: ["audio/drumloop1.wav","audio/drumloop2.wav","audio/drumloop3.wav","audio/drumloop4.wav"],
  bass : ["audio/bassloop1.wav","audio/bassloop2.wav","audio/bassloop3.wav","audio/bassloop4.wav"],
  pad  : ["audio/padloop1.wav","audio/padloop2.wav","audio/padloop3.wav","audio/padloop4.wav"]
};
const players = { drums: [], bass: [], pad: [] };
const active  = { drums: [false,false,false,false], bass: [false,false,false,false], pad: [false,false,false,false] };

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

  // Mute
  const muteBtn = document.getElementById('muteBtn');
  let isMuted = false;
  muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    gainNode.gain.value = isMuted
      ? 0
      : parseFloat(document.getElementById('volumeSlider').value);
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

  // Pan
  document.getElementById("panSlider").addEventListener("input", e => {
    panner.pan.value = parseFloat(e.target.value);
  });

  // EQ Toggle
  const eqToggleBtn = document.getElementById("toggleEQ");
  eqToggleBtn.addEventListener("click", () => {
    toggleEQ();
    eqToggleBtn.textContent = eqEnabled ? "On" : "Off";
  });
  eqToggleBtn.textContent = "On";
});

// -------------------------------
// Spectrum Visualizer
// -------------------------------
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
  let x = 0;
  for (let i = 0; i < bufferLength; i++) {
    const barHeight = dataArray[i];
    canvasCtx.fillStyle = `rgb(${barHeight + 100},50,${255 - barHeight})`;
    canvasCtx.fillRect(x, canvas.height - barHeight / 2, barWidth, barHeight / 2);
    x += barWidth + 1;
  }
}
draw();

// -------------------------------
// Navigation Button
// -------------------------------
document.getElementById('oneShotsBtn').addEventListener('click', () => {
  window.location.href = 'index.html';
});
