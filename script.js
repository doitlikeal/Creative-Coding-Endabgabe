// === Web Audio Setup ===
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const audioBuffers = {};

// === WebSocket Setup ===
const socket = new WebSocket('wss://nosch.uber.space/web-rooms/');
let myClientId = null;
const roomName = 'drum-room';
const otherPlayers = {};
let myAvatar = null;

socket.addEventListener('open', () => {
  console.log('✅ WebSocket verbunden');
  socket.send(`*enter-room* ${roomName}`);
  socket.send(`*subscribe-client-enter-exit*`);
  socket.send(`*get-client-ids*`);
});

socket.addEventListener('close', () => {
  console.log('❌ Verbindung zum Server getrennt');
});

socket.addEventListener('message', (event) => {
  const msg = event.data;
  handleWebRoomMessage(msg);
});

window.addEventListener('beforeunload', () => {
  socket.send('*exit-room*');
});

// === Audio unlock ===
window.addEventListener('click', () => {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().then(() => console.log('🔊 AudioContext resumed'));
  }
});

// === Beat Clock ===
let bpm = 100;
let beatInterval = 60000 / bpm / 2;
let globalBeatCount = 0;
let instruments = [];
window.stars = [];

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

function flashAllStarsRainbow() {
  const colors = ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#4B0082', '#8B00FF'];
  window.stars.forEach((star, i) => {
    const color = colors[(i + Math.floor(Date.now() / 100)) % colors.length];
    star.setAttribute('material', 'emissive', color);
    setTimeout(() => star && star.setAttribute('material', 'emissive', '#FFFFFF'), 300);
  });
}

async function loadAudioBuffer(url) {
  if (audioBuffers[url]) return audioBuffers[url];
  const res = await fetch(url);
  const arrayBuf = await res.arrayBuffer();
  const decoded = await audioCtx.decodeAudioData(arrayBuf);
  audioBuffers[url] = decoded;
  return decoded;
}

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
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.maxDistance = 10000;
    panner.rolloffFactor = 1;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 0;
    panner.coneOuterGain = 0;
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

      visualize: () => {
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
        const msg = JSON.stringify({ type: 'drumToggle', id: el.id, isPlaying: instr.isPlaying });
        socket.send(`*broadcast-message* ${msg}`);
      }
    });
  }
});

function handleWebRoomMessage(message) {
  if (message.startsWith('*client-id*')) {
    myClientId = message.split(' ')[1];
    console.log('🆔 My client ID:', myClientId);

    myAvatar = document.createElement('a-box');
    myAvatar.setAttribute('id', `player-${myClientId}`);
    myAvatar.setAttribute('height', '1.6');
    myAvatar.setAttribute('width', '0.5');
    myAvatar.setAttribute('depth', '0.5');
    myAvatar.setAttribute('color', '#00ffff');
    myAvatar.setAttribute('opacity', '0.8');
    myAvatar.setAttribute('position', '0 1 0');

    const rig = document.querySelector('#rig');
    if (rig) rig.appendChild(myAvatar);

    socket.send('*get-client-ids*');

    const pos = myAvatar.object3D.position;
    const rot = myAvatar.object3D.rotation;
    const joinMsg = JSON.stringify({
      type: 'playerJoin',
      playerId: myClientId,
      payload: { position: { x: pos.x, y: pos.y, z: pos.z }, rotation: { x: rot.x, y: rot.y, z: rot.z } }
    });
    socket.send(`*broadcast-message* ${joinMsg}`);
    return;
  }

  if (message.startsWith('*client-ids*')) {
    const ids = message.split(' ').slice(1);
    ids.forEach(id => {
      if (id !== myClientId) {
        const request = JSON.stringify({ type: 'whoAreYou', from: myClientId });
        socket.send(`*send-message* ${id} ${request}`);
      }
    });
    return;
  }

  try {
    const data = JSON.parse(message);

    if (data.type === 'drumToggle') {
      const el = document.getElementById(data.id);
      if (!el) return;
      const instr = instruments.find(i => i.el === el);
      if (instr) {
        instr.isPlaying = data.isPlaying;
        el.setAttribute('material', 'color', instr.isPlaying ? '#00FF00' : '#ffffff');
        el.setAttribute('material', 'emissive', '#000000');
      }
    }

    if (data.type === 'playerMove' && data.playerId !== myClientId) {
      updateOrCreateOtherPlayer(data.playerId, data.payload);
    }

    if (data.type === 'playerJoin' && data.playerId !== myClientId) {
      updateOrCreateOtherPlayer(data.playerId, data.payload);
    }

    if (data.type === 'whoAreYou' && data.from) {
      const pos = myAvatar?.object3D?.position || { x: 0, y: 0, z: 0 };
      const rot = myAvatar?.object3D?.rotation || { x: 0, y: 0, z: 0 };
      const reply = JSON.stringify({
        type: 'playerJoin',
        playerId: myClientId,
        payload: { position: { x: pos.x, y: pos.y, z: pos.z }, rotation: { x: rot.x, y: rot.y, z: rot.z } }
      });
      socket.send(`*send-message* ${data.from} ${reply}`);
    }
  } catch (err) {
    console.warn('Nicht-JSON Nachricht:', message);
  }
}

function updateOrCreateOtherPlayer(id, payload) {
  if (id === myClientId) return;

  let el = otherPlayers[id];
  if (!el) {
    el = document.createElement('a-box');
    el.setAttribute('id', `player-${id}`);
    el.setAttribute('height', '1.6');
    el.setAttribute('width', '0.5');
    el.setAttribute('depth', '0.5');
    el.setAttribute('color', '#0000ff');
    el.setAttribute('opacity', '0.6');
    document.querySelector('a-scene').appendChild(el);
    otherPlayers[id] = el;
  }

  el.setAttribute('position', `${payload.position.x} ${payload.position.y} ${payload.position.z}`);
  el.setAttribute('rotation', `${payload.rotation.x} ${payload.rotation.y} ${payload.rotation.z}`);
}

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('bpmSlider')?.addEventListener('input', e => {
    bpm = parseInt(e.target.value);
    document.getElementById('bpmDisplay').innerText = bpm + ' BPM';
    updateBeatInterval();
  });
  createStars();
});

function createStars(count = 20) {
  const container = document.querySelector('#star-container');
  if (!container) return;
  for (let i = 0; i < count; i++) {
    const star = document.createElement('a-sphere');
    const x = (Math.random() - 0.5) * 100;
    const y = 10 + Math.random() * 18;
    const z = (Math.random() - 0.5) * 100;
    const size = Math.random() * 0.8 + 0.5;
    star.setAttribute('position', `${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)}`);
    star.setAttribute('radius', size.toFixed(2));
    star.setAttribute('material', 'color:#FFFFFF; emissive:#FFFFFF; emissiveIntensity:0.8');
    container.appendChild(star);
    window.stars.push(star);
  }
}

setInterval(() => {
  if (socket.readyState !== WebSocket.OPEN || !myClientId || !myAvatar) return;

  const pos = myAvatar.object3D.position;
  const rot = myAvatar.object3D.rotation;

  const msg = JSON.stringify({
    type: 'playerMove',
    playerId: myClientId,
    payload: {
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: { x: rot.x, y: rot.y, z: rot.z }
    }
  });

  socket.send(`*broadcast-message* ${msg}`);
}, 100);

startGlobalClock();
