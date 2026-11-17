// Sistema de avatares ORIGINAL de ¡Guantazo!: personajes simples armados con piezas (cara, pelo, ojos, cejas, nariz, boca, extras).
// Diseño propio; no reproduce personajes de otros juegos.
import * as THREE from 'three';

export const SKINS = ['#ffe3cc', '#f6c9a0', '#e2a877', '#c58550', '#8d5a3b', '#5c3a26'];
export const HAIR_COLORS = ['#2b1d16', '#5a3825', '#a0522d', '#d8a656', '#f2d27a', '#b9b9c2', '#e86a5c', '#6c5ce7'];
export const CLOTH = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#748ffc', '#da77f2', '#f783ac', '#f1f3f5', '#343a40'];

export const OPTIONS = {
  face: { label: 'Cara', items: [['redonda', 'Redonda'], ['ovalada', 'Ovalada'], ['ancha', 'Ancha']] },
  hair: { label: 'Peinado', items: [['corto', 'Corto'], ['puntas', 'Puntas'], ['melena', 'Melena'], ['mono', 'Moño'], ['rizos', 'Rizos'], ['rapado', 'Rapado'], ['calvo', 'Sin pelo']] },
  eyes: { label: 'Ojos', items: [['normal', 'Normales'], ['punto', 'Puntitos'], ['grande', 'Grandes'], ['feliz', 'Felices']] },
  brows: { label: 'Cejas', items: [['recta', 'Rectas'], ['arco', 'Arqueadas'], ['gruesa', 'Gruesas']] },
  nose: { label: 'Nariz', items: [['boton', 'Botón'], ['larga', 'Larga'], ['ancha', 'Ancha']] },
  mouth: { label: 'Boca', items: [['sonrisa', 'Sonrisa'], ['amplia', 'Amplia'], ['chica', 'Chica']] },
  extra: { label: 'Extra', items: [['nada', 'Nada'], ['cintillo', 'Cintillo'], ['mejillas', 'Mejillas'], ['bigote', 'Bigote']] },
};
export const COLOR_FIELDS = {
  skin: { label: 'Piel', colors: SKINS },
  hairColor: { label: 'Pelo', colors: HAIR_COLORS },
  shirt: { label: 'Polera', colors: CLOTH },
  shorts: { label: 'Short', colors: CLOTH },
  glove: { label: 'Guantes', colors: CLOTH },
};

export const DEFAULT_AVATAR = {
  name: 'TÚ', skin: SKINS[1], face: 'redonda', hair: 'corto', hairColor: HAIR_COLORS[0], eyes: 'normal', brows: 'recta',
  nose: 'boton', mouth: 'sonrisa', extra: 'nada', shirt: '#4dabf7', shorts: '#343a40', glove: '#ff6b6b',
};

const pick = (a) => a[Math.floor(Math.random() * a.length)];
export function randomAvatar(name = 'TÚ') {
  const av = { name };
  for (const [k, o] of Object.entries(OPTIONS)) av[k] = pick(o.items)[0];
  for (const [k, o] of Object.entries(COLOR_FIELDS)) av[k] = pick(o.colors);
  return av;
}

const FACE_SCALE = { redonda: [1, 1, 1], ovalada: [0.92, 1.1, 0.96], ancha: [1.1, 0.94, 1] };
const R = 0.34; // radio de la cabeza

// kit = utilidades compartidas del juego: { mesh, toon, makeGlove, circleTexture, SPHERE, CYL, BOX, CONE }
export function buildAvatar(def, kit) {
  const { mesh, toon, makeGlove, circleTexture, SPHERE, CYL, BOX, CONE } = kit;
  const d = { ...DEFAULT_AVATAR, ...def };
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const skin = toon(d.skin), hairM = toon(d.hairColor);
  const dark = new THREE.MeshBasicMaterial({ color: '#2b2b33' });
  const capsule = new THREE.CapsuleGeometry(1, 1, 6, 18);

  // --- cuerpo ---
  body.add(mesh(capsule, toon(d.shirt), [0, 1.12, 0], [0.3, 0.25, 0.22]));
  body.add(mesh(CYL, skin, [0, 1.55, 0], [0.085, 0.14, 0.085]));
  body.add(mesh(CYL, toon(d.shorts), [0, 0.62, 0], [0.29, 0.3, 0.23]));
  body.add(mesh(CYL, toon('#ffffff'), [0, 0.78, 0], [0.3, 0.05, 0.235]));
  for (const s of [-1, 1]) {
    body.add(mesh(capsule, skin, [s * 0.13, 0.3, 0], [0.085, 0.11, 0.085]));
    body.add(mesh(SPHERE, toon('#f8f9fa'), [s * 0.13, 0.06, 0.05], [0.11, 0.07, 0.17]));
  }

  // --- cabeza ---
  const head = new THREE.Group(); head.position.y = 1.62; body.add(head);
  const [sx, sy, sz] = FACE_SCALE[d.face] || FACE_SCALE.redonda;
  const skull = new THREE.Group(); skull.position.y = 0.24; skull.scale.set(sx, sy, sz); head.add(skull);
  skull.add(mesh(SPHERE, skin, [0, 0, 0], R));
  for (const s of [-1, 1]) skull.add(mesh(SPHERE, skin, [s * R * 0.97, -0.01, 0], [0.06, 0.085, 0.045]));
  const fz = R * sz * 0.93; // profundidad de la superficie de la cara
  const ex = 0.11 * sx;

  // ojos
  const eyes = [], pupils = [];
  for (const s of [-1, 1]) {
    if (d.eyes === 'feliz') {
      const e = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.013, 8, 14, Math.PI), dark);
      e.position.set(s * ex, 0.27, fz); head.add(e); eyes.push(e);
    } else if (d.eyes === 'punto') {
      const e = mesh(SPHERE, dark, [s * ex, 0.27, fz], [0.03, 0.042, 0.02]); head.add(e); eyes.push(e);
    } else {
      const big = d.eyes === 'grande';
      const e = mesh(SPHERE, toon('#ffffff'), [s * ex, 0.27, fz - 0.02], big ? [0.075, 0.09, 0.05] : [0.058, 0.07, 0.04]); head.add(e); eyes.push(e);
      const p = mesh(SPHERE, dark, [s * ex, 0.265, fz + 0.015], big ? [0.042, 0.052, 0.02] : [0.032, 0.04, 0.02]); head.add(p); pupils.push(p);
      const hl = mesh(SPHERE, new THREE.MeshBasicMaterial({ color: '#ffffff' }), [s * ex + 0.012, 0.283, fz + 0.03], 0.011); head.add(hl); pupils.push(hl);
    }
  }
  // cejas
  const brows = [];
  for (const s of [-1, 1]) {
    const sc = d.brows === 'gruesa' ? [0.12, 0.042, 0.025] : [0.11, 0.024, 0.02];
    const b = mesh(BOX, new THREE.MeshBasicMaterial({ color: d.hair === 'calvo' ? '#5a3825' : d.hairColor }), [s * ex, 0.37, fz - 0.005], sc);
    b.userData.rz = d.brows === 'arco' ? s * 0.28 : 0;
    b.rotation.z = b.userData.rz; head.add(b); brows.push(b);
  }
  // nariz
  const noseM = toon(new THREE.Color(d.skin).multiplyScalar(0.9));
  if (d.nose === 'larga') head.add(mesh(capsule, noseM, [0, 0.2, fz + 0.02], [0.032, 0.03, 0.04]));
  else if (d.nose === 'ancha') head.add(mesh(SPHERE, noseM, [0, 0.19, fz + 0.01], [0.065, 0.045, 0.045]));
  else head.add(mesh(SPHERE, noseM, [0, 0.19, fz + 0.01], 0.042));
  // boca (arco que se da vuelta para cambiar de expresión)
  const mr = d.mouth === 'amplia' ? 0.085 : d.mouth === 'chica' ? 0.045 : 0.065;
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(mr, d.mouth === 'amplia' ? 0.022 : 0.016, 8, 18, Math.PI), new THREE.MeshBasicMaterial({ color: '#7a2e2e' }));
  mouth.position.set(0, 0.11, fz - 0.01); mouth.rotation.z = Math.PI; mouth.userData.y = 0.11; head.add(mouth);
  // extras
  if (d.extra === 'mejillas') for (const s of [-1, 1]) head.add(mesh(SPHERE, toon('#ff9fb2'), [s * 0.19 * sx, 0.16, fz - 0.06], [0.05, 0.032, 0.02]));
  if (d.extra === 'bigote') for (const s of [-1, 1]) { const m = mesh(capsule, hairM, [s * 0.05, 0.145, fz + 0.01], [0.022, 0.025, 0.022]); m.rotation.z = s * 1.2; head.add(m); }
  if (d.extra === 'cintillo') { const b = mesh(new THREE.TorusGeometry(R * 1.0, 0.035, 10, 40), toon(d.glove), [0, R * 0.42, 0], 1); b.rotation.x = Math.PI / 2; b.scale.set(0.93, 0.93, 1); skull.add(b); }

  // pelo
  const cap = (theta, r = R * 1.05, tilt = -0.25) => {
    const m = mesh(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, theta), hairM, [0, 0, 0], 1);
    m.rotation.x = tilt; skull.add(m); return m;
  };
  if (d.hair === 'corto') cap(1.2);
  if (d.hair === 'puntas') {
    cap(1.1);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2, n = new THREE.Vector3(Math.cos(a) * 0.55, 0.85, Math.sin(a) * 0.55 - 0.1).normalize();
      const c = mesh(CONE, hairM, n.clone().multiplyScalar(R * 1.05).toArray(), [0.06, 0.18, 0.06]);
      c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n); skull.add(c);
    }
  }
  if (d.hair === 'melena') cap(1.95, R * 1.07, -0.6);
  if (d.hair === 'mono') { cap(1.2); skull.add(mesh(SPHERE, hairM, [0, R * 0.95, -R * 0.45], 0.12)); }
  if (d.hair === 'rizos') {
    for (let i = 0; i < 16; i++) {
      const a = i * 2.4, yy = 0.45 + (i % 4) * 0.15;
      const n = new THREE.Vector3(Math.cos(a) * Math.sqrt(1 - yy * yy), yy, Math.sin(a) * Math.sqrt(1 - yy * yy) - 0.15).normalize();
      skull.add(mesh(SPHERE, hairM, n.multiplyScalar(R * 1.0).toArray(), 0.1));
    }
  }
  if (d.hair === 'rapado') { const m = cap(1.15, R * 1.01); m.material = toon(new THREE.Color(d.hairColor).lerp(new THREE.Color(d.skin), 0.45)); }

  // --- guantes y brazos ---
  const gloves = { L: makeGlove(d.glove, 0.17, -1), R: makeGlove(d.glove, 0.17, 1) };
  const arms = {}, shoulders = {};
  for (const k of ['L', 'R']) {
    gloves[k].group.rotation.y = Math.PI; root.add(gloves[k].group); gloves[k].pos = new THREE.Vector3();
    arms[k] = mesh(CYL, skin, [0, 1, 0], 1); root.add(arms[k]);
    shoulders[k] = new THREE.Vector3(k === 'L' ? -0.31 : 0.31, 1.38, 0);
  }

  // --- estrellas de mareo y aviso "!" ---
  const stars = new THREE.Group(); head.add(stars); stars.position.y = 0.7;
  for (let i = 0; i < 3; i++) stars.add(mesh(new THREE.OctahedronGeometry(1, 0), toon('#ffd23f'), [Math.cos(i * 2.1) * 0.35, 0, Math.sin(i * 2.1) * 0.35], 0.07));
  stars.visible = false;
  const bang = new THREE.Sprite(new THREE.SpriteMaterial({ map: circleTexture('!', '#ffffff', '#ff6b6b'), depthTest: false }));
  bang.scale.setScalar(0.45); bang.position.set(0, 2.55, 0); bang.visible = false; bang.renderOrder = 11; root.add(bang);

  for (const e of eyes) e.userData.sy = e.scale.y;
  for (const p of pupils) p.userData.sy = p.scale.y;
  return { root, body, head, eyes, pupils, brows, mouth, gloves, arms, shoulders, stars, bang };
}

// Estira cada brazo (cilindro) desde el hombro hasta el guante. Llamar cada frame.
const _up = new THREE.Vector3(0, 1, 0), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _dir = new THREE.Vector3();
export function updateArms(m) {
  m.root.updateMatrixWorld(true);
  for (const k of ['L', 'R']) {
    _a.copy(m.shoulders[k]); m.body.localToWorld(_a); m.root.worldToLocal(_a);
    _b.copy(m.gloves[k].group.position);
    _dir.subVectors(_b, _a); const len = Math.max(0.05, _dir.length() - 0.12);
    _dir.normalize();
    const arm = m.arms[k];
    arm.position.copy(_a).addScaledVector(_dir, len / 2);
    arm.scale.set(0.065, len, 0.065);
    arm.quaternion.setFromUnitVectors(_up, _dir);
  }
}
