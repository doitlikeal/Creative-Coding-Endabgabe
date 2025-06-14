// === Web Audio Setup ===
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const audioBuffers = {};

// === WebSocket Setup ===
const webRoomsWebSocketServerAddr = 'https://nosch.uber.space/web-rooms/';
const socket = new WebSocket('wss://nosch.uber.space/web-rooms/');
const myPlayerId = 'player_' + Math.random().toString(36).substr(2, 9);
const otherPlayers = {};

socket.addEventListener('open', () => {
  console.log('✅ WebSocket verbunden');
  socket.send(JSON.stringify({ type: 'join', playerId: myPlayerId }));
});

socket.addEventListener('close', () => {
  console.log('❌ Verbindung zum Server getrennt');
});

socket.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  handleMessageFromServer(data);
});

window.addEventListener('beforeunload', () => {
  socket.send(JSON.stringify({ type: 'leave', playerId: myPlayerId }));
});

// === Audio-Freischaltung bei User-Interaktion ===
window.addEventListener('click', () => {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().then(() => console.log('AudioContext resumed'));
  }
});

// === Beat-Setup ===
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
  if (!window.stars) return;
  window.stars.forEach((star, i) => {
    const rainbowColors = ['#FF0000','#FF7F00','#FFFF00','#00FF00','#0000FF','#4B0082','#8B00FF'];
    const color = rainbowColors[(i + Math.floor(Date.now()/100)) % rainbowColors.length];
    star.setAttribute('material','emissive', color);
    setTimeout(() => star && star.setAttribute('material','emissive','#FFFFFF'), 300);
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
      el.setAttribute('material','color', instr.isPlaying ? '#00FF00' : '#ffffff');
      el.setAttribute('material','emissive','#000000');
      el.setAttribute('scale', originalScale);
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'drumToggle', id: el.id, isPlaying: instr.isPlaying
        }));
      }
    });
  }
});

function handleMessageFromServer(data) {
  switch (data.type) {
    case 'playerMove':
      if (data.playerId !== myPlayerId) {
        updateOrCreateOtherPlayer(data.playerId, data.payload);
      }
      break;

    case 'drumToggle':
      const el = document.getElementById(data.id);
      if (!el) return;
      const instr = instruments.find(i => i.el === el);
      if (instr) {
        instr.isPlaying = data.isPlaying;
        el.setAttribute('material','color', instr.isPlaying ? '#00FF00' : '#ffffff');
        el.setAttribute('material','emissive','#000000');
      }
      break;

    case 'join':
      console.log(`${data.playerId} joined.`);
      updateOrCreateOtherPlayer(data.playerId, {
        position: { x: 0, y: 1.6, z: 0 },
        rotation: { x: 0, y: 0, z: 0 }
      });
      break;

    case 'leave':
      console.log(`${data.playerId} left.`);
      const leftEl = otherPlayers[data.playerId];
      if (leftEl) {
        leftEl.parentNode.removeChild(leftEl);
        delete otherPlayers[data.playerId];
      }
      break;
  }
}

function updateOrCreateOtherPlayer(id, payload) {
  let el = otherPlayers[id];
  if (!el) {
    el = document.createElement('a-entity');
    el.setAttribute('geometry','primitive: box; height:1.6; width:0.5; depth:0.5');
    el.setAttribute('material','color:#0000ff; opacity:0.6');

    const nameTag = document.createElement('a-text');
    nameTag.setAttribute('value', id);
    nameTag.setAttribute('align','center');
    nameTag.setAttribute('color','#fff');
    nameTag.setAttribute('position','0 1 0');
    nameTag.setAttribute('scale','2 2 2');
    el.appendChild(nameTag);

    document.querySelector('#scene').appendChild(el);
    otherPlayers[id] = el;
  }
  el.object3D.position.set(payload.position.x, payload.position.y, payload.position.z);
  el.object3D.rotation.set(payload.rotation.x, payload.rotation.y, payload.rotation.z);
}

function sendPlayerPosition() {
  const myEl = document.querySelector('#myPlayer');
  if (!myEl) return;
  const pos = myEl.object3D.position;
  const rot = myEl.object3D.rotation;
  socket.send(JSON.stringify({
    type: 'playerMove',
    playerId: myPlayerId,
    payload: {
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: { x: rot.x, y: rot.y, z: rot.z }
    }
  }));
}

setInterval(() => {
  if (socket.readyState === WebSocket.OPEN) sendPlayerPosition();
}, 100);

startGlobalClock();

// BPM-Slider & Stars initialisieren
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('bpmSlider').addEventListener('input', e => {
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
    star.setAttribute('animation__pulse', {
      property: 'scale', dir: 'alternate', dur: 3000 + Math.random() * 2000,
      easing: 'easeInOutSine', loop: true,
      to: `${(size * 1.5).toFixed(3)} ${(size * 1.5).toFixed(3)} ${(size * 1.5).toFixed(3)}`
    });
    star.setAttribute('animation__glow', {
      property: 'material.emissiveIntensity', dir: 'alternate',
      dur: 3000 + Math.random() * 2000, easing: 'easeInOutSine', loop: true, to: 1.5
    });
    container.appendChild(star);
    window.stars.push(star);
  }
}
