// Procedural dinosaur skeletons built from primitives (no model download needed): a T. rex, a raptor
// and a chicken (a living dinosaur). Each animal faces +X and stands on y = 0. Each diggable element
// is its own THREE.Group so the game can bury / reveal it independently.
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);
const SPHERE = new THREE.SphereGeometry(1, 14, 10);
const CONE = new THREE.ConeGeometry(1, 1, 8);
const v = (x, y, z = 0) => new THREE.Vector3(x, y, z);

export const ELEMENTS = [
  { key: 'skull',    animal: 'rex',     name: 'Skull',     hp: 9, fragile: true,  fact: 'Bite force ~35,000 N' },
  { key: 'mandible', animal: 'rex',     name: 'Jaw',       hp: 6, fragile: true,  fact: 'Teeth up to 30 cm' },
  { key: 'neck',     animal: 'rex',     name: 'Neck',      hp: 5, fragile: false, fact: 'S-curved and powerful' },
  { key: 'dorsal',   animal: 'rex',     name: 'Back',      hp: 6, fragile: false, fact: 'Balanced like a see-saw' },
  { key: 'ribs',     animal: 'rex',     name: 'Ribs',      hp: 6, fragile: true,  fact: 'Healed fractures inside' },
  { key: 'arms',     animal: 'rex',     name: 'Arms',      hp: 3, fragile: true,  fact: 'Tiny, but curled ~200 kg' },
  { key: 'pelvis',   animal: 'rex',     name: 'Hips',      hp: 7, fragile: false, fact: 'A "boot" to rest on' },
  { key: 'legL',     animal: 'rex',     name: 'Left leg',  hp: 6, fragile: false, fact: 'Carried ~8 tonnes' },
  { key: 'legR',     animal: 'rex',     name: 'Right leg', hp: 6, fragile: false, fact: 'Three toes + a dewclaw' },
  { key: 'tail',     animal: 'rex',     name: 'Tail',      hp: 5, fragile: false, fact: 'The main running muscle' },
  { key: 'tailTip',  animal: 'rex',     name: 'Tail tip',  hp: 4, fragile: false, fact: 'Usually lost before burial' },
  { key: 'raptor',   animal: 'raptor',  name: 'Raptor',    hp: 8, fragile: true,  fact: 'Sickle claw on each foot' },
  { key: 'chicken',  animal: 'chicken', name: 'Chicken',   hp: 4, fragile: true,  fact: 'Birds are dinosaurs!' },
];

// Mesh helpers bound to one set of element groups + materials.
function kit(groups, mats) {
  function knob(key, p, r, parent = groups[key]) {
    const m = new THREE.Mesh(SPHERE, mats[key]);
    m.scale.setScalar(r);
    m.position.copy(p);
    parent.add(m);
    return m;
  }
  function seg(key, a, b, r0, r1 = r0, knobs = true, parent = groups[key]) {
    const dir = b.clone().sub(a);
    const len = dir.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 10, 1), mats[key]);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(UP, dir.normalize());
    parent.add(m);
    if (knobs) { knob(key, a, r0 * 1.3, parent); knob(key, b, r1 * 1.3, parent); }
    return m;
  }
  function claw(key, p, dir, r, len, parent = groups[key]) {
    const m = new THREE.Mesh(CONE, mats[key]);
    m.scale.set(r, len, r);
    m.position.copy(p).addScaledVector(dir.clone().normalize(), len / 2);
    m.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
    parent.add(m);
  }
  function tube(key, pts, r, parent = groups[key]) {
    parent.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, r, 6), mats[key]));
  }
  return { knob, seg, claw, tube };
}

// Tapered box: wide/tall at the back, narrow at the snout.
function skullGeo(len, h0, h1, w0, w1, base) {
  const g = new THREE.BoxGeometry(1, 1, 1, 14, 6, 6);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const u = x + 0.5; // 0 back -> 1 snout
    const hy = THREE.MathUtils.lerp(h0, h1, u);
    const wz = THREE.MathUtils.lerp(w0, w1, Math.pow(u, 0.8));
    const top = Math.max(0, y * 2);
    pos.setXYZ(i, u * len, base + (y + 0.5) * hy, z * wz * (1 - 0.32 * top * top));
  }
  g.computeVertexNormals();
  return g;
}

function spineSampler(curve) {
  const samples = curve.getSpacedPoints(300);
  return (x) => samples.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
}

export function buildSkeletons() {
  const root = new THREE.Group();
  const groups = {};
  const mats = {};
  for (const e of ELEMENTS) {
    const g = new THREE.Group();
    g.name = e.key;
    groups[e.key] = g;
    mats[e.key] = new THREE.MeshStandardMaterial({ color: 0xeadcbc, roughness: 0.62, metalness: 0.02, emissive: 0x000000 });
    root.add(g);
  }
  const k = kit(groups, mats);
  const jaw = buildTRex(k, groups, mats);
  buildRaptor(k, groups, mats);
  buildChicken(k, groups, mats);
  groups.raptor.position.set(-3.4, 0, 2.6);
  groups.raptor.rotation.y = -0.28;
  groups.chicken.position.set(3.1, 0, 2.5);
  groups.chicken.rotation.y = -0.6;
  groups.chicken.scale.setScalar(1.35);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, groups, mats, jaw };
}

// ====================================================================== T. rex
function buildTRex({ knob, seg, claw }, groups, mats) {
  const dark = new THREE.MeshStandardMaterial({ color: 0x22160e, roughness: 1 });

  // ---------- Vertebral column ----------
  const spine = new THREE.CatmullRomCurve3([
    v(-7.4, 1.0), v(-5.6, 1.9), v(-3.6, 2.85), v(-1.6, 3.45), v(0, 3.68),
    v(1.5, 3.72), v(2.9, 3.55), v(3.65, 3.82), v(4.25, 4.35), v(4.7, 4.52),
  ]);
  const N = 66;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const p = spine.getPointAt(t);
    const tan = spine.getTangentAt(t);
    const key = p.x < -4.3 ? 'tailTip' : p.x < -0.7 ? 'tail' : p.x < 3.25 ? 'dorsal' : 'neck';
    let s = 0.06 + 0.17 * THREE.MathUtils.smoothstep(t, 0, 0.55);
    if (key === 'neck') s *= 0.85;
    const vert = new THREE.Group();
    vert.position.copy(p);
    vert.quaternion.setFromUnitVectors(X, tan);
    groups[key].add(vert);
    // centrum
    const c = new THREE.Mesh(new THREE.CylinderGeometry(s, s * 0.92, 0.16, 10), mats[key]);
    c.rotation.z = Math.PI / 2;
    vert.add(c);
    // neural spine (tallest over the hips)
    const h = s * (key === 'dorsal' ? 2.6 : key === 'neck' ? 1.2 : 1.8) * (key === 'tailTip' ? 0.6 : 1);
    const ns = new THREE.Mesh(new THREE.BoxGeometry(0.1, h, 0.05), mats[key]);
    ns.position.set(-0.03, s + h / 2, 0);
    ns.rotation.z = 0.25;
    vert.add(ns);
    // transverse processes
    if (key !== 'tailTip') {
      const tp = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, s * 3.6), mats[key]);
      tp.position.y = s * 0.55;
      vert.add(tp);
    }
    // chevrons under the tail
    if ((key === 'tail' || key === 'tailTip') && p.x < -1.0) {
      const ch = new THREE.Mesh(new THREE.BoxGeometry(0.05, h * 0.9, 0.04), mats[key]);
      ch.position.set(-0.05, -s - h * 0.42, 0);
      ch.rotation.z = -0.45;
      vert.add(ch);
    }
  }
  const spineAt = spineSampler(spine);

  // ---------- Ribcage ----------
  for (let i = 0; i < 10; i++) {
    const x = 0.55 + i * 0.26;
    const p = spineAt(x);
    const L = 0.75 + 0.75 * Math.sin((Math.PI * (i + 1.5)) / 11.5);
    for (const s of [-1, 1]) {
      const curve = new THREE.CatmullRomCurve3([
        v(x, p.y - 0.08, s * 0.16),
        v(x + 0.06, p.y - 0.3, s * 0.72),
        v(x + 0.2, p.y - 0.85 * L, s * 0.86),
        v(x + 0.36, p.y - 1.35 * L, s * 0.42),
      ]);
      groups.ribs.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 18, 0.042, 6), mats.ribs));
    }
  }
  // gastralia (belly ribs)
  for (let i = 0; i < 7; i++) {
    const x = 0.9 + i * 0.3;
    const y = 1.55 + Math.abs(i - 3) * 0.05;
    const curve = new THREE.CatmullRomCurve3([v(x, y + 0.15, -0.5), v(x + 0.05, y, 0), v(x, y + 0.15, 0.5)]);
    groups.ribs.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 10, 0.025, 5), mats.ribs));
  }

  // ---------- Pelvis ----------
  for (const s of [-1, 1]) {
    const il = knob('pelvis', v(0.05, 3.62, s * 0.3), 1);
    il.scale.set(1.05, 0.4, 0.07);
    seg('pelvis', v(0.25, 3.35, s * 0.24), v(0.95, 1.78, s * 0.1), 0.09, 0.07);
    seg('pelvis', v(-0.35, 3.35, s * 0.22), v(-1.05, 2.35, s * 0.08), 0.07, 0.04);
  }
  const boot = knob('pelvis', v(1.0, 1.72, 0), 1);
  boot.scale.set(0.55, 0.12, 0.2);

  // ---------- Hindlimbs ----------
  for (const [key, s] of [['legL', 1], ['legR', -1]]) {
    const z = 0.55 * s;
    const hip = v(0.05, 3.25, z), knee = v(0.7, 1.95, z), ankle = v(0.05, 0.78, z), ball = v(0.45, 0.17, z);
    seg(key, hip, knee, 0.17, 0.13);
    seg(key, knee, ankle, 0.12, 0.08);
    seg(key, knee.clone().add(v(-0.05, 0, 0.07 * s)), ankle.clone().add(v(0, 0.05, 0.07 * s)), 0.04, 0.03, false);
    seg(key, ankle, ball, 0.09, 0.07);
    for (const dz of [-0.13, 0, 0.13]) {
      const a = v(0.45, 0.16, z + dz);
      const b = v(0.98 - Math.abs(dz) * 0.8, 0.07, z + dz * 1.9);
      seg(key, a, b, 0.055, 0.045);
      claw(key, b, b.clone().sub(a).add(v(0, -0.05, 0)), 0.045, 0.16);
    }
    seg(key, v(0.25, 0.45, z), v(0.05, 0.3, z - 0.08 * s), 0.03, 0.025); // hallux
  }

  // ---------- Forelimbs ----------
  for (const s of [-1, 1]) {
    const z = 0.44 * s;
    seg('arms', v(2.45, 3.6, z * 0.85), v(3.0, 2.78, z), 0.075, 0.05);
    seg('arms', v(3.0, 2.78, z), v(3.28, 2.33, z), 0.05, 0.04);
    seg('arms', v(3.28, 2.33, z), v(3.6, 2.4, z), 0.035, 0.03);
    for (const dz of [-0.04, 0.04]) {
      const a = v(3.6, 2.4, z + dz), b = v(3.78, 2.3, z + dz * 1.5);
      seg('arms', a, b, 0.022, 0.018);
      claw('arms', b, v(0.4, -0.6, 0), 0.02, 0.08);
    }
  }

  // ---------- Skull ----------
  const skull = new THREE.Group();
  skull.position.set(4.62, 4.32, 0);
  skull.rotation.z = -0.12;
  groups.skull.add(skull);
  const len = 1.55;
  skull.add(new THREE.Mesh(skullGeo(len, 0.82, 0.38, 0.64, 0.3, -0.22), mats.skull));
  // fenestrae (openings) - dark insets on both sides
  const holes = [
    // [x, y, sx, sy, zFrac]
    [0.42, 0.28, 0.12, 0.14, 0.5],   // orbit
    [0.78, 0.12, 0.24, 0.11, 0.44],  // antorbital fenestra
    [0.13, 0.08, 0.09, 0.18, 0.56],  // lateral temporal fenestra
    [1.42, 0.02, 0.06, 0.05, 0.3],   // naris
  ];
  for (const [x, y, sx, sy, zf] of holes) {
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(SPHERE, dark);
      h.scale.set(sx, sy, 0.05);
      h.position.set(x, y, s * zf * THREE.MathUtils.lerp(0.64, 0.3, x / len));
      skull.add(h);
    }
  }
  // upper teeth
  for (let i = 0; i < 12; i++) {
    const x = 0.5 + i * 0.08;
    const w = THREE.MathUtils.lerp(0.64, 0.3, Math.pow(x / len, 0.8)) * 0.42;
    for (const s of [-1, 1]) claw('skull', v(x, -0.2, s * w), v(0.08, -1, 0), 0.03, 0.12 + (i % 3) * 0.02, skull);
  }
  // brow horn bosses
  for (const s of [-1, 1]) knob('skull', v(0.42, 0.42, s * 0.2), 0.07, skull);

  // ---------- Mandible (pivots so it can open) ----------
  const jaw = new THREE.Group();
  jaw.position.set(4.66, 4.08, 0);
  jaw.rotation.z = -0.16;
  groups.mandible.add(jaw);
  for (const s of [-1, 1]) {
    seg('mandible', v(0.0, 0.0, s * 0.28), v(1.42, 0.02, s * 0.12), 0.085, 0.045, true, jaw);
    seg('mandible', v(0.05, 0.08, s * 0.27), v(0.5, 0.12, s * 0.24), 0.06, 0.05, false, jaw);
    for (let i = 0; i < 10; i++) {
      const x = 0.55 + i * 0.085;
      const zz = THREE.MathUtils.lerp(0.28, 0.12, x / 1.42) * 0.85;
      claw('mandible', v(x, 0.06, s * zz), v(-0.05, 1, 0), 0.026, 0.1, jaw);
    }
  }
  knob('mandible', v(1.42, 0.02, 0), 0.08, jaw);
  return jaw;
}

// ====================================================================== Raptor (dromaeosaur)
function buildRaptor({ knob, seg, claw, tube }, groups, mats) {
  const key = 'raptor', g = groups[key], mat = mats[key];
  const dark = new THREE.MeshStandardMaterial({ color: 0x22160e, roughness: 1 });

  // long, stiff, horizontal tail -> S-shaped neck
  const spine = new THREE.CatmullRomCurve3([
    v(-2.5, 1.02), v(-1.6, 1.08), v(-0.8, 1.14), v(0, 1.17), v(0.6, 1.16), v(1.0, 1.12),
    v(1.22, 1.3), v(1.3, 1.56), v(1.44, 1.76),
  ]);
  const N = 46;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const p = spine.getPointAt(t);
    const s = 0.022 + 0.04 * THREE.MathUtils.smoothstep(t, 0, 0.6);
    const vert = new THREE.Group();
    vert.position.copy(p);
    vert.quaternion.setFromUnitVectors(X, spine.getTangentAt(t));
    g.add(vert);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(s, s * 0.9, 0.075, 8), mat);
    c.rotation.z = Math.PI / 2;
    vert.add(c);
    if (p.x > -0.9 && p.x < 1.05) {
      const ns = new THREE.Mesh(new THREE.BoxGeometry(0.05, s * 2.2, 0.025), mat);
      ns.position.set(-0.01, s + s * 1.1, 0);
      vert.add(ns);
    }
  }
  // bony rods that stiffened the tail
  for (const z of [-0.025, 0.025]) tube(key, [v(-2.45, 0.99, z), v(-1.6, 1.04, z), v(-0.7, 1.09, z)], 0.007);
  const spineAt = spineSampler(spine);

  // ribs
  for (let i = 0; i < 7; i++) {
    const x = 0.15 + i * 0.12;
    const y = spineAt(x).y;
    const L = 0.6 + 0.4 * Math.sin((Math.PI * (i + 1)) / 8);
    for (const s of [-1, 1]) {
      tube(key, [v(x, y - 0.03, s * 0.05), v(x + 0.03, y - 0.12, s * 0.25), v(x + 0.07, y - 0.32 * L, s * 0.28), v(x + 0.13, y - 0.55 * L, s * 0.12)], 0.016);
    }
  }

  // pelvis (pubis swept backwards, like birds)
  for (const s of [-1, 1]) {
    const il = knob(key, v(0, 1.2, s * 0.09), 1);
    il.scale.set(0.38, 0.13, 0.03);
    seg(key, v(0.04, 1.1, s * 0.08), v(-0.16, 0.62, s * 0.02), 0.03, 0.02);
    seg(key, v(-0.1, 1.1, s * 0.07), v(-0.36, 0.86, s * 0.02), 0.025, 0.014);
  }
  knob(key, v(-0.17, 0.6, 0), 1).scale.set(0.12, 0.035, 0.05);

  // legs with the raised sickle claw
  for (const s of [-1, 1]) {
    const z = 0.16 * s;
    const hip = v(0, 1.08, z), knee = v(0.28, 0.66, z), ankle = v(0, 0.3, z), ball = v(0.15, 0.05, z);
    seg(key, hip, knee, 0.055, 0.044);
    seg(key, knee, ankle, 0.04, 0.03);
    seg(key, ankle, ball, 0.03, 0.025);
    for (const dz of [-0.035, 0.02]) {
      const a = v(0.15, 0.04, z + dz), b = v(0.4, 0.025, z + dz * 1.5);
      seg(key, a, b, 0.017, 0.014);
      claw(key, b, v(1, -0.3, 0), 0.014, 0.05);
    }
    // digit II held off the ground, ending in the sickle
    const tip = v(0.22, 0.13, z + 0.045 * s);
    seg(key, v(0.15, 0.06, z + 0.04 * s), tip, 0.017, 0.015);
    const sickle = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 6, 14, Math.PI * 0.75), mat);
    sickle.position.copy(tip).add(v(0.08, -0.06, 0));
    sickle.rotation.z = 0.15;
    g.add(sickle);
  }

  // long grasping arms, folded
  for (const s of [-1, 1]) {
    const z = 0.12 * s;
    seg(key, v(0.8, 1.2, z * 0.8), v(0.98, 1.0, z), 0.02, 0.016, false); // scapula
    seg(key, v(0.96, 1.04, z), v(0.78, 0.78, z * 1.3), 0.026, 0.02);
    seg(key, v(0.78, 0.78, z * 1.3), v(1.02, 0.7, z * 1.4), 0.02, 0.016);
    for (const dz of [-0.025, 0, 0.025]) {
      const b = v(1.2, 0.6 + dz * 0.8, z * 1.4 + dz);
      seg(key, v(1.02, 0.7, z * 1.4), b, 0.011, 0.009);
      claw(key, b, v(0.3, -0.9, 0), 0.01, 0.06);
    }
  }

  // long, low skull with a slightly open jaw
  const skull = new THREE.Group();
  skull.position.set(1.4, 1.8, 0);
  skull.rotation.z = -0.14;
  g.add(skull);
  const len = 0.6;
  skull.add(new THREE.Mesh(skullGeo(len, 0.26, 0.09, 0.18, 0.07, -0.08), mat));
  for (const [x, y, sx, sy, w] of [[0.15, 0.08, 0.05, 0.05, 0.075], [0.33, 0.03, 0.08, 0.035, 0.06]]) {
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(SPHERE, dark);
      h.scale.set(sx, sy, 0.02);
      h.position.set(x, y, s * w);
      skull.add(h);
    }
  }
  for (let i = 0; i < 9; i++) {
    const x = 0.2 + i * 0.045;
    const w = THREE.MathUtils.lerp(0.18, 0.07, x / len) * 0.4;
    for (const s of [-1, 1]) claw(key, v(x, -0.075, s * w), v(0.15, -1, 0), 0.01, 0.035, skull);
  }
  const jaw = new THREE.Group();
  jaw.position.set(0.02, -0.09, 0);
  jaw.rotation.z = -0.18;
  skull.add(jaw);
  for (const s of [-1, 1]) seg(key, v(0, 0, s * 0.06), v(0.56, 0.01, s * 0.022), 0.024, 0.012, true, jaw);
}

// ====================================================================== Chicken (a living dinosaur)
function buildChicken({ knob, seg, claw, tube }, groups, mats) {
  const key = 'chicken', g = groups[key];
  const dark = new THREE.MeshStandardMaterial({ color: 0x22160e, roughness: 1 });

  // fused back (synsacrum) + hip blades
  knob(key, v(-0.06, 0.6, 0), 1).scale.set(0.2, 0.05, 0.07);
  for (const s of [-1, 1]) knob(key, v(-0.08, 0.6, s * 0.06), 1).scale.set(0.18, 0.055, 0.014);
  // short tail ending in the pygostyle
  for (let i = 0; i < 4; i++) knob(key, v(-0.24 - i * 0.03, 0.62 + i * 0.022, 0), 0.02);
  knob(key, v(-0.37, 0.72, 0), 1).scale.set(0.035, 0.05, 0.014);
  // S-curved neck
  const neck = new THREE.CatmullRomCurve3([v(0.12, 0.6), v(0.2, 0.72), v(0.19, 0.86), v(0.25, 0.98), v(0.3, 1.03)]);
  for (let i = 0; i < 12; i++) knob(key, neck.getPointAt(i / 11), 0.021 - i * 0.0006);

  // big keeled breastbone, ribs, wishbone
  knob(key, v(0.12, 0.42, 0), 1).scale.set(0.2, 0.11, 0.012);
  knob(key, v(0.1, 0.48, 0), 1).scale.set(0.2, 0.035, 0.085);
  for (let i = 0; i < 5; i++) {
    const x = -0.05 + i * 0.04;
    for (const s of [-1, 1]) tube(key, [v(x, 0.6, s * 0.03), v(x + 0.02, 0.57, s * 0.1), v(x + 0.05, 0.5, s * 0.1), v(x + 0.08, 0.47, s * 0.05)], 0.007);
  }
  tube(key, [v(0.21, 0.64, 0.07), v(0.25, 0.5, 0), v(0.21, 0.64, -0.07)], 0.007);
  for (const s of [-1, 1]) seg(key, v(0.18, 0.6, s * 0.05), v(0.16, 0.48, s * 0.03), 0.01, 0.01, false);

  // folded wings
  for (const s of [-1, 1]) {
    const z = 0.1 * s;
    seg(key, v(0.16, 0.62, z), v(-0.08, 0.56, z * 1.2), 0.016, 0.013);
    seg(key, v(-0.08, 0.56, z * 1.2), v(0.12, 0.53, z * 1.25), 0.012, 0.01);
    seg(key, v(0.12, 0.53, z * 1.25), v(-0.1, 0.51, z * 1.3), 0.009, 0.006);
  }

  // legs and feet
  for (const s of [-1, 1]) {
    const z = 0.06 * s;
    seg(key, v(-0.04, 0.56, z), v(0.08, 0.42, z), 0.02, 0.016);
    seg(key, v(0.08, 0.42, z), v(-0.04, 0.17, z), 0.016, 0.012);
    seg(key, v(-0.04, 0.17, z), v(0, 0.03, z), 0.012, 0.011);
    for (const dz of [-0.04, 0, 0.04]) {
      const b = v(0.13 - Math.abs(dz) * 0.5, 0.015, z + dz * 1.4);
      seg(key, v(0, 0.025, z), b, 0.008, 0.006);
      claw(key, b, v(1, -0.2, 0), 0.006, 0.02);
    }
    seg(key, v(0, 0.025, z), v(-0.07, 0.015, z), 0.007, 0.006);
  }

  // round skull, big eye socket, beak
  const head = new THREE.Group();
  head.position.set(0.32, 1.05, 0);
  g.add(head);
  knob(key, v(0, 0, 0), 1, head).scale.set(0.06, 0.05, 0.045);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(SPHERE, dark);
    eye.scale.set(0.025, 0.025, 0.01);
    eye.position.set(0.012, 0.008, s * 0.04);
    head.add(eye);
  }
  claw(key, v(0.04, -0.005, 0), v(1, -0.3, 0), 0.022, 0.08, head);
  claw(key, v(0.035, -0.025, 0), v(1, -0.15, 0), 0.014, 0.065, head);
}
