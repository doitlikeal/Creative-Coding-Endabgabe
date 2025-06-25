// === Web Audio Setup ===
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const audioBuffers = {};
let starPopBuffer = null;

async function loadStarPopSound() {
  const response = await fetch('sounds/pop.mp3'); // 🔊 your pop sound file
  const arrayBuffer = await response.arrayBuffer();
  starPopBuffer = await audioCtx.decodeAudioData(arrayBuffer);
}
loadStarPopSound();

let teleport2Buffer = null;

async function loadTeleport2Sound() {
  const response = await fetch('sounds/teleport2.wav');
  const arrayBuffer = await response.arrayBuffer();
  teleport2Buffer = await audioCtx.decodeAudioData(arrayBuffer);
}
loadTeleport2Sound();

const bpmSlider = document.getElementById('bpmSlider');

function updateSliderBackground(slider) {
  const min = parseInt(slider.min);
  const max = parseInt(slider.max);
  const val = parseInt(slider.value);
  const percent = ((val - min) / (max - min)) * 100;

  slider.style.background = `linear-gradient(to right, #4CC3D9 ${percent}%, #444 ${percent}%)`;
}

// Init on load
updateSliderBackground(bpmSlider);

// Update on input
bpmSlider.addEventListener('input', () => {
  updateSliderBackground(bpmSlider);
});

// === WebSocket Setup ===
let socket;
const currentRoom = 'drum-dominator';
let myClientId = null;
let clientCount = 0;
let lastClientCount = 0;

const instruments = [];
window.stars = [];

// === User Name Setup ===
const clientNames = {};
const NICKNAME_POOL = [
  'JazzBear', 'LoopZilla', 'BassDuck', 'SynthKitty', 'FunkyFrog',
  'EchoFox', 'DrumBug', 'GrooveBot', 'BoomBoi', 'WubWizard'
];

// Ensure each client gets a fixed name from the pool based on their myClientId
function getFixedNickname(clientId) {
  return NICKNAME_POOL[clientId % NICKNAME_POOL.length];
}

// === UI Elements ===
const indexElem = document.getElementById('client-index');
const bpmDisplay = document.getElementById('bpmDisplay');
const clientListElem = document.getElementById('client-list');
const noticeContainer = document.getElementById('client-notice-container');

// === Beat Clock ===
let bpm = 100;
let beatInterval = 60000 / bpm / 2;
let globalBeatCount = 0;

function updateBeatInterval() {
  beatInterval = 60000 / bpm / 2;
}

function startGlobalClock() {
  function tick() {
    globalBeatCount++;
    instruments.forEach(instr => {
      if (instr.isPlaying && instr.beatPattern.includes(globalBeatCount % instr.beatModulo)) {
        instr.play();
        instr.visualize();
      }
    });
    setTimeout(tick, beatInterval);
  }
  tick();
}

// === AudioContext Unlock ===
window.addEventListener('click', () => {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().then(() => console.log('🔊 AudioContext resumed'));
  }
});

// === WebSocket + Room Logic ===
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
        myClientId = String(msg[1]);
        const nickname = getFixedNickname(myClientId); // Use fixed nickname
        clientNames[myClientId] = nickname;
        socket.send(JSON.stringify(['*broadcast-message*', ['nickname', myClientId, nickname]]));
        break;
      }
      case '*client-count*':
        clientCount = msg[1];
        updateClientIndex();
        updateClientList();
        break;
      case 'nickname': {
        const id = msg[1];
        const name = msg[2];
        clientNames[id] = name;
        break;
      }
      case 'leave': {
        const id = msg[1];
        delete clientNames[id];
        break;
      }
      case 'move': {
        const clientId = msg[1];
        const position = msg[2];
        moveAvatar(clientId, position); // Sync avatar's position across clients (if applicable)
        break;
      }
      case 'cubeClick': {
        const cubeId = msg[1];
        const clientId = msg[2];
        handleCubeClick(cubeId, clientId); // Handle cube click across all clients
        break;
      }
    }
  });

  setInterval(() => socket?.send(''), 30000);
}
connectToRoom(currentRoom);

// === Handle WebSocket Messages ===
socket.addEventListener('message', (event) => {
  const msg = event.data;
  console.log('WebSocket message received:', msg);

  try {
    const parsed = JSON.parse(msg);

    if (Array.isArray(parsed)) {
      const [selector, ...rest] = parsed;
      switch (selector) {
        case '*client-id*':
          myClientId = rest[0] + 1;
          const nickname = getFixedNickname(myClientId); // Use fixed nickname
          clientNames[myClientId] = nickname;
          updateClientIndex();
          const nameMsg = JSON.stringify({ type: 'clientName', clientId: myClientId, name: nickname });
          socket.send(`*broadcast-message* ${nameMsg}`);
          break;
        case '*client-count*':
          const newCount = rest[0];
          if (lastClientCount && newCount > lastClientCount) {
            showClientNotice('🎉 A new player joined!');
          } else if (lastClientCount && newCount < lastClientCount) {
            showClientNotice('👋 A player left the session.');
          }
          lastClientCount = newCount;
          clientCount = newCount;
          updateClientIndex();
          updateClientList();
          break;
      }
    } else if (parsed.type === 'drumToggle') {
      const el = document.getElementById(parsed.id);
      if (!el) return;
      const instr = instruments.find(i => i.el === el);
      if (instr) {
        instr.isPlaying = parsed.isPlaying;
        el.setAttribute('material', 'color', instr.isPlaying ? '#00FF00' : '#ffffff');
        el.setAttribute('material', 'emissive', '#000000');
      }
    } else if (parsed.type === 'cubeClick') {
      handleCubeClick(parsed.cubeId, parsed.clientId); // Handle the cube click event
    } else if (parsed.type === 'clientName') {
      clientNames[parsed.clientId] = parsed.name;
      updateClientIndex();
      updateClientList();
    }
  } catch (err) {
    console.warn('Non-JSON message:', msg);
  }
});

// === Handle Cube Clicks ===
// This function is used to handle cube clicks both locally and from other clients.
let cubeSoundState = {};

function handleCubeClick(cubeId, clientId) {
  const cube = document.getElementById(cubeId);
  if (cube) {
    // Check if the cube is already active (playing a sound)
    const isPlaying = cubeSoundState[cubeId] || false;

    if (!isPlaying) {
      // If not playing, set it to red temporarily
      cube.setAttribute('material', 'color', '#FF0000');
      setTimeout(() => {
        cube.setAttribute('material', 'color', '#FFFFFF');
      }, 4000); // Reset color after 4 seconds if it's not playing sound
    } else {
      // If it's playing, keep the cube green
      cube.setAttribute('material', 'color', '#00FF00');
    }

    const name = clientNames[clientId] || `User ${clientId}`;
    console.log(`${name} clicked the cube: ${cubeId}`);

    // Trigger the sound for the cube
    playCubeSound(cubeId); // You should define this function to actually play the sound

    // Mark the cube as playing
    cubeSoundState[cubeId] = true;

    // Broadcast the cube click to other clients
    broadcastCubeClick(cubeId);
  }
}

// === Broadcast Cube Click to All Clients ===
function broadcastCubeClick(cubeId) {
  socket.send(JSON.stringify(['*broadcast-message*', ['cubeClick', cubeId, myClientId]]));
}

// === Handle Cube Clicks by Other Clients ===
function handleCubeClickByOtherClient(cubeId, clientId) {
  const cube = document.getElementById(cubeId);
  if (cube) {
    // Change the color to red for 4 seconds when another client clicks the cube
    cube.setAttribute('material', 'color', '#FF0000');
    setTimeout(() => {
      // After 4 seconds, if it's not playing sound, reset to white, else stay green
      if (!cubeSoundState[cubeId]) {
        cube.setAttribute('material', 'color', '#FFFFFF');
      } else {
        cube.setAttribute('material', 'color', '#00FF00');
      }
    }, 4000); // 4000 milliseconds = 4 seconds

    const name = clientNames[clientId] || `User ${clientId}`;
    console.log(`${name} clicked the cube: ${cubeId}`);
  }
}

// === Update UI Elements ===
function updateClientIndex() {
  if (indexElem && myClientId != null) {
    const name = clientNames[myClientId] || `User ${myClientId}`;
    indexElem.textContent = `You: ${name}`;
  }
}

function updateClientList() {
  if (!clientListElem) return;
  clientListElem.innerHTML = '';
  for (let clientId in clientNames) {
    const name = clientNames[clientId] || `User ${clientId}`;
    const li = document.createElement('li');
    li.textContent = name;
    clientListElem.appendChild(li);
  }
}

function showClientNotice(text) {
  if (!noticeContainer) return;
  const notice = document.createElement('div');
  notice.className = 'client-notice';
  notice.textContent = text;
  noticeContainer.appendChild(notice);
  setTimeout(() => notice.remove(), 3000);
}

// === Init on DOM Load ===
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('bpmSlider')?.addEventListener('input', e => {
    bpm = parseInt(e.target.value);
    bpmDisplay.innerText = bpm;
    updateBeatInterval();
  });

  createStars();
  startGlobalClock();
});

// === Teleport Sound on Box Click ===
document.getElementById('loopyBox')?.addEventListener('click', () => {
  if (teleport2Buffer) {
    const source = audioCtx.createBufferSource();
    source.buffer = teleport2Buffer;

    const gain = audioCtx.createGain();
    gain.gain.value = 0.4;

    source.connect(gain).connect(audioCtx.destination);
    source.start();
  }

  // Delay navigation slightly so sound has time to play
  setTimeout(() => {
    window.location.href = 'loops.html';
  }, 800); // Adjust delay if needed
});

// Add click event listeners for the clickable boxes
const clickableBoxes = document.querySelectorAll('.clickable');
clickableBoxes.forEach(box => {
  box.addEventListener('click', () => {
    const cubeId = box.id; // Get the ID of the clicked box
    broadcastCubeClick(cubeId); // Broadcast the cube click to all clients
  });
});

// === Star Visuals ===
function flashAllStarsRainbow() {
  const colors = ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#4B0082', '#8B00FF'];
  window.stars.forEach((star, i) => {
    const color = colors[(i + Math.floor(Date.now() / 100)) % colors.length];
    star.setAttribute('material', 'emissive', color);
    setTimeout(() => star && star.setAttribute('material', 'emissive', '#FFFFFF'), 300);
  });
}

function createStars(count = 200) {
  const container = document.querySelector('#star-container');
  if (!container) return;

  function getRandomColor() {
    const hue = Math.floor(Math.random() * 360);
    return `hsl(${hue}, 100%, 60%)`;
  }

  function createSingleStar() {
    const star = document.createElement('a-sphere');
    const x = (Math.random() - 0.5) * 100;
    const y = 10 + Math.random() * 18;
    const z = (Math.random() - 0.5) * 100;
    const size = Math.random() * 0.8 + 0.5;

    star.setAttribute('position', `${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)}`);
    star.setAttribute('radius', size.toFixed(2));
    star.setAttribute('material', 'color:#FFFFFF; emissive:#FFFFFF; emissiveIntensity:0.8; opacity:1.0');

    // Pulsate
    star.setAttribute('animation', {
      property: 'scale',
      to: '1.5 1.5 1.5',
      dir: 'alternate',
      dur: 1000,
      loop: true,
      easing: 'easeInOutSine'
    });

    // Never move below y = 5
    let targetY = (Math.random() - 0.5) * 100;
    if (targetY < 5) targetY = 5 + Math.random() * 5;

    const moveTarget = {
      x: (Math.random() - 0.5) * 100,
      y: targetY,
      z: (Math.random() - 0.5) * 100
    };

    const moveTime = Math.random() * 80 + 30;
    star.setAttribute('animation__move', {
      property: 'position',
      to: `${moveTarget.x.toFixed(2)} ${moveTarget.y.toFixed(2)} ${moveTarget.z.toFixed(2)}`,
      dur: moveTime * 1000,
      loop: true,
      easing: 'linear'
    });

    // Hover effects
    star.addEventListener('mouseenter', () => {
      const glow = getRandomColor();
      star.setAttribute('material', 'emissive', glow);
      star.setAttribute('scale', '1.8 1.8 1.8');
      star.setAttribute('material', 'emissiveIntensity', 1.5);
    });

    star.addEventListener('mouseleave', () => {
      star.setAttribute('material', 'emissive', '#FFFFFF');
      star.setAttribute('scale', '1 1 1');
      star.setAttribute('material', 'emissiveIntensity', 0.8);
    });

    // CLICK: Sound + Burst + Regenerate
    star.addEventListener('click', () => {
      // 🔊 Spatial pop sound
      if (starPopBuffer) {
        const source = audioCtx.createBufferSource();
        source.buffer = starPopBuffer;
        source.playbackRate.value = 0.9 + Math.random() * 0.2;

        const panner = audioCtx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 10;
        panner.maxDistance = 100;
        panner.rolloffFactor = 1;

        const pos = star.object3D.position;
        panner.setPosition(pos.x, pos.y, pos.z);

        const gainNode = audioCtx.createGain();
        gainNode.gain.value = 0.2;

        source.connect(gainNode).connect(panner).connect(audioCtx.destination);
        source.start();
      }

      // 💥 Particle burst
      const particles = document.createElement('a-entity');
      particles.setAttribute('position', star.getAttribute('position'));
      particles.setAttribute('particle-system', {
        preset: 'dust',
        color: '#FFF,#0FF,#F0F,#FF0',
        size: 1,
        particleCount: 100,
        duration: 0.5,
        maxAge: 1,
        opacity: 0.9
      });
      container.appendChild(particles);
      setTimeout(() => container.removeChild(particles), 1000);

      // 🎈 Pop + fade animation
      star.setAttribute('animation__pop', {
        property: 'scale',
        to: '3 3 3',
        dur: 150,
        easing: 'easeOutQuad'
      });

      star.setAttribute('animation__fade', {
        property: 'material.opacity',
        to: 0,
        dur: 200,
        easing: 'easeOutQuad'
      });

      setTimeout(() => {
        window.stars = window.stars.filter(s => s !== star);
        star.parentNode?.removeChild(star);
        createSingleStar();
      }, 200);
    });

    container.appendChild(star);
    window.stars.push(star);
  }

  for (let i = 0; i < count; i++) {
    createSingleStar();
  }
}

// === Audio Buffer Loader ===
async function loadAudioBuffer(url) {
  if (audioBuffers[url]) return audioBuffers[url];
  const res = await fetch(url);
  const arrayBuf = await res.arrayBuffer();
  const decoded = await audioCtx.decodeAudioData(arrayBuf);
  audioBuffers[url] = decoded;
  return decoded;
}

AFRAME.registerComponent('hover-glow', {
  init: function () {
    const el = this.el;
    const defaultMaterial = el.getAttribute('material');
    const defaultEmissive = defaultMaterial.emissive || '#FFFFFF';

    el.addEventListener('mouseenter', () => {
      // ✅ Get fresh base scale on each hover
      const currentScale = el.object3D.scale;

      el.setAttribute('material', 'emissive', '#ff00cc');
      el.setAttribute('material', 'emissiveIntensity', 2);
      el.removeAttribute('animation__pulse');

      el.setAttribute('animation__pulse', {
        property: 'scale',
        to: {
          x: currentScale.x * 1.2,
          y: currentScale.y * 1.2,
          z: currentScale.z * 1.2
        },
        dir: 'alternate',
        dur: 400,
        loop: true,
        easing: 'easeInOutSine'
      });
    });

    el.addEventListener('mouseleave', () => {
      el.removeAttribute('animation__pulse');
      el.setAttribute('scale', '1 1 1'); // ⬅️ reset hardcoded to original size
      el.setAttribute('material', {
        emissive: defaultEmissive,
        emissiveIntensity: 1
      });
    });

    el.addEventListener('click', () => {
      popStar(el);
    });

    function popStar(starEl) {
      starEl.setAttribute('animation__pop', {
        property: 'scale',
        to: '3 3 3',
        dur: 150,
        easing: 'easeOutQuad'
      });

      starEl.setAttribute('animation__fade', {
        property: 'material.opacity',
        to: 0,
        dur: 200,
        easing: 'easeOutQuad'
      });

      setTimeout(() => {
        window.stars = window.stars.filter(s => s !== starEl);
        starEl.parentNode?.removeChild(starEl);
        createStar();
      }, 200);
    }
  }
});

// === A-Frame Drum Component ===
AFRAME.registerComponent('drum-step', {
  schema: {
    soundId: { type: 'string' },
    beatPattern: { type: 'string' },
    beatModulo: { type: 'int', default: 8 }
  },

  init: function () {
    const el = this.el;
    const audioEl = document.querySelector(`#${this.data.soundId}`);
    const src = audioEl.getAttribute('src');
    const beatPattern = this.data.beatPattern.split(',').map(n => parseInt(n));
    const originalScale = { ...el.getAttribute('scale') };

    const panner = audioCtx.createPanner();
    panner.panningModel = 'HRTF';
    panner.connect(audioCtx.destination);

    let lastVisualizeTime = 0;

    const instr = {
      el,
      isPlaying: false,
      currentlyPlaying: false,
      beatPattern,
      beatModulo: this.data.beatModulo,

      async play() {
        if (this.currentlyPlaying) return;
        this.currentlyPlaying = true;
        flashAllStarsRainbow();
        try {
          const buffer = await loadAudioBuffer(src);
          const source = audioCtx.createBufferSource();
          source.buffer = buffer;
          const pos = el.object3D.position;
          panner.setPosition(pos.x, pos.y, pos.z);
          source.connect(panner);
          source.start();
          source.onended = () => { this.currentlyPlaying = false; };
        } catch (err) {
          console.error('Audio error:', err);
          this.currentlyPlaying = false;
        }
      },

      visualize() {
        const now = Date.now();
        if (now - lastVisualizeTime < 80) return;
        lastVisualizeTime = now;
        el.setAttribute('scale', originalScale);
        el.removeAttribute('animation__pulse');
        el.setAttribute('animation__pulse', {
          property: 'scale',
          to: {
            x: originalScale.x * 1.2,
            y: originalScale.y * 1.2,
            z: originalScale.z * 1.2
          },
          dir: 'alternate',
          dur: 100,
          easing: 'easeInOutQuad',
          loop: false
        });
      }
    };

    instruments.push(instr);

    el.addEventListener('click', () => {
      instr.isPlaying = !instr.isPlaying;
      el.setAttribute('material', 'color', instr.isPlaying ? '#00FF00' : '#ffffff');
      el.setAttribute('material', 'emissive', '#000000');
      el.setAttribute('scale', originalScale);

      if (socket.readyState === WebSocket.OPEN && myClientId) {
        broadcastBoxToggle(el.id, instr.isPlaying);
        broadcastClick(el.id);
        showClientClick(el.id, myClientId);
      }
    });
  }
});