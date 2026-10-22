import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildSkeletons, ELEMENTS } from './skeleton.js';
import { TideSim, ROLES, ACTIONS, THRESHOLD, policySatisfied, eligible } from './tidecloak-sim.js';

const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const V3 = THREE.Vector3;
const EL = Object.fromEntries(ELEMENTS.map((e) => [e.key, e]));

// ====================================================================== state
const LEVELS = [
  [0, 'Volunteer'], [250, 'Assistant'], [600, 'Excavator'],
  [1100, 'Preparator'], [1700, 'Bone Whisperer'], [2500, 'Paleo Legend'],
];
const BADGES = [
  { id: 'first',    icon: '🦴', name: 'First Bone',    desc: 'Find a bone' },
  { id: 'combo',    icon: '⚡', name: 'In the Zone',   desc: 'x8 combo' },
  { id: 'gentle',   icon: '🖌️', name: 'Gentle Hands',  desc: 'Skull with no cracks' },
  { id: 'full',     icon: '🦖', name: 'Dig Master',    desc: 'Dig up everything' },
  { id: 'quorum',   icon: '🤝', name: 'Quorum',        desc: 'Enough signatures' },
  { id: 'nomaster', icon: '🛡️', name: 'No Master Key', desc: 'root fails' },
  { id: 'keeper',   icon: '📍', name: 'Secret Keeper', desc: 'Unlock coordinates' },
  { id: 'science',  icon: '🔬', name: 'Open Science',  desc: 'Publish the scan' },
  { id: 'sue',      icon: '📜', name: 'Sue Clause',    desc: 'Transfer to museum' },
];

const state = {
  xp: 0, integrity: 100, tool: 'brush', muted: false,
  hp: {}, cracks: {}, revealed: new Set(), badges: new Set(), results: {},
  combo: 0, lastHit: 0, started: false,
};
for (const e of ELEMENTS) { state.hp[e.key] = e.hp; state.cracks[e.key] = 0; }

const sim = new TideSim();

// ====================================================================== audio
const sfx = {
  ctx: null, noise: null,
  init() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    const len = this.ctx.sampleRate * 0.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  },
  env(node, t0, a, peak, dur) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    node.connect(g).connect(this.ctx.destination);
    return g;
  },
  hiss(freq, q, peak, dur, type = 'bandpass') {
    if (!this.ctx || state.muted) return;
    const t = this.ctx.currentTime;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    s.connect(f); this.env(f, t, 0.01, peak, dur); s.start(t); s.stop(t + dur);
  },
  tone(freq, dur, type = 'sine', peak = 0.15, delay = 0, slideTo) {
    if (!this.ctx || state.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    this.env(o, t, 0.01, peak, dur); o.start(t); o.stop(t + dur + 0.05);
  },
  brush() { this.hiss(2600 + Math.random() * 1200, 0.7, 0.22, 0.16); },
  chisel() { this.tone(2200, 0.09, 'triangle', 0.12, 0, 900); this.hiss(5000, 1, 0.12, 0.08, 'highpass'); },
  crack() { this.hiss(600, 0.5, 0.35, 0.3, 'lowpass'); this.tone(140, 0.25, 'sawtooth', 0.08, 0, 70); },
  reveal() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, 'sine', 0.12, i * 0.08)); },
  tick() { this.tone(1320, 0.08, 'sine', 0.08); },
  thud() { this.tone(180, 0.18, 'square', 0.06, 0, 120); },
  deny() { this.tone(220, 0.35, 'sawtooth', 0.07, 0, 110); },
  unlock() { [392, 494, 587, 784].forEach((f) => this.tone(f, 1.1, 'sine', 0.07)); this.tone(1568, 0.6, 'sine', 0.05, 0.25); },
  level() { [659, 784, 988, 1319].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.08, i * 0.07)); },
};

// ====================================================================== scene
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x3a2214, 22, 70);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
const HOME = { pos: new V3(8.5, 6.2, 13.5), target: new V3(-0.4, 2.0, 0.8) };
camera.position.set(24, 16, 30);
const controls = new OrbitControls(camera, canvas);
controls.target.copy(HOME.target);
controls.enableDamping = true;
controls.minDistance = 4;
controls.maxDistance = 28;
controls.maxPolarAngle = 1.45;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;

scene.add(new THREE.HemisphereLight(0xffe2b8, 0x3b2a1e, 0.85));
const sun = new THREE.DirectionalLight(0xffd39a, 2.4);
sun.position.set(9, 15, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 10, bottom: -10, near: 1, far: 50 });
sun.shadow.bias = -0.0005;
scene.add(sun);
const rim = new THREE.DirectionalLight(0x86b6ff, 0.9);
rim.position.set(-10, 6, -9);
scene.add(rim);

// --- terrain with an excavation pit
function noise2(x, z) {
  return Math.sin(x * 0.21 + 1.3) * Math.cos(z * 0.17) + 0.5 * Math.sin(x * 0.53 + z * 0.41) + 0.25 * Math.sin(x * 1.3 - z * 1.1);
}
const PIT = { x0: -9.2, x1: 8.2, z0: -4.4, z1: 4.4 };
{
  const g = new THREE.PlaneGeometry(140, 140, 220, 220);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  const sand = new THREE.Color(0xc4935c), dirt = new THREE.Color(0x7a5434), tmp = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const dx = Math.max(PIT.x0 - x, 0, x - PIT.x1), dz = Math.max(PIT.z0 - z, 0, z - PIT.z1);
    const out = Math.hypot(dx, dz);
    const wall = THREE.MathUtils.smoothstep(out, 0, 1.4);
    const r = Math.hypot(x, z);
    const dunes = noise2(x, z) * 1.6 * THREE.MathUtils.smoothstep(r, 14, 40);
    const y = -0.02 + 0.75 * wall + dunes + (Math.random() - 0.5) * 0.03;
    p.setY(i, y);
    tmp.copy(dirt).lerp(sand, 0.25 + 0.75 * wall).multiplyScalar(0.9 + Math.random() * 0.15);
    col.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  ground.receiveShadow = true;
  scene.add(ground);
}

// --- survey grid: stakes + string
{
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.9 });
  const flag = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6, emissive: 0x401000 });
  const stakeGeo = new THREE.BoxGeometry(0.06, 0.7, 0.06);
  const flagGeo = new THREE.PlaneGeometry(0.2, 0.12);
  const linePts = [];
  for (let x = -9; x <= 8; x += 1) for (const z of [PIT.z0 + 0.2, PIT.z1 - 0.2]) {
    if (x % 2 === 0 || x === -9) {
      const s = new THREE.Mesh(stakeGeo, wood); s.position.set(x, 0.3, z); s.castShadow = true; scene.add(s);
      const f = new THREE.Mesh(flagGeo, flag); f.position.set(x + 0.1, 0.58, z); f.material.side = THREE.DoubleSide; scene.add(f);
    }
  }
  for (let x = -9; x <= 8; x += 2) linePts.push(new V3(x, 0.03, PIT.z0 + 0.2), new V3(x, 0.03, PIT.z1 - 0.2));
  for (let z = PIT.z0 + 0.2; z <= PIT.z1; z += 1.8) linePts.push(new V3(-9, 0.03, z), new V3(8, 0.03, z));
  linePts.push(new V3(-9, 0.6, PIT.z0 + 0.2), new V3(8, 0.6, PIT.z0 + 0.2), new V3(-9, 0.6, PIT.z1 - 0.2), new V3(8, 0.6, PIT.z1 - 0.2));
  const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(linePts), new THREE.LineBasicMaterial({ color: 0xffe9b0, transparent: true, opacity: 0.35 }));
  scene.add(lines);

  // warm work-lamp glow (lights only, so nothing blocks the orbiting camera)
  for (const [x, z] of [[-9.6, 4.4], [8.6, -4.4]]) {
    const l = new THREE.PointLight(0xffb45e, 18, 14, 1.6); l.position.set(x, 3.85, z); scene.add(l);
  }
  // scattered rocks
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8c6a48, roughness: 1, flatShading: true });
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, r = 11 + Math.random() * 16;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.2 + Math.random() * 0.6, 0), rockMat);
    m.position.set(Math.cos(a) * r, 0.5 + Math.random() * 0.4, Math.sin(a) * r * 0.7);
    m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    m.castShadow = true; scene.add(m);
  }
}

// --- the skeletons
const rex = buildSkeletons();
scene.add(rex.root);
const boneMeshes = [];
for (const [key, g] of Object.entries(rex.groups)) g.traverse((o) => { if (o.isMesh) { o.userData.key = key; boneMeshes.push(o); } });
const JAW_REST = rex.jaw.rotation.z;

// --- rock matrix ("concretions") that encases each element
function noise3(x, y, z, s) {
  return Math.sin(x * 1.7 + s) * Math.sin(y * 2.3 + s * 1.3) * Math.sin(z * 1.9 + s * 0.7)
    + 0.5 * Math.sin(x * 4.1 + y * 3.3 + s) * Math.sin(z * 3.7 - s);
}
const ROCK_GEOS = Array.from({ length: 6 }, (_, k) => {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position, v = new V3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(1 + 0.24 * noise3(v.x * 1.6, v.y * 1.6, v.z * 1.6, k * 13.1));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
});
const shells = {};
const rand = (a, b) => a + Math.random() * (b - a);
function buildShell(key) {
  const group = rex.groups[key];
  group.updateWorldMatrix(true, true);
  const pts = [], v = new V3();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(p.count / 10));
    for (let i = 0; i < p.count; i += step) pts.push(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).clone());
  });
  pts.sort(() => Math.random() - 0.5);
  const spacing = { arms: 0.3, mandible: 0.3, raptor: 0.24, chicken: 0.15 }[key] ?? 0.48;
  const centers = [];
  for (const p of pts) if (centers.every((c) => c.distanceToSquared(p) > spacing * spacing)) centers.push(p);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(rand(0.065, 0.085), rand(0.35, 0.45), rand(0.33, 0.4)),
    roughness: 1, flatShading: true, emissive: 0x000000,
  });
  const shell = new THREE.Group();
  shell.userData.key = key;
  const center = new THREE.Box3().setFromObject(group).getCenter(new V3());
  for (const c of centers) {
    const m = new THREE.Mesh(ROCK_GEOS[(Math.random() * 6) | 0], mat);
    const r = spacing * rand(0.95, 1.2);
    m.position.copy(c);
    m.scale.set(r * rand(0.9, 1.2), r * rand(0.85, 1.1), r * rand(0.9, 1.2));
    m.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
    m.userData = { key, base: m.scale.clone(), target: m.scale.clone() };
    m.castShadow = true; m.receiveShadow = true;
    shell.add(m);
  }
  scene.add(shell);
  shells[key] = { group: shell, mat, center };
}
for (const e of ELEMENTS) buildShell(e.key);

// --- particles: dust (shader points) + debris chunks
const DUST_N = 1600;
const dustPos = new Float32Array(DUST_N * 3), dustA = new Float32Array(DUST_N), dustS = new Float32Array(DUST_N);
const dustVel = Array.from({ length: DUST_N }, () => new V3());
const dustLife = new Float32Array(DUST_N);
let dustHead = 0;
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
dustGeo.setAttribute('alpha', new THREE.BufferAttribute(dustA, 1));
dustGeo.setAttribute('size', new THREE.BufferAttribute(dustS, 1));
const dust = new THREE.Points(dustGeo, new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { color: { value: new THREE.Color(0xe2c194) } },
  vertexShader: `attribute float alpha; attribute float size; varying float vA;
    void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform vec3 color; varying float vA;
    void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
    gl_FragColor = vec4(color, vA * (1.0 - d * 2.0)); }`,
}));
dust.frustumCulled = false;
scene.add(dust);
function puff(p, n, spread = 1, gold = false) {
  for (let i = 0; i < n; i++) {
    const k = dustHead = (dustHead + 1) % DUST_N;
    dustPos.set([p.x + rand(-0.1, 0.1), p.y + rand(-0.1, 0.1), p.z + rand(-0.1, 0.1)], k * 3);
    dustVel[k].set(rand(-1, 1), rand(0.3, 1.6), rand(-1, 1)).multiplyScalar(spread);
    dustLife[k] = rand(0.7, 1.4);
    dustS[k] = gold ? rand(0.08, 0.16) : rand(0.1, 0.28);
  }
}
// ambient floating motes
{
  const n = 500, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) pos.set([rand(-14, 14), rand(0.2, 9), rand(-9, 9)], i * 3);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  var motes = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffd9a0, size: 0.045, transparent: true, opacity: 0.55, depthWrite: false }));
  scene.add(motes);
}

const debris = [];
function chunk(p, mat, dir, power = 1) {
  const m = new THREE.Mesh(ROCK_GEOS[(Math.random() * 6) | 0], mat);
  const s = rand(0.05, 0.16) * power;
  m.scale.setScalar(s);
  m.position.copy(p);
  m.castShadow = true;
  scene.add(m);
  debris.push({ m, s, vel: dir.clone().normalize().multiplyScalar(rand(1.5, 4) * power).add(new V3(0, rand(1.5, 3.5), 0)), spin: new V3(rand(-8, 8), rand(-8, 8), rand(-8, 8)), life: rand(1.2, 2) });
}

// ====================================================================== UI helpers
function toast(title, kind = '', small = '') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.innerHTML = `${title}${small ? `<small>${small}</small>` : ''}`;
  for (const old of $('#toasts').children) if (old.innerHTML === t.innerHTML) old.remove();
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), 3300);
}
function floatText(text, x, y, bad = false) {
  const f = document.createElement('div');
  f.className = `float-xp${bad ? ' bad' : ''}`;
  f.textContent = text;
  f.style.left = `${x}px`; f.style.top = `${y - 20}px`;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 950);
}
function bump(id) { const el = $(id).parentElement; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

function levelOf(xp) { let i = 0; while (i + 1 < LEVELS.length && xp >= LEVELS[i + 1][0]) i++; return i; }
function addXP(n) {
  const before = levelOf(state.xp);
  state.xp += n;
  const after = levelOf(state.xp);
  if (after > before) { toast(`⭐ Level ${after + 1}`, 'gold', LEVELS[after][1]); sfx.level(); }
  renderStats();
}
function award(id) {
  if (state.badges.has(id)) return;
  state.badges.add(id);
  const b = BADGES.find((x) => x.id === id);
  setTimeout(() => { toast(`${b.icon} ${b.name}`, 'gold'); sfx.level(); }, 600);
  addXP(75);
  renderBadges();
}

function renderStats() {
  const i = levelOf(state.xp);
  const [lo] = LEVELS[i], hi = LEVELS[i + 1]?.[0] ?? lo + 1000;
  $('#lvl-num').textContent = i + 1;
  $('#lvl-title').textContent = LEVELS[i][1];
  $('#xp-bar').style.width = `${Math.min(100, ((state.xp - lo) / (hi - lo)) * 100)}%`;
  $('#score').textContent = state.xp;
  $('#bones').textContent = `${state.revealed.size}/${ELEMENTS.length}`;
  $('#integrity').textContent = `${state.integrity}%`;
  $('#integrity').style.color = state.integrity > 80 ? '' : state.integrity > 55 ? '#f3c58a' : 'var(--danger)';
}

const ANIMALS = [['rex', '🦖 T. rex'], ['raptor', '🦅 Raptor'], ['chicken', '🐔 Chicken']];
function renderLog(flashKey) {
  let h = '';
  for (const [animal, label] of ANIMALS) {
    h += `<h3>${label}</h3><div class="els">`;
    for (const e of ELEMENTS.filter((x) => x.animal === animal)) {
      const done = state.revealed.has(e.key);
      const pct = (state.hp[e.key] / e.hp) * 100;
      h += `<div class="el ${done ? 'done' : ''} ${flashKey === e.key ? 'flash' : ''}">
        <b>${done ? '✓' : '?'} ${done ? e.name : '???'}${state.cracks[e.key] ? ` <span class="crack">💥${state.cracks[e.key]}</span>` : ''}</b>
        ${done ? '' : `<div class="hp"><i style="width:${100 - pct}%"></i></div>`}</div>`;
    }
    h += `</div>`;
  }
  $('#tab-log').innerHTML = h;
}

function renderBadges() {
  $('#tab-badges').innerHTML = `<h3>${state.badges.size}/${BADGES.length}</h3><div class="badges">` + BADGES.map((b) => `
    <div class="badge ${state.badges.has(b.id) ? 'got' : ''}" title="${b.desc}"><div class="medal">${b.icon}</div><b>${b.name}</b></div>`).join('') + `</div>`;
}

function renderAudit() {
  $('#tab-audit').innerHTML = sim.audit.map((a) => `
    <div class="log-row ${a.kind}"><time>${a.t.toLocaleTimeString([], { hour12: false })}</time>
    <div>${ROLES[a.who].icon} ${a.msg}</div></div>`).join('');
}

function payloadHTML(p) {
  if (!p) return '';
  const rows = Object.entries(p).filter(([k]) => k !== 'kind').map(([k, v]) => `<div><span>${k}:</span> ${v}</div>`).join('');
  return `<div class="payload">${rows}</div>`;
}

function chips(roles, signed) {
  return roles.map((r) => `<span class="signer ${signed.includes(r) ? 'ok' : ''}" title="${ROLES[r].title}">${ROLES[r].icon} ${ROLES[r].title}${signed.includes(r) ? ' ✓' : ''}</span>`).join('');
}

function renderVault() {
  const me = sim.current;
  let h = '';
  let actionable = false;
  for (const [id, a] of Object.entries(ACTIONS)) {
    const v = sim.vault[id];
    const prop = sim.proposals.find((p) => p.action === id && p.status === 'open');
    const signed = prop ? Object.keys(prop.sigs) : [];
    const short = state.revealed.size < a.needsBones;
    h += `<div class="act ${v.opened ? 'opened' : ''}">
      <div class="act-head"><span class="lock">${v.opened ? '🔓' : '🔒'}</span><b>${a.icon} ${a.title}</b></div>
      <div class="signers">${chips(a.policy.all, signed)}${a.policy.atLeast ? `<span class="or">+ 1 of</span>${chips(a.policy.anyOf, signed)}` : ''}</div>`;
    if (v.opened && eligible(a.policy, me)) {
      h += payloadHTML(state.results[id]);
    } else if (v.opened) {
      h += `<div class="cipher">${sim.ciphertextPreview(id).slice(0, 28)}…</div>
        <div class="sealed">🔒 Opened for the signers only</div>`;
    } else {
      h += `<div class="cipher">${sim.ciphertextPreview(id).slice(0, 28)}…</div>`;
      if (prop) {
        const ready = policySatisfied(a.policy, signed);
        const canSign = eligible(a.policy, me) && !signed.includes(me);
        if (canSign) actionable = true;
        h += `<div class="btns">
            <button class="btn primary" data-sign="${prop.id}" ${canSign ? '' : 'disabled'}>✍️ Sign</button>
            <button class="btn ${ready ? 'tide' : ''}" data-exec="${prop.id}" data-action="${id}">🔑 Unlock</button>
          </div>`;
      } else {
        h += `<div class="btns"><button class="btn primary" data-req="${id}" ${short ? 'disabled' : ''}>📨 Request</button>
          ${short ? `<span class="need">🦴 ${state.revealed.size}/${a.needsBones}</span>` : ''}</div>`;
      }
    }
    h += `</div>`;
  }
  const isRoot = me === 'root';
  h += `<div class="root-box"><div class="act-head"><span class="lock">🛠️</span><b>root</b></div>
    <div class="btns">
      <button class="btn danger" data-override="coords" ${isRoot ? '' : 'disabled title="Sign in as root"'}>⚡ Force unlock</button>
      <button class="btn danger" data-forge="coords" ${isRoot ? '' : 'disabled title="Sign in as root"'}>🖋️ Forge</button>
    </div></div>`;
  $('#tab-vault').innerHTML = h;
  $('#vault-dot').classList.toggle('hidden', !actionable);
}

function renderIdentity() {
  const r = ROLES[sim.current];
  $('#who-icon').textContent = r.icon;
  $('#who-icon').style.borderColor = r.color;
  $('#who-name').textContent = r.name;
  $('#who-title').textContent = r.title;
  $('#who-menu').innerHTML = Object.values(ROLES).map((x) => `<button data-role="${x.id}" class="${x.id === sim.current ? 'current' : ''}">
      <span class="avatar" style="border-color:${x.color}">${x.icon}</span><span class="who-text"><b>${x.name}</b><small>${x.title}</small></span></button>`).join('');
}

function renderAll(flashKey) { renderStats(); renderLog(flashKey); renderVault(); renderBadges(); renderAudit(); renderIdentity(); }
sim.on(() => { renderAudit(); });

// ====================================================================== digging
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let hovered = null;
let shake = 0;
const glow = {};
let roarT = -1;

function pick(ev) {
  ndc.set((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const targets = [];
  for (const s of Object.values(shells)) targets.push(...s.group.children);
  targets.push(...boneMeshes);
  return ray.intersectObjects(targets, false)[0];
}

function setHover(key, isShell) {
  if (hovered === key) return;
  if (hovered && shells[hovered]) shells[hovered].mat.emissive.setHex(0x000000);
  hovered = key;
  if (key && isShell) shells[key].mat.emissive.setHex(0x3a2410);
  canvas.style.cursor = key && isShell ? (state.tool === 'brush' ? 'crosshair' : 'cell') : '';
}

function dig(key, point, ev) {
  if (sim.current !== 'paleo') {
    toast('🦴 Only the paleontologist digs', 'bad');
    sfx.deny();
    return;
  }
  controls.autoRotate = false;
  const e = EL[key];
  const now = performance.now();
  state.combo = now - state.lastHit < 900 ? state.combo + 1 : 1;
  state.lastHit = now;
  if (state.combo >= 8) award('combo');
  const chisel = state.tool === 'chisel';
  const dmg = chisel ? 3 : 1;
  chisel ? sfx.chisel() : sfx.brush();

  if (chisel && e.fragile && Math.random() < 0.35) {
    state.cracks[key]++;
    state.integrity = Math.max(0, state.integrity - 4);
    sfx.crack();
    shake = 0.25;
    floatText('CRACK -4%', ev.clientX, ev.clientY + 22, true);
    toast('💥 Crack!', 'bad', 'Use the brush');
    bump('#integrity');
  }
  state.hp[key] = Math.max(0, state.hp[key] - dmg);
  const gain = 5 * dmg + (state.combo >= 3 ? state.combo * 2 : 0);
  addXP(gain);
  floatText(`+${gain}${state.combo >= 3 ? ` x${state.combo}` : ''}`, ev.clientX, ev.clientY);
  bump('#score');

  const s = shells[key];
  const f = 0.5 + 0.5 * (state.hp[key] / e.hp);
  for (const m of s.group.children) m.userData.target.copy(m.userData.base).multiplyScalar(f);
  puff(point, chisel ? 26 : 14, chisel ? 1.3 : 0.8);
  for (let i = 0; i < (chisel ? 5 : 2); i++) chunk(point, s.mat, point.clone().sub(s.center).setY(0.5), 0.8);
  if (chisel) shake = Math.max(shake, 0.08);

  if (state.hp[key] === 0) reveal(key);
  else renderLog();
  if (hovered === key) updateTooltip(ev, key);
}

function reveal(key) {
  const e = EL[key], s = shells[key];
  for (const m of s.group.children) {
    for (let i = 0; i < 2; i++) chunk(m.position, s.mat, m.position.clone().sub(s.center), 1.3);
    puff(m.position, 4, 1.4);
  }
  scene.remove(s.group);
  delete shells[key];
  setHover(null);
  state.revealed.add(key);
  glow[key] = 1.6;
  sfx.reveal();
  const clean = state.cracks[key] === 0;
  addXP(100 + (clean ? 50 : 0));
  toast(`🦴 ${e.name}! +${100 + (clean ? 50 : 0)}`, 'gold', e.fact);
  if (state.revealed.size === 1) award('first');
  if (key === 'skull' && clean) award('gentle');
  if (key === 'mandible' || key === 'skull') roarT = 0;
  sim.log(`Found: ${e.name}`, 'info');
  if (state.revealed.size === ELEMENTS.length) setTimeout(complete, 900);
  for (const [id, a] of Object.entries(ACTIONS)) {
    if (a.needsBones && state.revealed.size === a.needsBones) setTimeout(() => toast(`🔐 ${a.icon} ${a.title}`, 'tide', 'Vault'), 1500);
  }
  renderAll(key);
}

function complete() {
  award('full');
  roarT = 0;
  shake = 0.35;
  controls.autoRotate = true;
  const p = new V3(0, 3, 0);
  for (let i = 0; i < 6; i++) setTimeout(() => puff(p.clone().add(new V3(rand(-6, 5), rand(0, 3), rand(-2, 2))), 40, 1.6, true), i * 180);
  toast('🦖 Site cleared!', 'gold', `Integrity ${state.integrity}%`);
  sfx.unlock();
}

// tooltip
function updateTooltip(ev, key, isBone) {
  const tt = $('#tooltip');
  if (!key) { tt.classList.add('hidden'); return; }
  const e = EL[key];
  tt.classList.remove('hidden');
  tt.style.left = `${ev.clientX}px`; tt.style.top = `${ev.clientY}px`;
  if (isBone) {
    tt.innerHTML = `<b>${e.name} ✓</b>`;
  } else {
    const pct = (state.hp[key] / e.hp) * 100;
    tt.innerHTML = `<b>🪨 ${state.hp[key]}/${e.hp}</b>
      <div class="hp"><i style="width:${pct}%"></i></div>${e.fragile && state.tool === 'chisel' ? '<div class="frag">⚠ fragile</div>' : ''}`;
  }
}

let down = null;
canvas.addEventListener('pointerdown', (ev) => { down = { x: ev.clientX, y: ev.clientY }; });
canvas.addEventListener('pointerup', (ev) => {
  if (!state.started || !down || Math.hypot(ev.clientX - down.x, ev.clientY - down.y) > 6) return;
  const hit = pick(ev);
  if (hit && shells[hit.object.userData.key]?.group === hit.object.parent) {
    hit.object.scale.multiplyScalar(0.82);
    dig(hit.object.userData.key, hit.point, ev);
  }
});
canvas.addEventListener('pointermove', (ev) => {
  if (!state.started) return;
  const hit = pick(ev);
  const key = hit?.object.userData.key;
  const isShell = !!(key && shells[key]?.group === hit.object.parent);
  setHover(isShell ? key : null, isShell);
  updateTooltip(ev, key, key && !isShell);
});
canvas.addEventListener('pointerleave', () => { setHover(null); updateTooltip(null); });

function setTool(t) {
  state.tool = t;
  document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
}
document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
addEventListener('keydown', (e) => { if (e.key === '1') setTool('brush'); if (e.key === '2') setTool('chisel'); });
$('#mute').addEventListener('click', () => { state.muted = !state.muted; $('#mute').textContent = state.muted ? '🔇' : '🔊'; });
let flyTo = null;
$('#view').addEventListener('click', () => { flyTo = { pos: HOME.pos.clone(), target: HOME.target.clone() }; });

// tabs
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  document.querySelectorAll('.tab-body').forEach((b) => b.classList.toggle('hidden', b.id !== `tab-${t.dataset.tab}`));
}));
function showTab(name) { document.querySelector(`.tab[data-tab="${name}"]`).click(); }

// identity
$('#who-btn').addEventListener('click', () => $('#who-menu').classList.toggle('hidden'));
$('#who-menu').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-role]');
  if (!b) return;
  sim.login(b.dataset.role);
  $('#who-menu').classList.add('hidden');
  const r = ROLES[sim.current];
  toast(`${r.icon} ${r.name}`, 'tide');
  sfx.tick();
  renderIdentity(); renderVault();
  if (sim.current !== 'paleo') showTab('vault');
});
document.addEventListener('click', (ev) => { if (!ev.target.closest('#identity')) $('#who-menu').classList.add('hidden'); });

// ====================================================================== vault actions
$('#tab-vault').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button');
  if (!b || b.disabled) return;
  if (b.dataset.req) {
    sim.request(b.dataset.req);
    addXP(20);
    toast('📨 Requested', 'tide', 'Collect signatures');
    sfx.tick();
    renderVault();
  } else if (b.dataset.sign) {
    const pid = b.dataset.sign;
    await sim.approve(pid);
    const p = sim.proposals.find((x) => x.id === pid);
    addXP(50);
    sfx.tick();
    toast('✍️ Signed', 'tide');
    if (policySatisfied(ACTIONS[p.action].policy, Object.keys(p.sigs))) {
      award('quorum');
      toast('🤝 Quorum!', 'gold', 'Press Unlock');
    }
    renderVault();
  } else if (b.dataset.exec) {
    await runUnlock(b.dataset.action, { pid: b.dataset.exec });
  } else if (b.dataset.override) {
    await runUnlock(b.dataset.override, { override: true });
  } else if (b.dataset.forge) {
    const p = await sim.forge(b.dataset.forge);
    await runUnlock(b.dataset.forge, { proposal: p, override: true, forged: true });
  }
});

function openOrk(title, sub) {
  $('#ork-title').textContent = title;
  $('#ork-sub').textContent = sub;
  $('#ork-result').innerHTML = '';
  $('#ork-close').classList.add('hidden');
  const W = 300, cx = 150, cy = 160, R = 120;
  let h = `<div class="ork-core" id="ork-core" style="top:${cy}px">🔒</div>`;
  sim.orks.forEach((o, i) => {
    const a = Math.PI + (i / (sim.orks.length - 1)) * Math.PI;
    h += `<div class="ork" id="o-${o.id}" style="left:${cx + R * Math.cos(a)}px;top:${cy + R * Math.sin(a) * 0.95}px">
      <div class="node">${i + 1}</div><b>${o.id}</b><small>${o.region}</small><div class="why"></div></div>`;
  });
  $('#ork-ring').style.width = `${W}px`;
  $('#ork-ring').innerHTML = h;
  $('#ork-modal').classList.remove('hidden');
}

async function runUnlock(actionId, { pid, proposal, override = false, forged = false }) {
  const a = ACTIONS[actionId];
  openOrk(override ? (forged ? '🖋️ root forges…' : '⚡ root forces…') : '🔑 Asking ORKs…',
    `${a.icon} ${a.title} · ${THRESHOLD}/${sim.orks.length} needed`);
  const res = await sim.execute(pid ?? actionId, {
    override, proposal,
    onOrk: async (ork, r) => {
      const el = $(`#o-${ork.id}`);
      el.classList.add('busy');
      await sleep(200);
      el.classList.remove('busy');
      el.classList.add(r.ok ? 'yes' : 'no');
      el.querySelector('.node').textContent = r.ok ? '✓' : '✗';
      if (!r.ok) el.querySelector('.why').textContent = r.reason;
      r.ok ? sfx.tick() : sfx.thud();
    },
  });
  await sleep(250);
  const core = $('#ork-core');
  if (res.ok) {
    core.classList.add('open'); core.textContent = '🔓';
    $('#ork-title').textContent = '🔓 Unlocked';
    $('#ork-result').innerHTML = eligible(a.policy, sim.current)
      ? payloadHTML(res.payload)
      : `<p class="big-line">Opened for the signers only.</p>`;
    state.results[actionId] = res.payload;
    sfx.unlock();
    addXP(200);
    award({ coords: 'keeper', scan: 'science', transfer: 'sue' }[actionId]);
  } else {
    core.classList.add('shut'); core.textContent = '⛔';
    sfx.deny();
    shake = 0.2;
    if (override) {
      $('#ork-title').textContent = '⛔ No master key';
      $('#ork-result').innerHTML = `<p class="big-line">${forged ? 'Fake signatures rejected.' : 'Not even root.'}</p>`;
      award('nomaster');
    } else {
      $('#ork-title').textContent = '✍️ Need more signatures';
    }
  }
  $('#ork-close').classList.remove('hidden');
  renderVault();
}
$('#ork-close').addEventListener('click', () => $('#ork-modal').classList.add('hidden'));

// ====================================================================== loop
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  if (w > 900) camera.setViewOffset(w, h, 180, 0, w, h); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  if (flyTo) {
    camera.position.lerp(flyTo.pos, 0.06);
    controls.target.lerp(flyTo.target, 0.06);
    if (camera.position.distanceTo(flyTo.pos) < 0.05) flyTo = null;
  }
  controls.update();

  for (const s of Object.values(shells)) for (const m of s.group.children) m.scale.lerp(m.userData.target, 0.18);

  for (const k in glow) {
    glow[k] = Math.max(0, glow[k] - dt * 0.8);
    rex.mats[k].emissive.setRGB(0.9, 0.55, 0.2).multiplyScalar(glow[k] * 0.5);
    if (!glow[k]) delete glow[k];
  }
  if (roarT >= 0) {
    roarT += dt;
    rex.jaw.rotation.z = JAW_REST - 0.42 * Math.sin(Math.min(roarT / 1.6, 1) * Math.PI);
    if (roarT > 1.6) { roarT = -1; rex.jaw.rotation.z = JAW_REST; }
  }

  for (let i = 0; i < DUST_N; i++) {
    if (dustLife[i] <= 0) { dustA[i] = 0; continue; }
    dustLife[i] -= dt;
    const v = dustVel[i];
    v.y -= dt * 0.6; v.multiplyScalar(1 - dt * 1.5);
    dustPos[i * 3] += v.x * dt; dustPos[i * 3 + 1] += v.y * dt; dustPos[i * 3 + 2] += v.z * dt;
    dustA[i] = Math.min(1, dustLife[i]) * 0.7;
  }
  dustGeo.attributes.position.needsUpdate = true;
  dustGeo.attributes.alpha.needsUpdate = true;
  dustGeo.attributes.size.needsUpdate = true;
  motes.rotation.y = t * 0.01;
  motes.position.y = Math.sin(t * 0.3) * 0.2;

  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.life -= dt;
    d.vel.y -= 9.8 * dt;
    d.m.position.addScaledVector(d.vel, dt);
    if (d.m.position.y < 0.05) { d.m.position.y = 0.05; d.vel.y *= -0.35; d.vel.x *= 0.6; d.vel.z *= 0.6; }
    d.m.rotation.x += d.spin.x * dt; d.m.rotation.y += d.spin.y * dt;
    if (d.life < 0.4) d.m.scale.setScalar(d.s * Math.max(0, d.life / 0.4));
    if (d.life <= 0) { scene.remove(d.m); debris.splice(i, 1); }
  }

  if (shake > 0) {
    shake = Math.max(0, shake - dt * 0.8);
    camera.position.x += (Math.random() - 0.5) * shake * 0.4;
    camera.position.y += (Math.random() - 0.5) * shake * 0.4;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ====================================================================== boot
await sim.init();
renderAll();
$('#loading').classList.add('hidden');
requestAnimationFrame(frame);
flyTo = { pos: HOME.pos.clone(), target: HOME.target.clone() };

$('#start').addEventListener('click', () => {
  sfx.init();
  state.started = true;
  $('#intro').classList.add('hidden');
  toast('🖌️ Click the rocks!', 'gold');
});

// expose for quick demo/debugging from the console
window.fossilVault = { state, sim, reveal, shells };
