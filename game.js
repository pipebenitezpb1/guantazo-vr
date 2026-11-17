// ¡Guantazo! — boxeo de caricatura controlado con las manos (MediaPipe Hand Landmarker + three.js)
import * as THREE from 'three';
import { StereoEffect } from 'three/addons/effects/StereoEffect.js';
import { drawArena360 } from './estadio360.js';
import { buildAvatar, updateArms, OPTIONS, COLOR_FIELDS, DEFAULT_AVATAR, randomAvatar } from './avatar.js';

// ============================================================
// Configuración
// ============================================================
const MP_VER = '0.10.14';
const VISION_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const CFG = {
  punchWindow: 200,   // ms en que se mide el crecimiento de la palma
  punchGrowth: 1.22,  // la palma crece 22 % en esa ventana => golpe
  hookVx: 0.9,        // velocidad lateral hacia el centro (anchos/s) para que sea gancho
  hookVxStrong: 1.9,  // barrido lateral muy rápido => gancho aunque crezca poco
  cooldown: 330,      // ms entre golpes de la misma mano
  guardRaise: 0.10,   // cuánto deben subir las manos sobre la pose calibrada
  guardMaxDx: 0.34,   // distancia horizontal máxima entre manos en guardia
  dodgeDx: 0.13,      // desplazamiento del centro de las manos para esquivar
  roundSecs: 60,
  rounds: 3,
};
const ATTACK_TIME = 0.2; // s que tarda el puño del rival en llegar

const RIVALS = [
  { name: 'Tito Tornado', skin: '#e2a877', face: 'redonda', hair: 'puntas', hairColor: '#e86a5c', eyes: 'grande', brows: 'recta', nose: 'boton', mouth: 'amplia', extra: 'cintillo',
    shirt: '#ffd43b', shorts: '#ff6b6b', glove: '#ff6b6b',
    hp: 90, dmg: 9, tele: 950, idle: [1.4, 2.6], recover: 1.0, blockChance: 0.15, feint: 0, scale: 1 },
  { name: 'La Mole Morada', skin: '#8d5a3b', face: 'ancha', hair: 'rizos', hairColor: '#6c5ce7', eyes: 'punto', brows: 'gruesa', nose: 'ancha', mouth: 'chica', extra: 'mejillas',
    shirt: '#da77f2', shorts: '#343a40', glove: '#ffd43b',
    hp: 110, dmg: 12, tele: 780, idle: [1.0, 2.0], recover: 0.8, blockChance: 0.3, feint: 0.12, scale: 1.1 },
  { name: 'Capitán Cachetes', skin: '#ffe3cc', face: 'ovalada', hair: 'calvo', hairColor: '#b9b9c2', eyes: 'normal', brows: 'arco', nose: 'larga', mouth: 'sonrisa', extra: 'bigote',
    shirt: '#38d9a9', shorts: '#1b1b3a', glove: '#4dabf7',
    hp: 130, dmg: 15, tele: 620, idle: [0.7, 1.6], recover: 0.65, blockChance: 0.4, feint: 0.2, breaker: true, scale: 1.05 },
];

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const rand = (a, b) => a + Math.random() * (b - a);
const nowS = () => performance.now() / 1000;

// ============================================================
// Sonido sintetizado (Web Audio, sin archivos)
// ============================================================
const Sfx = (() => {
  let ctx, master, noiseBuf;
  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function env(g, t0, attack, dur, peak) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }
  function noise(dur, { type = 'lowpass', f0 = 2000, f1 = f0, q = 1, gain = 0.5, attack = 0.003, when = 0 } = {}) {
    if (!ctx) return; const t0 = ctx.currentTime + when;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const g = ctx.createGain(); env(g, t0, attack, dur, gain);
    src.connect(f); f.connect(g); g.connect(master); src.start(t0); src.stop(t0 + dur + 0.05);
  }
  function tone(freq, dur, { type = 'sine', gain = 0.3, f1 = null, attack = 0.004, when = 0 } = {}) {
    if (!ctx) return; const t0 = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ctx.createGain(); env(g, t0, attack, dur, gain);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  return {
    ensure,
    whoosh() { noise(0.16, { type: 'bandpass', f0: 500, f1: 2600, q: 0.9, gain: 0.22 }); },
    hit(strong) {
      tone(strong ? 95 : 130, 0.2, { gain: 0.9, f1: 40 });
      noise(0.09, { type: 'lowpass', f0: 4000, f1: 400, gain: strong ? 0.8 : 0.55 });
      tone(strong ? 520 : 680, 0.06, { type: 'square', gain: 0.06, f1: 200 });
    },
    block() { tone(760, 0.09, { type: 'square', gain: 0.1, f1: 480 }); noise(0.06, { type: 'highpass', f0: 2500, gain: 0.3 }); },
    hurt() { tone(70, 0.32, { gain: 1, f1: 32 }); noise(0.18, { type: 'lowpass', f0: 1500, f1: 150, gain: 0.8 }); },
    warn(purple) { const b = purple ? 600 : 880; tone(b, 0.09, { type: 'triangle', gain: 0.18 }); tone(b * 1.5, 0.12, { type: 'triangle', gain: 0.18, when: 0.1 }); },
    dodge() { noise(0.2, { type: 'bandpass', f0: 3000, f1: 700, q: 1.2, gain: 0.25 }); tone(1200, 0.12, { type: 'sine', gain: 0.08, f1: 1800 }); },
    bell(n = 1) {
      for (let k = 0; k < n; k++) {
        const w = k * 0.32;
        [523, 1247, 1893, 2711].forEach((f, i) => tone(f, 1.6 - i * 0.25, { gain: 0.22 / (i + 1), when: w, attack: 0.002 }));
      }
    },
    cheer() { noise(1.8, { type: 'bandpass', f0: 800, f1: 1300, q: 0.5, gain: 0.3, attack: 0.35 }); },
    ko() { [262, 330, 392, 523, 659].forEach((f, i) => tone(f, 0.25, { type: 'square', gain: 0.09, when: i * 0.11 })); tone(784, 0.7, { type: 'square', gain: 0.09, when: 0.6 }); },
    lose() { [392, 349, 311, 262].forEach((f, i) => tone(f, 0.35, { type: 'triangle', gain: 0.2, when: i * 0.22 })); },
    click() { tone(660, 0.05, { type: 'triangle', gain: 0.12 }); },
  };
})();

// ============================================================
// Escena three.js: estilo limpio, luminoso y suave (formas redondas, luz difusa, sombras suaves)
// ============================================================
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
const stereo = new StereoEffect(renderer);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#dce8f5');
// "rig" = la posición del jugador. La cámara va dentro: en VR (WebXR) el visor mueve la cámara dentro del rig.
const rig = new THREE.Group(); rig.position.set(0, 0, 0.6); scene.add(rig);
const camera = new THREE.PerspectiveCamera(66, 1, 0.05, 100);
const EYE_Y = 1.55, BASE_PITCH = Math.atan2(1.45 - EYE_Y, 3.0);
camera.position.set(0, EYE_Y, 0);
rig.add(camera);
const HEAD_WORLD = new THREE.Vector3(0, EYE_Y, 0.6); // a dónde apunta el rival

const toon = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, ...extra });
const OUTLINES = false; // contornos de caricatura desactivados para un look más suave
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x1a1030, side: THREE.BackSide });
const SPHERE = new THREE.SphereGeometry(1, 28, 18);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 24);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CONE = new THREE.ConeGeometry(1, 1, 16);

function mesh(geo, mat, pos, scale, outline = 0.06) {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(...pos);
  if (scale) Array.isArray(scale) ? m.scale.set(...scale) : m.scale.setScalar(scale);
  if (outline && OUTLINES) { const o = new THREE.Mesh(geo, outlineMat); o.scale.setScalar(1 + outline); m.add(o); }
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ---------- Fondo 360° (imagen equirectangular en una esfera alrededor del jugador) ----------
const panoMat = new THREE.MeshBasicMaterial({ fog: false, depthWrite: false });
const panoGeo = new THREE.SphereGeometry(45, 96, 48); panoGeo.scale(-1, 1, 1); // se ve desde dentro
const pano = new THREE.Mesh(panoGeo, panoMat);
pano.position.set(0, EYE_Y, 0.6);
pano.rotation.y = -Math.PI / 2; // el centro de la imagen (x = W/2) queda al frente, detrás del rival
pano.renderOrder = -1;
scene.add(pano);
let panoSource = 'estadio generado';
function setPanoTexture(tex, source) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (panoMat.map) panoMat.map.dispose();
  panoMat.map = tex; panoMat.needsUpdate = true; panoSource = source;
  const lbl = document.getElementById('panoName'); if (lbl) lbl.textContent = source;
}
function useGeneratedPano() { setPanoTexture(new THREE.CanvasTexture(drawArena360()), 'estadio generado'); }
function loadPanoFromUrl(url, label) {
  new THREE.TextureLoader().load(url, (t) => setPanoTexture(t, label || url),
    undefined, () => { console.warn('No pude cargar la imagen 360:', url); });
}
function loadPanoFromFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const url = URL.createObjectURL(file);
  new THREE.TextureLoader().load(url, (t) => { setPanoTexture(t, file.name); URL.revokeObjectURL(url); });
}
useGeneratedPano();
document.fonts?.ready.then(() => { if (panoSource === 'estadio generado') useGeneratedPano(); });
{
  const p = new URLSearchParams(location.search).get('fondo');
  if (p) loadPanoFromUrl(p, p.split('/').pop());
}

// ---------- Luces suaves ----------
scene.add(new THREE.HemisphereLight('#ffffff', '#b7c7da', 1.5));
const sun = new THREE.DirectionalLight('#ffffff', 2.2);
sun.position.set(2.5, 7, 3); sun.target.position.set(0, 0, -2);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.radius = 6; sun.shadow.bias = -0.0005;
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 20 });
scene.add(sun, sun.target);
const fill = new THREE.DirectionalLight('#dfeaff', 0.7); fill.position.set(-3, 3, 4); scene.add(fill);

// ---------- Ring: lona clara, faldón azul, cuerdas blancas ----------
const RING_Z = -1.6, RING_H = 3.3;
const ring = new THREE.Group(); ring.position.z = RING_Z; scene.add(ring);
ring.add(mesh(BOX, toon('#f3f5f8', { roughness: 0.8 }), [0, -0.15, 0], [RING_H * 2, 0.3, RING_H * 2], 0));
ring.add(mesh(BOX, toon('#4f8fd6'), [0, -0.6, 0], [RING_H * 2 + 0.2, 0.7, RING_H * 2 + 0.2], 0.01));
const logo = new THREE.Mesh(new THREE.CircleGeometry(1.4, 64), toon('#dbe8f6', { roughness: 0.8 })); logo.rotation.x = -Math.PI / 2; logo.position.y = 0.005; logo.receiveShadow = true; ring.add(logo);
const logo2 = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.5, 64), toon('#8db8e8')); logo2.rotation.x = -Math.PI / 2; logo2.position.y = 0.006; logo2.receiveShadow = true; ring.add(logo2);
const postColors = ['#e8edf3', '#e8edf3', '#e8edf3', '#e8edf3'];
const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
corners.forEach(([sx, sz], i) => {
  ring.add(mesh(CYL, toon(postColors[i]), [sx * RING_H, 0.75, sz * RING_H], [0.12, 1.5, 0.12], 0.08));
  ring.add(mesh(CYL, toon(i % 2 ? '#ff7b7b' : '#6aa8ec'), [sx * RING_H, 0.9, sz * RING_H], [0.16, 0.95, 0.16], 0.08));
});
const ropeCols = ['#ffffff', '#cfe0f3', '#ffffff'];
[0.5, 0.88, 1.26].forEach((y, k) => {
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
    const len = RING_H * 2;
    const rope = mesh(CYL, toon(ropeCols[k]), [(ax + bx) / 2 * RING_H, y, (az + bz) / 2 * RING_H], [0.035, len, 0.035], 0.25);
    if (ax === bx) rope.rotation.x = Math.PI / 2; else rope.rotation.z = Math.PI / 2;
    ring.add(rope);
  }
});

// El público 3D se reemplazó por el fondo 360°.
const crowdDummy = new THREE.Object3D();

// Guante (compartido por jugador y rival)
function makeGlove(color, r, thumbSide) {
  const g = new THREE.Group();
  const mat = toon(color, { emissive: new THREE.Color('#000000') });
  g.add(mesh(SPHERE, mat, [0, 0, 0], [r, r * 0.92, r * 1.12], 0.07));
  g.add(mesh(SPHERE, mat, [thumbSide * r * 0.78, -r * 0.15, -r * 0.25], r * 0.4, 0.12));
  const cuff = mesh(CYL, toon('#ffffff'), [0, 0, r * 1.05], [r * 0.66, r * 0.75, r * 0.66], 0.08); cuff.rotation.x = Math.PI / 2; g.add(cuff);
  const stripe = mesh(CYL, toon(color), [0, 0, r * 1.05], [r * 0.68, r * 0.15, r * 0.68], 0); stripe.rotation.x = Math.PI / 2; g.add(stripe);
  return { group: g, mat };
}

// Guantes del jugador (hijos de la cámara)
const pGloves = {
  L: makeGlove('#e5484d', 0.085, 1),
  R: makeGlove('#e5484d', 0.085, -1),
};
for (const k of ['L', 'R']) { camera.add(pGloves[k].group); pGloves[k].anim = null; pGloves[k].pos = new THREE.Vector3(k === 'L' ? -0.28 : 0.28, -0.25, -0.6); }

// Sprites: "!" y "¡POW!"
function circleTexture(text, bg, fg) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#ff6b6b'; g.beginPath(); g.arc(128, 128, 120, 0, 7); g.fill();
  g.fillStyle = bg; g.beginPath(); g.arc(128, 128, 104, 0, 7); g.fill();
  g.fillStyle = fg; g.font = '800 170px "M PLUS Rounded 1c", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 140);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function burstTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  const star = (R, r, col) => { g.fillStyle = col; g.beginPath(); for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; const rr = i % 2 ? r : R; g.lineTo(128 + Math.cos(a) * rr, 128 + Math.sin(a) * rr); } g.fill(); };
  star(126, 80, '#ffffff'); star(108, 68, '#ffcf5a'); star(66, 42, '#ffffff');
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const burst = new THREE.Sprite(new THREE.SpriteMaterial({ map: burstTexture(), transparent: true, depthTest: false }));
burst.visible = false; burst.renderOrder = 10; scene.add(burst);
let burstT = 99;

// Confeti de victoria
const CONF_N = 260;
const confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.11), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), CONF_N);
const confData = [];
{
  const cols = ['#ff4f8b', '#ffd23f', '#2ec4b6', '#c77dff', '#ffffff', '#8ef0a0'];
  const c = new THREE.Color();
  for (let i = 0; i < CONF_N; i++) { confetti.setColorAt(i, c.set(cols[i % cols.length])); confData.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: rand(2, 8) }); }
  confetti.visible = false; scene.add(confetti);
}
function launchConfetti() {
  confData.forEach((d) => { d.p.set(rand(-3, 3), rand(4, 7), rand(-4, 0)); d.v.set(rand(-0.4, 0.4), rand(-1.5, -0.6), rand(-0.3, 0.3)); d.r.set(rand(0, 6), rand(0, 6), 0); });
  confetti.visible = true;
}
function updateConfetti(dt, t) {
  if (!confetti.visible) return;
  confData.forEach((d, i) => {
    d.p.addScaledVector(d.v, dt); d.p.x += Math.sin(t * 2 + i) * dt * 0.3;
    if (d.p.y < 0) d.p.y = rand(5, 7);
    d.r.x += d.w * dt; d.r.y += d.w * 0.7 * dt;
    crowdDummy.position.copy(d.p); crowdDummy.rotation.copy(d.r); crowdDummy.updateMatrix();
    confetti.setMatrixAt(i, crowdDummy.matrix);
  });
  crowdDummy.rotation.set(0, 0, 0);
  confetti.instanceMatrix.needsUpdate = true;
}

// ============================================================
// Rival: personaje original de figuras redondas y guantes flotantes
// ============================================================
function buildRival(def) {
  const m = buildAvatar(def, { mesh, toon, makeGlove, circleTexture, SPHERE, CYL, BOX, CONE });
  m.root.scale.setScalar(def.scale || 1);
  m.root.position.set(0, 0, -2.4);
  return m;
}

// ============================================================
// Seguimiento de manos
// ============================================================
const calib = { cx: 0.5, cy: 0.62, size: 0.16, half: 0.13, done: false };
// Opciones de vista:
// - camFacing 'user': webcam frontal; la imagen va en espejo y un golpe hace CRECER la palma.
// - camFacing 'environment': cámara trasera del celular dentro de un visor de cartón; la cámara mira lo mismo que tú,
//   así que no hay espejo y un golpe hace ENCOGER la palma (la mano se aleja).
const VIEW = { stereo: false, camFacing: 'user', yaw: 0, pitch: 0, gyro: false, gyroQ: new THREE.Quaternion(), gyroYaw0: null };
const rearCam = () => VIEW.camFacing === 'environment';
function newHand(side) {
  return { side, present: false, lastSeen: -1e9, x: side === 'L' ? 0.38 : 0.62, y: 0.62, size: 0.16, sx: side === 'L' ? 0.38 : 0.62, sy: 0.62, ssize: 0.16, hist: [], cool: 0, lastPunch: -1e9 };
}
const hands = { L: newHand('L'), R: newHand('R') };
let lastRaw = [];
let lastHandsMs = -1e9;

// Mide centro de la palma (coordenadas espejadas 0..1) y tamaño de la palma
// (promedio de los segmentos 0-5, 0-17, 5-17, 0-9, corregido por aspecto).
function measure(lm, aspect) {
  const mx = rearCam() ? (v) => v : (v) => 1 - v; // espejo solo con la webcam frontal
  const px = (i) => mx(lm[i].x) * aspect, py = (i) => lm[i].y;
  const d = (a, b) => Math.hypot(px(a) - px(b), py(a) - py(b));
  const size = (d(0, 5) + d(0, 17) + d(5, 17) + d(0, 9)) / 4;
  let x = 0, y = 0; for (const i of [0, 5, 9, 13, 17]) { x += mx(lm[i].x); y += lm[i].y; }
  return { x: x / 5, y: y / 5, size };
}

function processHands(list, tMs, aspect = 4 / 3) {
  lastRaw = list || [];
  const ms = lastRaw.map((lm) => measure(lm, aspect));
  if (ms.length) lastHandsMs = tMs;
  const assign = { L: null, R: null };
  if (ms.length >= 2) {
    const s = ms.slice(0, 2).sort((a, b) => a.x - b.x); assign.L = s[0]; assign.R = s[1];
  } else if (ms.length === 1) {
    const m = ms[0];
    let side;
    if (!hands.L.present && !hands.R.present) side = m.x < calib.cx ? 'L' : 'R';
    else side = Math.abs(m.x - hands.L.x) <= Math.abs(m.x - hands.R.x) ? 'L' : 'R';
    assign[side] = m;
  }
  for (const k of ['L', 'R']) updateHand(hands[k], assign[k], tMs);
}

function updateHand(h, m, t) {
  if (!m) {
    if (h.present && t - h.lastSeen > 150) { checkLostPunch(h, t); h.present = false; h.hist.length = 0; }
    return;
  }
  if (!h.present) { h.sx = m.x; h.sy = m.y; h.ssize = m.size; }
  h.present = true; h.lastSeen = t; h.x = m.x; h.y = m.y; h.size = m.size;
  h.sx = lerp(h.sx, m.x, 0.5); h.sy = lerp(h.sy, m.y, 0.5); h.ssize = lerp(h.ssize, m.size, 0.5);
  h.hist.push({ t, x: m.x, y: m.y, size: m.size });
  while (h.hist.length && t - h.hist[0].t > 500) h.hist.shift();
  detectPunch(h, t);
}

function detectPunch(h, t) {
  if (t < h.cool) return;
  const win = h.hist.filter((s) => t - s.t <= CFG.punchWindow);
  if (win.length < 3) return;
  const cur = win[win.length - 1];
  // Referencia = inicio del golpe: el tamaño mínimo más reciente (frontal) o el máximo más reciente (trasera).
  const rear = rearCam();
  let mn = win[0];
  for (const s of win) if (rear ? s.size >= mn.size * 0.99 : s.size <= mn.size * 1.01) mn = s;
  const growth = rear ? mn.size / cur.size : cur.size / mn.size;
  // velocidad lateral medida desde que la palma empezó a crecer (para el gancho)
  const vxGrow = (cur.x - mn.x) / Math.max(0.033, (cur.t - mn.t) / 1000);
  const first = win[0];
  const vxWin = (cur.x - first.x) / Math.max(0.05, (cur.t - first.t) / 1000);
  const side = h.side === 'L' ? 1 : -1; // + = hacia el centro de la pantalla
  let type = null;
  if (growth >= CFG.punchGrowth && mn.t < cur.t) type = vxGrow * side > CFG.hookVx ? 'gancho' : 'recto';
  else if (vxWin * side > CFG.hookVxStrong && growth > 1.05) type = 'gancho';
  if (type) firePunch(h, type, t);
}

// Si la mano desaparece justo mientras crecía rápido (desenfoque), cuenta como golpe.
function checkLostPunch(h, t) {
  if (t < h.cool || h.hist.length < 2) return;
  const recent = h.hist.filter((s) => h.lastSeen - s.t <= 150);
  if (recent.length < 2) return;
  const sizes = recent.map((s) => s.size), last = sizes[sizes.length - 1];
  const g = rearCam() ? Math.max(...sizes) / last : last / Math.min(...sizes);
  if (g > 1.12) firePunch(h, 'recto', t);
}

function firePunch(h, type, t) {
  h.cool = t + CFG.cooldown; h.lastPunch = t;
  h.hist = h.hist.slice(-1);
  onPlayerPunch(h.side, type);
}

function handPose(tMs) {
  const L = hands.L, R = hands.R;
  const res = { guard: false, dodge: null, n: (L.present ? 1 : 0) + (R.present ? 1 : 0) };
  if (!calib.done) return res;
  if (L.present && R.present) {
    const recentPunch = tMs - Math.max(L.lastPunch, R.lastPunch) < 250;
    const up = calib.cy - L.sy > CFG.guardRaise && calib.cy - R.sy > CFG.guardRaise;
    res.guard = up && Math.abs(R.sx - L.sx) < CFG.guardMaxDx && !recentPunch;
    const mid = (L.sx + R.sx) / 2 - calib.cx;
    if (mid < -CFG.dodgeDx) res.dodge = 'izq'; else if (mid > CFG.dodgeDx) res.dodge = 'der';
  } else if (res.n === 1) {
    const h = L.present ? L : R;
    const off = h.sx - (calib.cx + (h.side === 'L' ? -calib.half : calib.half));
    if (off < -CFG.dodgeDx * 1.3) res.dodge = 'izq'; else if (off > CFG.dodgeDx * 1.3) res.dodge = 'der';
  }
  return res;
}

// ============================================================
// Cámara y MediaPipe
// ============================================================
const video = $('video');
const overlay = $('overlay');
const octx = overlay.getContext('2d');
let landmarker = null, delegateUsed = null, lastVideoTime = -1;

async function loadLandmarker() {
  if (landmarker) return landmarker;
  const vision = await import(VISION_URL);
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
  const opts = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO', numHands: 2,
    minHandDetectionConfidence: 0.5, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try { landmarker = await vision.HandLandmarker.createFromOptions(fileset, opts('GPU')); delegateUsed = 'GPU'; }
  catch (e) { console.warn('GPU no disponible, uso CPU:', e); landmarker = await vision.HandLandmarker.createFromOptions(fileset, opts('CPU')); delegateUsed = 'CPU'; }
  return landmarker;
}

async function startCamera() {
  if (video.srcObject && video.dataset.facing === VIEW.camFacing) return;
  if (video.srcObject) video.srcObject.getTracks().forEach((t) => t.stop());
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: VIEW.camFacing }, audio: false });
  video.srcObject = stream; video.dataset.facing = VIEW.camFacing;
  $('cam').classList.toggle('noMirror', rearCam());
  await video.play();
  $('camMsg').classList.add('hidden');
}

function pollCamera(tMs) {
  if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const res = landmarker.detectForVideo(video, tMs);
  processHands(res.landmarks, tMs, video.videoWidth / video.videoHeight);
  drawOverlay();
}

const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];
function drawOverlay() {
  const w = overlay.width = overlay.clientWidth * devicePixelRatio, h = overlay.height = overlay.clientHeight * devicePixelRatio;
  octx.clearRect(0, 0, w, h);
  lastRaw.forEach((lm) => {
    octx.strokeStyle = '#ffd23f'; octx.lineWidth = 3 * devicePixelRatio;
    octx.beginPath();
    for (const [a, b] of BONES) { octx.moveTo(lm[a].x * w, lm[a].y * h); octx.lineTo(lm[b].x * w, lm[b].y * h); }
    octx.stroke();
    octx.fillStyle = '#ff4f8b';
    for (const p of lm) { octx.beginPath(); octx.arc(p.x * w, p.y * h, 3 * devicePixelRatio, 0, 7); octx.fill(); }
  });
}

// ============================================================
// Estado del juego
// ============================================================
const G = {
  phase: 'menu', mode: null, round: 1, timeLeft: CFG.roundSecs, rivalIdx: 0,
  player: { hp: 100, max: 100 }, stats: null, combo: 0, lastHitT: 0,
  timers: [], shake: 0, calibProg: 0, calibSamples: [], dodgeX: 0, events: [],
};
const keys = new Set();
let R = null; // rival actual
let simMode = false;

function later(sec, fn) { G.timers.push({ at: nowS() + sec, fn }); }
function logEvent(e) { G.events.push({ t: Math.round(performance.now()), ...e }); if (G.events.length > 200) G.events.shift(); }

function setupRival(idx, override) {
  if (R) scene.remove(R.m.root);
  const def = override || RIVALS[idx];
  R = { def, hp: def.hp, max: def.hp, state: 'idle', stateT: 0, next: 1.5, atk: null, atkGlove: 'L', feint: false, resolved: false,
    attackCount: 0, recentHits: [], hitAnim: { t: 9, dx: 0 }, hurtT: 9, dodged: false, m: buildRival(def), koT: 0 };
  scene.add(R.m.root);
  for (const k of ['L', 'R']) R.m.gloves[k].pos.set(k === 'L' ? -0.42 : 0.42, 1.25, 0.45);
  if (!override) {
    $('rName').textContent = def.name.toUpperCase();
    $('menuRival').textContent = `${def.name} (${idx + 1}/${RIVALS.length})`;
  }
  updateBars(true);
}

// ============================================================
// Tu boxeador: creador de avatares (se guarda en este navegador)
// ============================================================
const AV_KEY = 'guantazo.avatar';
let PLAYER = (() => {
  try { const v = JSON.parse(localStorage.getItem(AV_KEY)); if (v && typeof v === 'object') return { ...DEFAULT_AVATAR, ...v }; } catch (e) { /* sin almacenamiento */ }
  return { ...DEFAULT_AVATAR };
})();
let draft = null;
function applyPlayer() {
  for (const k of ['L', 'R']) pGloves[k].mat.color.set(PLAYER.glove);
  document.querySelector('.side.left .name').textContent = (PLAYER.name || 'TÚ').toUpperCase();
  $('menuAvatar').textContent = PLAYER.name || 'TÚ';
}
function previewDraft() {
  setupRival(G.rivalIdx, { ...RIVALS[0], ...draft, scale: 1 });
  R.m.root.position.x = innerWidth > 760 ? 0.8 : 0;
  setRS('idle');
}
function buildCreatorUI() {
  const box = $('creatorOpts'); box.innerHTML = '';
  const row = (label) => {
    const r = document.createElement('div'); r.className = 'crow';
    const l = document.createElement('span'); l.textContent = label;
    const c = document.createElement('div'); c.className = 'cchips';
    r.append(l, c); box.appendChild(r); return c;
  };
  const choose = (k, v) => { draft[k] = v; Sfx.click(); buildCreatorUI(); previewDraft(); };
  for (const [k, o] of Object.entries(OPTIONS)) {
    const c = row(o.label);
    for (const [v, l] of o.items) {
      const b = document.createElement('button'); b.className = 'cchip' + (draft[k] === v ? ' on' : ''); b.textContent = l;
      b.onclick = () => choose(k, v); c.appendChild(b);
    }
  }
  for (const [k, o] of Object.entries(COLOR_FIELDS)) {
    const c = row(o.label);
    for (const col of o.colors) {
      const b = document.createElement('button'); b.className = 'swatch' + (draft[k] === col ? ' on' : '');
      b.style.background = col; b.setAttribute('aria-label', `${o.label} ${col}`);
      b.onclick = () => choose(k, col); c.appendChild(b);
    }
  }
}
function openCreator() {
  Sfx.ensure(); Sfx.click();
  draft = { ...PLAYER };
  $('avName').value = PLAYER.name === 'TÚ' ? '' : PLAYER.name;
  G.phase = 'creator'; showScreen('creator'); setHud(false);
  buildCreatorUI(); previewDraft();
}
function closeCreator(save) {
  if (save) {
    PLAYER = { ...draft, name: ($('avName').value.trim() || 'TÚ').slice(0, 14) };
    try { localStorage.setItem(AV_KEY, JSON.stringify(PLAYER)); } catch (e) { /* sin almacenamiento */ }
    applyPlayer();
  }
  Sfx.click(); G.phase = 'menu'; setupRival(G.rivalIdx); setRS('idle'); showScreen('menu');
}

function setRS(state, extra = {}) {
  Object.assign(R, extra); R.state = state; R.stateT = 0;
  if (state === 'tele') {
    Sfx.warn(R.atk === 'U');
    if (renderer.xr.isPresenting && xr.headBase) HEAD_WORLD.set(xr.headBase.x, headW.y, xr.headBase.z);
    else HEAD_WORLD.set(0, EYE_Y, 0.6);
    setHudMsg(R.atk === 'U' ? '¡ESQUIVA!' : '¡CUIDADO!', 0.8);
    const w = $('warn'); w.className = R.atk; w.classList.remove('hidden');
    $('warnTxt').textContent = R.atk === 'U' ? '¡Rompe-guardia! ¡Esquiva!' : R.atk === 'L' ? 'Guardia o esquiva →' : R.atk === 'R' ? '← Guardia o esquiva' : 'Guardia o esquiva';
  } else $('warn').classList.add('hidden');
  if (state === 'attack') { R.resolved = false; Sfx.whoosh(); }
  if (state === 'idle') R.next = rand(...R.def.idle);
}

function rivalThink() {
  const d = R.def;
  if (Math.random() < d.blockChance * 0.35) { setRS('block', { blockDur: rand(0.8, 1.6) }); return; }
  R.attackCount++;
  let atk = ['L', 'R', 'C'][Math.floor(Math.random() * 3)];
  if (d.breaker && R.attackCount % 4 === 0) atk = 'U';
  const feint = atk !== 'U' && Math.random() < d.feint;
  const glove = atk === 'L' ? 'L' : atk === 'R' ? 'R' : (Math.random() < 0.5 ? 'L' : 'R');
  setRS('tele', { atk, feint, atkGlove: glove, teleDur: (feint ? 0.45 : d.tele / 1000) * rand(0.9, 1.15) });
}

function updateRival(dt) {
  if (!R) return;
  R.stateT += dt;
  if (G.phase !== 'fight') return;
  switch (R.state) {
    case 'idle': if (R.stateT > R.next) rivalThink(); break;
    case 'tele':
      if (R.stateT > R.teleDur) {
        if (R.feint) { popupAtRival('¡Finta!', 'info'); setRS('idle'); } else setRS('attack');
      }
      break;
    case 'attack':
      if (!R.resolved && R.stateT >= ATTACK_TIME) { R.resolved = true; resolveRivalAttack(); }
      if (R.stateT > ATTACK_TIME + 0.12 && G.phase === 'fight') setRS('recover', { recoverDur: R.def.recover + (R.dodged ? 0.45 : 0) });
      break;
    case 'recover': if (R.stateT > R.recoverDur) { R.dodged = false; setRS('idle'); } break;
    case 'block': if (R.stateT > R.blockDur) setRS('idle'); break;
    case 'stun': if (R.stateT > 1.4) setRS('idle'); break;
  }
}

function playerDefense() {
  const hp = renderer.xr.isPresenting ? xr.pose : handPose(performance.now());
  let dodge = hp.dodge;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) dodge = 'izq';
  if (keys.has('ArrowRight') || keys.has('KeyD')) dodge = 'der';
  return { guard: hp.guard || keys.has('Space'), dodge, n: hp.n };
}

function resolveRivalAttack() {
  const pd = playerDefense();
  const a = R.atk;
  let avoided = false;
  if (pd.dodge) avoided = a === 'C' || a === 'U' || (a === 'L' && pd.dodge === 'der') || (a === 'R' && pd.dodge === 'izq');
  if (avoided) {
    G.stats.dodges++; R.dodged = true; Sfx.dodge(); popup('¡ESQUIVADO!', 'info', 50, 45);
    logEvent({ type: 'rivalAttack', atk: a, result: 'esquivado' }); return;
  }
  if (pd.guard && a !== 'U') {
    G.stats.blocks++; Sfx.block(); popup('¡BLOQUEO!', 'info', 50, 55);
    damagePlayer(Math.round(R.def.dmg * 0.15), false);
    logEvent({ type: 'rivalAttack', atk: a, result: 'bloqueado' }); return;
  }
  const dmg = Math.round(R.def.dmg * (a === 'U' ? 1.35 : 1) * rand(0.9, 1.1));
  damagePlayer(dmg, true);
  logEvent({ type: 'rivalAttack', atk: a, result: 'golpe', dmg });
}

function damagePlayer(n, big) {
  if (n <= 0) return;
  G.player.hp = Math.max(0, G.player.hp - n);
  if (big) {
    G.stats.taken += n; G.combo = 0; updateCombo();
    Sfx.hurt(); G.shake = 0.12;
    const f = $('flash'); f.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on')));
  }
  updateBars();
  if (G.player.hp <= 0 && G.phase === 'fight') playerKO();
}

function onPlayerPunch(side, type) {
  const g = pGloves[side];
  g.anim = { t: 0, type };
  logEvent({ type: 'punch', side, kind: type, phase: G.phase });
  if (G.phase !== 'fight') return;
  G.stats.thrown++;
  Sfx.whoosh();
  later(0.09, () => resolvePlayerPunch(side, type));
}

function resolvePlayerPunch(side, type) {
  if (G.phase !== 'fight' || !R || R.state === 'ko') return;
  const t = nowS();
  let dmg = type === 'gancho' ? 8 : 5;
  let label = type === 'gancho' ? '¡GANCHO!' : '¡RECTO!';
  let cls = 'good';
  if (R.state === 'block') {
    if (type === 'recto') {
      Sfx.block(); popupAtRival('¡Bloqueado!', 'info', side);
      R.m.gloves.L.mat.emissive.set('#555555'); R.m.gloves.R.mat.emissive.set('#555555');
      logEvent({ type: 'hit', result: 'bloqueado', side, kind: type });
      return;
    }
    dmg *= 0.6; label = '¡POR EL COSTADO!';
  }
  if (R.state === 'recover') { dmg *= R.dodged ? 1.9 : 1.5; label = '¡CONTRAGOLPE!'; }
  if (R.state === 'stun') dmg *= 1.3;
  G.combo = t - G.lastHitT < 1.6 ? G.combo + 1 : 1;
  G.lastHitT = t;
  G.stats.maxCombo = Math.max(G.stats.maxCombo, G.combo);
  dmg *= 1 + Math.min(G.combo - 1, 10) * 0.05;
  dmg = Math.round(dmg * 10) / 10;
  R.hp = Math.max(0, R.hp - dmg);
  G.stats.landed++;
  Sfx.hit(type === 'gancho' || label === '¡CONTRAGOLPE!');
  R.hitAnim = { t: 0, dx: side === 'L' ? 1 : -1 }; R.hurtT = 0;
  showBurst(side);
  popupAtRival(G.combo >= 3 ? `${label} x${G.combo}` : label, cls, side);
  updateBars(); updateCombo();
  logEvent({ type: 'hit', result: 'conectado', side, kind: type, dmg, rivalHp: R.hp });
  if (R.hp <= 0) { rivalKO(); return; }
  R.recentHits = R.recentHits.filter((h) => t - h < 1.3); R.recentHits.push(t);
  if (R.recentHits.length >= 3 && R.state !== 'stun') { R.recentHits = []; setRS('stun'); popupAtRival('¡MAREADO!', 'info'); return; }
  if ((R.state === 'idle') && Math.random() < R.def.blockChance) later(0.15, () => { if (R.state === 'idle' && G.phase === 'fight') setRS('block', { blockDur: rand(0.7, 1.3) }); });
}

function rivalKO() {
  setRS('ko'); G.phase = 'ko';
  bigText('¡K.O.!', 2);
  Sfx.ko(); Sfx.cheer(); launchConfetti();
  later(3.2, () => showResult('win', 'Por nocaut'));
}

function playerKO() {
  G.phase = 'down';
  setRS('win');
  bigText('¡AL SUELO!', 2);
  Sfx.lose();
  later(2.8, () => showResult('lose', 'Te noquearon'));
}

// ============================================================
// Flujo: menú → calibración → rounds → resultado
// ============================================================
function hideScreens() { for (const id of ['menu', 'loading', 'calib', 'between', 'result', 'creator']) $(id).classList.add('hidden'); }
function showScreen(id) { hideScreens(); $(id).classList.remove('hidden'); }
function setHud(on) { for (const id of ['hud', 'counters']) $(id).classList.toggle('hidden', !on); }

async function start(mode) {
  Sfx.ensure(); Sfx.click();
  G.mode = mode;
  if (mode === 'camera') {
    showScreen('loading'); $('loadBtns').classList.add('hidden');
    $('loadTitle').textContent = 'Preparando el ring…';
    try {
      $('loadMsg').textContent = 'Pidiendo permiso para la cámara…';
      await startCamera();
      $('loadMsg').textContent = 'Cargando el detector de manos (MediaPipe)…';
      await loadLandmarker();
      console.log('Hand Landmarker listo con delegate', delegateUsed);
    } catch (e) {
      console.warn('No se pudo iniciar la cámara o el detector:', e);
      $('loadTitle').textContent = 'Uy, sin cámara';
      $('loadMsg').textContent = `No pude usar la cámara o el detector (${e.name || 'error'}: ${e.message || e}). Revisa los permisos de cámara del navegador o juega con teclado.`;
      $('loadBtns').classList.remove('hidden');
      return;
    }
    beginCalibration();
  } else if (mode === 'vr') {
    calib.done = true; startMatch(); // en VR se juega con los controles o las manos del visor
  } else if (mode === 'sim') {
    simMode = true; beginCalibration();
  } else {
    calib.done = true; startMatch();
  }
}

function beginCalibration() {
  calib.done = false; G.calibProg = 0; G.calibSamples = [];
  G.phase = 'calib'; showScreen('calib'); setHud(false);
}

function updateCalibration(dt) {
  const n = (hands.L.present ? 1 : 0) + (hands.R.present ? 1 : 0);
  $('calibMsg').textContent = `Manos detectadas: ${n} / 2`;
  if (n === 2 && hands.R.sx - hands.L.sx > 0.08) {
    G.calibProg += dt / 1.2;
    G.calibSamples.push({ cx: (hands.L.sx + hands.R.sx) / 2, cy: (hands.L.sy + hands.R.sy) / 2, size: (hands.L.ssize + hands.R.ssize) / 2, half: (hands.R.sx - hands.L.sx) / 2 });
  } else G.calibProg = Math.max(0, G.calibProg - dt);
  $('calibFill').style.width = `${Math.min(100, G.calibProg * 100)}%`;
  if (G.calibProg >= 1) {
    const s = G.calibSamples.slice(-30);
    const avg = (k) => s.reduce((a, b) => a + b[k], 0) / s.length;
    Object.assign(calib, { cx: avg('cx'), cy: avg('cy'), size: avg('size'), half: avg('half'), done: true });
    logEvent({ type: 'calibrated', ...calib });
    Sfx.click();
    startMatch();
  }
}

function startMatch() {
  setupRival(G.rivalIdx);
  G.round = 1; G.player.hp = G.player.max; G.combo = 0;
  G.stats = { thrown: 0, landed: 0, maxCombo: 0, dodges: 0, blocks: 0, taken: 0 };
  confetti.visible = false;
  updateBars(true); updateCombo();
  startRound();
}

function startRound() {
  G.timeLeft = CFG.roundSecs; G.phase = 'intro';
  hideScreens(); setHud(true);
  setRS('idle');
  $('roundLbl').textContent = `ROUND ${G.round}`; updateTimer();
  bigText(`ROUND ${G.round}`, 1.3);
  later(1.5, () => {
    if (G.phase !== 'intro') return;
    Sfx.bell(1); bigText('¡A PELEAR!', 1); G.phase = 'fight'; setRS('idle');
  });
}

function endRound() {
  Sfx.bell(3); setRS('idle');
  if (G.round >= CFG.rounds) {
    const p = G.player.hp / G.player.max, r = R.hp / R.max;
    G.phase = 'decision';
    bigText('¡TIEMPO!', 1.5);
    later(1.8, () => showResult(p > r ? 'win' : p < r ? 'lose' : 'draw', 'Decisión de los jueces'));
    if (p > r) { Sfx.cheer(); launchConfetti(); }
    return;
  }
  G.phase = 'between';
  $('betweenTitle').textContent = `Fin del round ${G.round}`;
  $('betweenStats').innerHTML = statsHtml();
  showScreen('between');
  let n = 5;
  const tick = () => {
    if (G.phase !== 'between') return;
    $('betweenMsg').textContent = `Siguiente round en ${n}…`;
    if (n-- <= 0) {
      G.player.hp = Math.min(G.player.max, G.player.hp + 20); R.hp = Math.min(R.max, R.hp + 10);
      updateBars(true); G.round++; startRound();
    } else later(1, tick);
  };
  tick();
}

function statsHtml() {
  const s = G.stats; const acc = s.thrown ? Math.round(s.landed / s.thrown * 100) : 0;
  return [[s.landed, 'golpes conectados'], [s.thrown, 'golpes lanzados'], [`${acc}%`, 'precisión'], [s.maxCombo, 'combo máximo'], [s.dodges, 'esquivas'], [s.blocks, 'bloqueos']]
    .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
}

function showResult(kind, sub) {
  G.phase = 'result'; setHud(false); $('warn').classList.add('hidden');
  const last = G.rivalIdx >= RIVALS.length - 1;
  $('resultTitle').textContent = kind === 'win' ? (last ? '¡CAMPEÓN!' : '¡VICTORIA!') : kind === 'lose' ? 'DERROTA' : 'EMPATE';
  $('resultSub').textContent = `${sub} · vs ${R.def.name}${kind === 'win' && last ? ' · ¡Venciste a todos los rivales!' : ''}`;
  $('resultStats').innerHTML = statsHtml();
  $('btnNext').classList.toggle('hidden', !(kind === 'win' && !last));
  $('btnRetry').textContent = kind === 'win' ? 'Repetir pelea' : 'Revancha';
  showScreen('result');
  setHudMsg(`${$('resultTitle').textContent} · gatillo: seguir`, 9999);
  logEvent({ type: 'result', kind });
}

// ============================================================
// UI
// ============================================================
function updateBars(instant) {
  const set = (fill, ghost, v) => {
    $(fill).style.transform = `scaleX(${v})`;
    if (instant) $(ghost).style.transition = 'none';
    $(ghost).style.transform = `scaleX(${v})`;
    if (instant) requestAnimationFrame(() => ($(ghost).style.transition = ''));
  };
  set('pHp', 'pGhost', G.player.hp / G.player.max);
  if (R) set('rHp', 'rGhost', R.hp / R.max);
  if (G.stats) $('hits').textContent = G.stats.landed;
}
function updateCombo() { $('combo').textContent = G.combo; $('comboBox').classList.toggle('on', G.combo >= 2); }
function updateTimer() { const s = Math.max(0, Math.ceil(G.timeLeft)); $('timer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function bigText(txt) { setHudMsg(txt, 1.4); const b = $('big'); b.textContent = txt; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); }
function popup(txt, cls, xPct, yPct) {
  setHudMsg(txt);
  const d = document.createElement('div'); d.className = `popup ${cls}`; d.textContent = txt;
  d.style.left = `${xPct}%`; d.style.top = `${yPct}%`;
  $('popups').appendChild(d); setTimeout(() => d.remove(), 950);
}
const tmpV = new THREE.Vector3();
function rivalHeadScreen() {
  R.m.head.getWorldPosition(tmpV); tmpV.y += 0.25 * (R.def.scale || 1); tmpV.project(camera);
  return { x: (tmpV.x + 1) * 50, y: (1 - tmpV.y) * 50 };
}
function popupAtRival(txt, cls, side) {
  const p = rivalHeadScreen();
  popup(txt, cls, p.x + (side === 'L' ? -8 : side === 'R' ? 8 : 0), p.y - 6);
}
function showBurst(side) {
  R.m.head.getWorldPosition(tmpV);
  burst.position.copy(tmpV).add(new THREE.Vector3(side === 'L' ? -0.25 : 0.25, 0.2, 0.4));
  burst.visible = true; burstT = 0;
}

// ============================================================
// Animación por frame
// ============================================================
const tmpQ = new THREE.Quaternion();
function animatePlayerGloves(dt, tMs, pose) {
  if (renderer.xr.isPresenting) return; // en VR los guantes siguen a los controles (updateXR)
  const camMode = tMs - lastHandsMs < 400 && calib.done;
  for (const k of ['L', 'R']) {
    const g = pGloves[k], h = hands[k], s = k === 'L' ? -1 : 1;
    const target = new THREE.Vector3();
    if (camMode && h.present) {
      const rel = rearCam() ? 1 - h.ssize / calib.size : h.ssize / calib.size - 1; // acercar = golpear
      const depth = clamp(rel * 0.45, -0.18, 0.4);
      target.set((h.sx - calib.cx) * 1.3, -(h.sy - calib.cy) * 1.05 - 0.25, -0.7 - depth);
    } else if (pose.guard) target.set(s * 0.11, -0.05, -0.5);
    else target.set(s * 0.3, -0.27, -0.7);
    // animación de golpe
    let rotZ = 0;
    if (g.anim) {
      g.anim.t += dt; const p = g.anim.t / 0.28;
      if (p >= 1) g.anim = null;
      else {
        const ext = (p < 0.35 ? p / 0.35 : 1 - (p - 0.35) / 0.65) * (camMode ? 0.6 : 1);
        if (g.anim.type === 'gancho') { target.x += -s * Math.sin(ext * Math.PI * 0.5) * 0.3; target.z -= ext * 0.55; target.y += ext * 0.08; rotZ = -s * ext * 1.2; }
        else { target.x += -s * ext * 0.15; target.z -= ext * 0.75; target.y += ext * 0.1; }
      }
    }
    g.pos.lerp(target, g.anim ? 0.6 : 0.35);
    g.group.position.copy(g.pos);
    g.group.rotation.set(0, 0, rotZ + s * -0.15);
  }
}

function animateRival(dt, t) {
  if (!R) return;
  const m = R.m, st = R.state, sc = 1;
  const bob = Math.sin(t * 4.2) * 0.03, weave = Math.sin(t * 1.7) * 0.12;
  const gl = { L: new THREE.Vector3(-0.42, 1.25 + bob, 0.45), R: new THREE.Vector3(0.42, 1.25 - bob, 0.45) };
  let bodyX = weave, bodyLean = 0, bodyY = bob, glowL = 0, glowR = 0, glowCol = '#ffd23f', k = 0.18;
  let brow = 0, eyeSq = 1, smile = true;
  m.stars.visible = false; m.bang.visible = false;
  if (st === 'block') {
    gl.L.set(-0.15, 1.72, 0.6); gl.R.set(0.15, 1.72, 0.6); bodyLean = 0.12; k = 0.35; brow = 0.25;
  } else if (st === 'tele') {
    const a = R.atkGlove, s = a === 'L' ? -1 : 1, o = a === 'L' ? 'R' : 'L';
    const pulse = 0.5 + 0.5 * Math.sin(t * 30);
    if (R.atk === 'U') { gl[a].set(s * 0.25, 0.75, 0.2); glowCol = '#c77dff'; }
    else if (R.atk === 'C') gl[a].set(s * 0.3, 1.5, -0.25);
    else gl[a].set(s * 0.75, 1.55, -0.1);
    gl[o].set(-s * 0.18, 1.65, 0.55);
    if (a === 'L') glowL = pulse; else glowR = pulse;
    bodyX = s * 0.1; bodyLean = -0.1; brow = 0.45; smile = false; k = 0.25;
    m.bang.visible = true; m.bang.scale.setScalar(0.4 + pulse * 0.1);
  } else if (st === 'attack') {
    const a = R.atkGlove, s = a === 'L' ? -1 : 1, o = a === 'L' ? 'R' : 'L';
    const p = clamp(R.stateT / ATTACK_TIME, 0, 1), e = p * p;
    const from = R.atk === 'U' ? new THREE.Vector3(s * 0.25, 0.75, 0.2) : R.atk === 'C' ? new THREE.Vector3(s * 0.3, 1.5, -0.25) : new THREE.Vector3(s * 0.75, 1.55, -0.1);
    // destino: frente a la cara del jugador (en VR, donde está tu cabeza al empezar el aviso)
    const off = R.atk === 'C' ? [s * 0.06, 0, -0.15] : R.atk === 'U' ? [0, -0.05, -0.2] : [s * 0.22, 0.03, -0.2];
    const to = R.m.root.worldToLocal(new THREE.Vector3(...off).add(HEAD_WORLD));
    gl[a].copy(from).lerp(to, e);
    if (R.atk === 'L' || R.atk === 'R') gl[a].x += s * Math.sin(e * Math.PI) * 0.4;
    gl[o].set(-s * 0.18, 1.65, 0.55);
    bodyLean = 0.25 * e; bodyX = s * 0.08; brow = 0.45; smile = false; k = 1;
    if (a === 'L') glowL = 1; else glowR = 1;
    if (R.atk === 'U') glowCol = '#c77dff';
  } else if (st === 'recover') {
    gl.L.set(-0.45, 0.95, 0.35); gl.R.set(0.45, 0.95, 0.35); bodyLean = R.dodged ? 0.2 : 0.08; eyeSq = R.dodged ? 1.3 : 1; brow = -0.2;
  } else if (st === 'stun') {
    gl.L.set(-0.5, 0.9, 0.3); gl.R.set(0.5, 0.9, 0.3); bodyX = Math.sin(t * 6) * 0.15; m.stars.visible = true; m.stars.rotation.y = t * 5; eyeSq = 0.4; smile = false;
  } else if (st === 'ko') {
    R.koT += dt; const p = clamp(R.koT / 0.7, 0, 1);
    m.body.rotation.x = -p * 1.45; m.body.position.z = -p * 0.4; m.body.position.y = 0;
    gl.L.set(-0.6, 0.25, -0.7 * p); gl.R.set(0.6, 0.25, -0.7 * p);
    m.stars.visible = true; m.stars.rotation.y = t * 4; eyeSq = 0.12; smile = false;
  } else if (st === 'win') {
    const hop = Math.abs(Math.sin(t * 7)) * 0.15;
    gl.L.set(-0.45, 2.2 + hop, 0.2); gl.R.set(0.45, 2.2 + hop, 0.2); bodyY = hop;
  }
  if (st !== 'ko') { m.body.rotation.x = lerp(m.body.rotation.x, bodyLean, 0.2); m.body.position.z = 0; }
  // reacción al golpe
  R.hitAnim.t += dt; R.hurtT += dt;
  const ha = Math.max(0, 1 - R.hitAnim.t / 0.35);
  m.head.position.x = R.hitAnim.dx * 0.12 * ha;
  m.head.rotation.z = -R.hitAnim.dx * 0.35 * ha;
  m.head.rotation.y = R.hitAnim.dx * 0.4 * ha;
  if (st !== 'ko') { m.body.position.x = lerp(m.body.position.x, bodyX + R.hitAnim.dx * 0.1 * ha, 0.15); m.body.position.y = bodyY; }
  if (R.hurtT < 0.25) { eyeSq = 0.2; smile = false; }
  m.eyes.forEach((e) => (e.scale.y = e.userData.sy * eyeSq));
  m.pupils.forEach((p) => (p.scale.y = p.userData.sy * Math.min(1, eyeSq)));
  m.brows[0].rotation.z = m.brows[0].userData.rz - brow; m.brows[1].rotation.z = m.brows[1].userData.rz + brow;
  m.mouth.rotation.z = smile ? Math.PI : 0;
  m.mouth.position.y = m.mouth.userData.y - (smile ? 0 : 0.04);
  m.root.rotation.y = G.phase === 'creator' ? Math.sin(t * 0.7) * 0.6 : 0;
  for (const g of ['L', 'R']) {
    const gm = m.gloves[g];
    gm.pos.lerp(gl[g], k);
    gm.group.position.copy(gm.pos).add(new THREE.Vector3(m.body.position.x, 0, 0));
    const glow = g === 'L' ? glowL : glowR;
    if (glow > 0) gm.mat.emissive.set(glowCol).multiplyScalar(glow * 0.7);
    else gm.mat.emissive.lerp(new THREE.Color(0, 0, 0), 0.15);
    gm.group.scale.setScalar(1 + glow * 0.25);
  }
  updateArms(m);
  for (const k of ['L', 'R']) pGloves[k].group.visible = G.phase !== 'creator';
}

// ---------- Mirar alrededor: arrastrar con el mouse/dedo o giroscopio ----------
const lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const ZEE = new THREE.Vector3(0, 0, 1), Q_SCREEN = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)), qTmp = new THREE.Quaternion();
function onDeviceOrientation(e) {
  if (e.alpha == null) return;
  const deg = Math.PI / 180;
  if (VIEW.gyroYaw0 === null) VIEW.gyroYaw0 = e.alpha * deg; // la dirección inicial mira al rival
  const orient = (screen.orientation?.angle || 0) * deg;
  lookEuler.set(e.beta * deg, e.alpha * deg - VIEW.gyroYaw0, -e.gamma * deg, 'YXZ');
  VIEW.gyroQ.setFromEuler(lookEuler).multiply(Q_SCREEN).multiply(qTmp.setFromAxisAngle(ZEE, -orient));
}
async function enableGyro() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') return;
    }
    VIEW.gyro = !VIEW.gyro; VIEW.gyroYaw0 = null;
    if (VIEW.gyro) addEventListener('deviceorientation', onDeviceOrientation);
    else removeEventListener('deviceorientation', onDeviceOrientation);
    $('btnGyro').classList.toggle('on', VIEW.gyro);
  } catch (e) { console.warn('Giroscopio no disponible:', e); }
}
function recenter() { VIEW.yaw = 0; VIEW.pitch = 0; VIEW.gyroYaw0 = null; xr.headBase = null; }
{
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || VIEW.gyro) return;
    VIEW.yaw -= (e.clientX - drag.x) * 0.004; VIEW.pitch = clamp(VIEW.pitch - (e.clientY - drag.y) * 0.004, -1.2, 1.2);
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener('dblclick', recenter);
}

function setStereo(on) {
  VIEW.stereo = on;
  document.body.classList.toggle('stereo', on);
  $('btnStereo').classList.toggle('on', on);
  if ($('optView')) $('optView').value = on ? 'stereo' : 'normal';
  if (on && matchMedia('(pointer: coarse)').matches) {
    document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  }
  resize();
}

// ---------- Marcador 3D (visible en VR, donde el HUD HTML no se ve) ----------
const hudCanvas = document.createElement('canvas'); hudCanvas.width = 1024; hudCanvas.height = 300;
const hudTex = new THREE.CanvasTexture(hudCanvas); hudTex.colorSpace = THREE.SRGBColorSpace;
const hud3d = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.76), new THREE.MeshBasicMaterial({ map: hudTex, transparent: true, fog: false, depthTest: false }));
hud3d.position.set(0, 2.85, -2.7); hud3d.renderOrder = 20; hud3d.visible = false; scene.add(hud3d);
const hudMsg = { text: '', until: 0 };
let hudDrawn = '';
function setHudMsg(text, secs = 1.1) { hudMsg.text = text; hudMsg.until = nowS() + secs; }
function drawHud3d() {
  const msg = nowS() < hudMsg.until ? hudMsg.text : '';
  const key = [G.player.hp, R?.hp, Math.ceil(G.timeLeft), G.round, G.phase, msg, G.combo].join('|');
  if (key === hudDrawn) return; hudDrawn = key;
  const g = hudCanvas.getContext('2d'), W = 1024;
  g.clearRect(0, 0, W, 300);
  const font = (px) => `800 ${px}px "M PLUS Rounded 1c", "Nunito", sans-serif`;
  const panel = (x, y, w, h, r, col) => { g.fillStyle = col; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); };
  panel(0, 0, W, 150, 40, 'rgba(255,255,255,0.92)');
  const bar = (x, w, v, col, right) => {
    panel(x, 78, w, 44, 22, '#d5deea');
    const fw = Math.max(0, w * v); panel(right ? x + w - fw : x, 78, fw, 44, 22, col);
  };
  g.fillStyle = '#2c3e57'; g.font = font(34); g.textBaseline = 'middle';
  g.textAlign = 'left'; g.fillText(PLAYER.name || 'TÚ', 40, 46);
  g.textAlign = 'right'; g.fillText(R ? R.def.name : '', W - 40, 46);
  bar(30, 380, G.player.hp / G.player.max, '#4cc46e', false);
  if (R) bar(W - 410, 380, R.hp / R.max, '#ff6b6b', true);
  const s = Math.max(0, Math.ceil(G.timeLeft));
  g.textAlign = 'center'; g.fillStyle = '#4f8fd6'; g.font = font(26); g.fillText(`ROUND ${G.round}`, W / 2, 38);
  g.fillStyle = '#2c3e57'; g.font = font(56); g.fillText(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, W / 2, 98);
  if (msg) { panel(W / 2 - 330, 170, 660, 110, 55, '#4f8fd6'); g.fillStyle = '#fff'; g.font = font(62); g.fillText(msg, W / 2, 228); }
  hudTex.needsUpdate = true;
}

// ---------- WebXR (visores): guantes = controles o manos del visor ----------
const xr = { inputs: [], headBase: null, hist: { L: [], R: [] }, cool: { L: 0, R: 0 }, lastPunch: 0, pose: { guard: false, dodge: null, n: 0 } };
const headW = new THREE.Vector3(), xrQ = new THREE.Quaternion();
for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i), grip = renderer.xr.getControllerGrip(i), hand = renderer.xr.getHand(i);
  rig.add(ctrl, grip, hand);
  const inp = { ctrl, grip, hand, side: null };
  ctrl.addEventListener('connected', (e) => { inp.side = e.data.handedness === 'left' ? 'L' : e.data.handedness === 'right' ? 'R' : null; });
  ctrl.addEventListener('disconnected', () => (inp.side = null));
  ctrl.addEventListener('selectstart', () => {
    if (G.phase === 'result') { if ($('btnNext').classList.contains('hidden')) startMatch(); else $('btnNext').click(); }
    else if (G.phase === 'menu') start('vr');
  });
  xr.inputs.push(inp);
}
function xrInputPose(inp, pos) {
  if (inp.grip.visible) { inp.grip.getWorldPosition(pos); inp.grip.getWorldQuaternion(xrQ); return true; }
  const w = inp.hand.joints?.wrist;
  if (w && w.visible) { w.getWorldPosition(pos); w.getWorldQuaternion(xrQ); return true; }
  return false;
}
function updateXR(tMs) {
  camera.getWorldPosition(headW);
  if (!xr.headBase) xr.headBase = headW.clone();
  const pos = {}; let n = 0;
  for (const inp of xr.inputs) {
    if (!inp.side) continue;
    const p = new THREE.Vector3();
    if (!xrInputPose(inp, p)) continue;
    n++; pos[inp.side] = p;
    const g = pGloves[inp.side]; g.group.position.copy(p); g.group.quaternion.copy(xrQ);
    const h = xr.hist[inp.side]; h.push({ t: tMs, p: p.clone() });
    while (h.length && tMs - h[0].t > 120) h.shift();
    const a = h[0], dtS = (tMs - a.t) / 1000;
    if (h.length >= 3 && dtS > 0.03 && tMs > xr.cool[inp.side]) {
      const v = p.clone().sub(a.p).divideScalar(dtS);
      const fwd = -v.z, inward = inp.side === 'L' ? v.x : -v.x; // el rival está hacia -z
      if (fwd > 1.6 || (inward > 2.0 && fwd > 0.5)) {
        xr.cool[inp.side] = tMs + 350; xr.lastPunch = tMs;
        onPlayerPunch(inp.side, inward > Math.max(1.0, fwd * 0.7) ? 'gancho' : 'recto');
      }
    }
  }
  const near = (p) => p && p.distanceTo(headW) < 0.4 && p.y > headW.y - 0.35;
  xr.pose.guard = near(pos.L) && near(pos.R) && tMs - xr.lastPunch > 250;
  const dx = headW.x - xr.headBase.x;
  xr.pose.dodge = dx < -0.18 ? 'izq' : dx > 0.18 ? 'der' : null;
  xr.pose.n = n;
}
async function enterXR() {
  Sfx.ensure(); Sfx.click(); // crear el audio dentro del clic: el navegador del Quest bloquea el sonido creado después
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    await renderer.xr.setSession(session);
  } catch (e) { console.warn('No se pudo entrar a VR:', e); alert(`No se pudo entrar a VR: ${e.message || e}`); }
}
renderer.xr.addEventListener('sessionstart', () => {
  for (const k of ['L', 'R']) { scene.add(pGloves[k].group); pGloves[k].group.rotation.set(0, 0, 0); }
  xr.headBase = null; document.body.classList.add('xr');
  if (G.phase === 'menu' || G.phase === 'result' || G.phase === 'loading') start('vr');
});
renderer.xr.addEventListener('sessionend', () => {
  for (const k of ['L', 'R']) { camera.add(pGloves[k].group); pGloves[k].group.quaternion.identity(); }
  document.body.classList.remove('xr');
  camera.position.set(0, EYE_Y, 0);
});
navigator.xr?.isSessionSupported?.('immersive-vr').then((ok) => { if (ok) $('btnXR').classList.remove('hidden'); }).catch(() => {});

function updateCamera(dt, pose) {
  if (renderer.xr.isPresenting) return; // en VR la cámara la mueve el visor
  const tx = pose.dodge === 'izq' ? -0.45 : pose.dodge === 'der' ? 0.45 : 0;
  G.dodgeX = lerp(G.dodgeX, tx, 0.18);
  camera.position.set(G.dodgeX, EYE_Y - Math.abs(G.dodgeX) * 0.15 - (pose.guard ? 0.04 : 0), 0);
  if (VIEW.gyro) camera.quaternion.copy(VIEW.gyroQ);
  else camera.quaternion.setFromEuler(lookEuler.set(BASE_PITCH + VIEW.pitch, VIEW.yaw, 0, 'YXZ'));
  camera.rotateZ(-G.dodgeX * 0.25);
  if (G.phase === 'down') { camera.rotateZ(0.5); camera.position.y -= 0.6; }
  if (G.shake > 0) {
    G.shake = Math.max(0, G.shake - dt);
    camera.position.x += rand(-1, 1) * G.shake * 0.6; camera.position.y += rand(-1, 1) * G.shake * 0.6;
  }
}

function updateChips(pose) {
  $('chipHands').textContent = `✋ ${pose.n}`;
  $('chipHands').classList.toggle('on', pose.n === 2);
  $('chipGuard').classList.toggle('on', pose.guard);
  $('chipDodge').textContent = pose.dodge === 'izq' ? '⇠ esquiva' : pose.dodge === 'der' ? 'esquiva ⇢' : '↔ esquiva';
  $('chipDodge').classList.toggle('on', !!pose.dodge);
}

let lastT = nowS();
function step() {
  const tMs = performance.now(), t = tMs / 1000;
  const dt = Math.min(0.05, t - lastT); lastT = t;
  pollCamera(tMs);
  if (renderer.xr.isPresenting) updateXR(tMs);
  // timers
  const due = G.timers.filter((x) => x.at <= t); G.timers = G.timers.filter((x) => x.at > t);
  due.forEach((x) => x.fn());
  if (G.phase === 'calib') updateCalibration(dt);
  if (G.phase === 'fight') {
    G.timeLeft -= dt; updateTimer();
    if (G.timeLeft <= 0) endRound();
  }
  updateRival(dt);
  const pd = playerDefense();
  const camLost = (G.mode === 'camera' || simMode) && G.phase === 'fight' && tMs - lastHandsMs > 2000;
  $('hint').classList.toggle('hidden', !camLost);
  if (camLost) $('hint').textContent = 'No veo tus manos: ponlas frente a la cámara';
  updateChips(pd);
  animatePlayerGloves(dt, tMs, pd);
  animateRival(dt, t);
  updateCamera(dt, pd);
  updateConfetti(dt, t);
  burstT += dt; burst.visible = burstT < 0.18; burst.scale.setScalar(0.4 + burstT * 3);
  hud3d.visible = VIEW.stereo || renderer.xr.isPresenting;
  if (hud3d.visible) drawHud3d();
  if (VIEW.stereo && !renderer.xr.isPresenting) stereo.render(scene, camera);
  else renderer.render(scene, camera);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); stereo.setSize(w, h);
  const aspect = VIEW.stereo ? w / 2 / h : w / h; // en pantalla dividida cada ojo usa la mitad del ancho
  camera.aspect = aspect;
  camera.fov = VIEW.stereo ? 80 : aspect < 1 ? 85 : 66; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ============================================================
// Controles
// ============================================================
$('btnCam').onclick = () => start('camera');
$('btnKey').onclick = () => start('keyboard');
$('btnFallback').onclick = () => start('keyboard');
$('btnBack1').onclick = () => { Sfx.click(); showScreen('menu'); };
$('btnNext').onclick = () => { G.rivalIdx = Math.min(RIVALS.length - 1, G.rivalIdx + 1); Sfx.ensure(); startMatch(); };
$('btnRetry').onclick = () => { Sfx.ensure(); startMatch(); };
$('btnMenu').onclick = () => { Sfx.click(); G.phase = 'menu'; setHud(false); confetti.visible = false; setupRival(G.rivalIdx); setRS('idle'); showScreen('menu'); };

const KEY_PUNCH = { KeyF: ['L', 'recto'], KeyJ: ['R', 'recto'], KeyR: ['L', 'gancho'], KeyU: ['R', 'gancho'] };
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (KEY_PUNCH[e.code]) { Sfx.ensure(); onPlayerPunch(...KEY_PUNCH[e.code]); }
  if (e.code === 'Enter' && G.phase === 'menu') start('keyboard');
  if (e.code === 'KeyV') setStereo(!VIEW.stereo);
  if (e.code === 'KeyC') recenter();
  if (['Space', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// Opciones del menú: vista, cámara e imagen 360
$('optView').onchange = (e) => setStereo(e.target.value === 'stereo');
$('optCam').onchange = (e) => { VIEW.camFacing = e.target.value; };
$('file360').onchange = (e) => loadPanoFromFile(e.target.files[0]);
$('btnPanoReset').onclick = () => useGeneratedPano();
$('btnXR').onclick = enterXR;
$('btnStereo').onclick = () => setStereo(!VIEW.stereo);
$('btnGyro').onclick = enableGyro;
$('btnCenter').onclick = recenter;
addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dropping'); });
addEventListener('dragleave', () => document.body.classList.remove('dropping'));
addEventListener('drop', (e) => { e.preventDefault(); document.body.classList.remove('dropping'); loadPanoFromFile(e.dataTransfer.files[0]); });
if (!('DeviceOrientationEvent' in window) || !matchMedia('(pointer: coarse)').matches) $('btnGyro').classList.add('hidden');

$('btnAvatar').onclick = openCreator;
$('btnAvRandom').onclick = () => { draft = randomAvatar(draft.name); Sfx.click(); buildCreatorUI(); previewDraft(); };
$('btnAvSave').onclick = () => closeCreator(true);
$('btnAvCancel').onclick = () => closeCreator(false);

setupRival(0);
applyPlayer();
renderer.setAnimationLoop(step); // igual que requestAnimationFrame, pero también funciona dentro de WebXR

// ============================================================
// API de depuración (para pruebas con manos simuladas)
// ============================================================
function fakeHand(cx, cy, s) {
  // 21 landmarks en coordenadas de imagen SIN espejo (como entrega MediaPipe)
  const P = (dx, dy) => ({ x: cx + dx * s, y: cy + dy * s, z: 0 });
  const lm = [P(0, 0.55)];
  [[-0.3, 0.4], [-0.45, 0.25], [-0.55, 0.1], [-0.6, -0.05]].forEach(([a, b]) => lm.push(P(a, b)));
  const mcp = [[-0.3, -0.3], [-0.1, -0.35], [0.1, -0.33], [0.28, -0.28]];
  mcp.forEach(([a, b]) => { lm.push(P(a, b)); for (let j = 1; j <= 3; j++) lm.push(P(a, b - j * 0.22)); });
  return lm;
}
window.boxeo = {
  start, processHands, fakeHand, onPlayerPunch, hands, calib, CFG,
  VIEW, camera, recenter, openCreator, closeCreator, get player() { return PLAYER; }, hud3d, setStereo, loadPanoFromUrl, useGeneratedPano, xr,
  get state() {
    return { phase: G.phase, mode: G.mode, round: G.round, timeLeft: +G.timeLeft.toFixed(1), playerHp: G.player.hp,
      rival: R && { name: R.def.name, hp: R.hp, state: R.state }, stats: G.stats, combo: G.combo, pose: handPose(performance.now()), delegate: delegateUsed };
  },
  events: G.events,
  loadLandmarker,
  tick: step, // avanza un frame a mano (útil si la pestaña está oculta y no corre requestAnimationFrame)
  setRivalState: (s, extra) => setRS(s, extra),
  freezeRival(on = true) { R.next = on ? 1e9 : 1; },
};
