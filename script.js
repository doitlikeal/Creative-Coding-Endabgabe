window.addEventListener('click', () => {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().then(() => {
      console.log('AudioContext resumed');
    });
  }
});

let bpm = 100;
let beatInterval = 60000 / bpm / 2;
let globalBeatCount = 0;
let instruments = [];

// Sterne-Array global
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
    const rainbowColors = ['#FF0000', '#FF7F00', '#FFFF00', '#00FF00', '#0000FF', '#4B0082', '#8B00FF'];
    const color = rainbowColors[(i + Math.floor(Date.now() / 100)) % rainbowColors.length];
    star.setAttribute('material', 'emissive', color);
    setTimeout(() => {
      if (star) star.setAttribute('material', 'emissive', '#FFFFFF');
    }, 300);
  });
}

// === Web Audio Setup ===
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// Preload audio buffers cache
const audioBuffers = {};

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
  currentlyPlaying: false, // Flag um Überlappung zu verhindern

  async play() {
    if (this.currentlyPlaying) return; // Wenn schon spielt, abbrechen
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

      source.onended = () => {
        this.currentlyPlaying = false;
      };
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
      },
      beatPattern,
      beatModulo: this.data.beatModulo
    };

    instruments.push(instr);

    el.addEventListener('click', () => {
      instr.isPlaying = !instr.isPlaying;
      el.setAttribute('material', 'color', instr.isPlaying ? '#00FF00' : '#fc324a');
      el.setAttribute('material', 'emissive', '#000000');
      el.setAttribute('scale', originalScale);

      if (typeof socket !== 'undefined') {
        socket.emit('drumToggle', {
          id: el.id,
          isPlaying: instr.isPlaying
        });
      }
    });

    if (typeof socket !== 'undefined') {
      socket.on('drumToggle', data => {
        if (data.id === el.id) {
          instr.isPlaying = data.isPlaying;
          el.setAttribute('material', 'color', instr.isPlaying ? '#00FF00' : '#fc324a');
          el.setAttribute('material', 'emissive', '#000000');
          el.setAttribute('scale', originalScale);
        }
      });
    }
  }
});

startGlobalClock();

window.addEventListener('DOMContentLoaded', () => {
  const bpmSlider = document.getElementById('bpmSlider');
  const bpmDisplay = document.getElementById('bpmDisplay');

  bpmSlider.addEventListener('input', (e) => {
    bpm = parseInt(e.target.value);
    bpmDisplay.innerText = bpm;
    updateBeatInterval();
  });
});


socket.on('drumToggle', ({ id, isPlaying }) => {
  const el = document.getElementById(id);
  if (!el) return;

  const instr = instruments.find(i => i.el === el);
  if (instr) {
    instr.isPlaying = isPlaying;
    el.setAttribute('material', 'color', isPlaying ? '#00FF00' : '#fc324a');
    el.setAttribute('material', 'emissive', '#000000');
  }
});

// Sterne erstellen
function createStars(count = 25) {
  const container = document.querySelector('#star-container');
  if (!container) return;

  for (let i = 0; i < count; i++) {
    const star = document.createElement('a-sphere');
    const x = 0 + (Math.random() - 0.5) * 100;   // +/-50m
    const y = 10 + Math.random() * 18;            // 2-20m hoch
    const z = 5 + (Math.random() - 0.5) * 100;   // +/-50m

    const size = Math.random() * 0.8 + 0.5;  // größer: 0.8 bis 0.5

    star.setAttribute('position', `${x.toFixed(2)} ${y.toFixed(2)} ${z.toFixed(2)}`);
    star.setAttribute('radius', size.toFixed(2));
    star.setAttribute('material', 'color: #FFFFFF; emissive: #FFFFFF; emissiveIntensity: 0.8');
    
    // Sanftes Pulsieren via Animation (Scale)
    star.setAttribute('animation__pulse', {
      property: 'scale',
      dir: 'alternate',
      dur: 3000 + Math.random() * 2000,
      easing: 'easeInOutSine',
      loop: true,
      to: `${(size * 1.5).toFixed(3)} ${(size * 1.5).toFixed(3)} ${(size * 1.5).toFixed(3)}`
    });

    // Sanftes Pulsieren des Glow (emissiveIntensity)
    star.setAttribute('animation__glow', {
      property: 'material.emissiveIntensity',
      dir: 'alternate',
      dur: 3000 + Math.random() * 2000,
      easing: 'easeInOutSine',
      loop: true,
      to: 1.5
    });

    container.appendChild(star);
    window.stars.push(star);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  createStars();
});
