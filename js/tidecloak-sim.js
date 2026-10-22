// Simulated TideCloak layer (Plan C of the UNLOCKED brief).
//
// What is real here (WebCrypto, runs in the browser):
//   - every identity has its own ECDSA P-256 key pair; approvals are real signatures
//   - each protected record is AES-256-GCM encrypted; the key is Shamir-split 3-of-5 across
//     five simulated Tide ORK nodes and then wiped - nobody (server, admin, us) keeps it
//   - every ORK independently verifies the signatures + policy before releasing its share
// What is simulated: sign-in (a role switcher), and the ORK network itself (in-page objects).
// In real TideCloak the key is never reassembled anywhere; here we recombine it in-page for the demo.

const enc = new TextEncoder();
const dec = new TextDecoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const ROLES = {
  paleo:     { id: 'paleo',     name: 'Dr. Linh Tran',  title: 'Paleontologist',   icon: '🦴', color: '#e8a33d' },
  custodian: { id: 'custodian', name: 'Ruth Walker',    title: 'Landowner',        icon: '🏞️', color: '#7fc97f' },
  curator:   { id: 'curator',   name: 'Dr. Ana Costa',  title: 'Museum',           icon: '🏛️', color: '#8fb3ff' },
  heritage:  { id: 'heritage',  name: 'Joseph Okafor',  title: 'Heritage office',  icon: '⚖️', color: '#d59bf6' },
  root:      { id: 'root',      name: 'root',           title: 'Sysadmin',         icon: '🛠️', color: '#ff6b6b' },
};

// Policies: `all` must all sign; plus at least `atLeast` of `anyOf`.
export const ACTIONS = {
  coords: {
    title: 'Site coordinates', icon: '📍',
    policy: { all: ['custodian'], anyOf: ['curator', 'heritage'], atLeast: 1 },
    needsBones: 0,
    payload: {
      kind: 'coords',
      site: 'HC-07 "Ruth\'s Ridge"',
      lat: '47.61834° N', lon: '106.92217° W',
      note: 'Hell Creek Fm. · north gate',
    },
  },
  scan: {
    title: '3D scan', icon: '🔬',
    policy: { all: ['curator', 'heritage'], anyOf: [], atLeast: 0 },
    needsBones: 6,
    payload: {
      kind: 'scan',
      dataset: 'FV-HC07 scan v1',
      detail: '13 elements · 2.4 M triangles',
      licence: 'CC BY-NC · no location',
    },
  },
  transfer: {
    title: 'Transfer to museum', icon: '📜',
    policy: { all: ['custodian', 'curator', 'heritage'], anyOf: [], atLeast: 0 },
    needsBones: 13,
    payload: {
      kind: 'transfer',
      deed: 'FV-2026-0001',
      to: 'Museum of Deep Time',
      royalty: '12% to landowner',
    },
  },
};

export function policyText(p) {
  const n = (r) => ROLES[r].title;
  const parts = p.all.map(n);
  if (p.atLeast) parts.push(`${p.atLeast} of (${p.anyOf.map(n).join(' / ')})`);
  return parts.join(' + ');
}

export function policySatisfied(p, approvers) {
  const set = new Set(approvers);
  return p.all.every((r) => set.has(r)) && p.anyOf.filter((r) => set.has(r)).length >= p.atLeast;
}

export function eligible(p, role) {
  return p.all.includes(role) || p.anyOf.includes(role);
}

// ---------- Shamir secret sharing over GF(256) ----------
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x; LOG[x] = i;
    x ^= x << 1; if (x & 0x100) x ^= 0x11b; // multiply by generator 3
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gmul = (a, b) => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const gdiv = (a, b) => (a ? EXP[(LOG[a] + 255 - LOG[b]) % 255] : 0);

function split(secret, n, t) {
  const shares = Array.from({ length: n }, (_, i) => ({ x: i + 1, y: new Uint8Array(secret.length) }));
  const coeffs = new Uint8Array(t - 1);
  for (let b = 0; b < secret.length; b++) {
    crypto.getRandomValues(coeffs);
    for (const s of shares) {
      let acc = 0, xp = 1;
      acc ^= secret[b];
      for (const c of coeffs) { xp = gmul(xp, s.x); acc ^= gmul(c, xp); }
      s.y[b] = acc;
    }
  }
  return shares;
}

function combine(shares) {
  const out = new Uint8Array(shares[0].y.length);
  for (let b = 0; b < out.length; b++) {
    let acc = 0;
    for (const i of shares) {
      let num = 1, den = 1;
      for (const j of shares) if (i !== j) { num = gmul(num, j.x); den = gmul(den, i.x ^ j.x); }
      acc ^= gmul(i.y[b], gdiv(num, den));
    }
    out[b] = acc;
  }
  return out;
}

// ---------- The simulated network ----------
const ORK_REGIONS = ['Melbourne', 'Singapore', 'Frankfurt', 'São Paulo', 'Toronto'];
export const THRESHOLD = 3;

export class TideSim {
  constructor() {
    this.current = 'paleo';
    this.proposals = [];
    this.audit = [];
    this.listeners = new Set();
  }

  on(fn) { this.listeners.add(fn); }
  emit() { for (const fn of this.listeners) fn(); }
  log(msg, kind = 'info') {
    this.audit.unshift({ t: new Date(), who: this.current, msg, kind });
    this.emit();
  }

  async init() {
    this.identities = {};
    for (const id of Object.keys(ROLES)) {
      this.identities[id] = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    }
    this.orks = ORK_REGIONS.map((region, i) => ({ id: `ORK-${i + 1}`, region, shares: {} }));
    this.vault = {};
    for (const [id, a] of Object.entries(ACTIONS)) {
      const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
      const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(a.payload)));
      split(raw, this.orks.length, THRESHOLD).forEach((s, i) => { this.orks[i].shares[id] = s; });
      raw.fill(0); // the only full copy of the key is destroyed here
      this.vault[id] = { iv, ct: new Uint8Array(ct), opened: false };
    }
    this.log('Vault sealed · keys split 3-of-5', 'sys');
  }

  login(role) {
    this.current = role;
    this.log(`Signed in: ${ROLES[role].name}`, 'auth');
  }

  ciphertextPreview(id) { return hex(this.vault[id].ct).slice(0, 48) + '…'; }

  request(actionId) {
    const p = { id: crypto.randomUUID().slice(0, 8), action: actionId, by: this.current, sigs: {}, status: 'open', created: new Date() };
    this.proposals.unshift(p);
    this.log(`Request: ${ACTIONS[actionId].title}`, 'req');
    return p;
  }

  message(p) { return enc.encode(`${p.id}|${p.action}|APPROVE`); }

  async approve(pid) {
    const p = this.proposals.find((x) => x.id === pid);
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.identities[this.current].privateKey, this.message(p));
    p.sigs[this.current] = new Uint8Array(sig);
    this.log(`Signed · ${hex(sig).slice(0, 12)}…`, 'sign');
  }

  // root has full database + server access, so it can fabricate a proposal "signed" by the
  // stakeholders - but only with its own key, because their private keys never left their devices.
  async forge(actionId) {
    const p = { id: 'forged-' + Date.now().toString(36), action: actionId, by: 'root', sigs: {}, status: 'forged' };
    const pol = ACTIONS[actionId].policy;
    for (const role of [...pol.all, ...pol.anyOf]) {
      p.sigs[role] = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.identities.root.privateKey, this.message(p)));
    }
    this.log(`root forged ${Object.keys(p.sigs).length} signatures`, 'deny');
    return p;
  }

  // Each ORK decides on its own. `override` models an admin asking nicely - ORKs simply ignore it.
  async orkEvaluate(ork, p, override) {
    const pol = ACTIONS[p.action].policy;
    const valid = [], forged = [];
    for (const [role, sig] of Object.entries(p.sigs)) {
      const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, this.identities[role].publicKey, sig, this.message(p));
      (ok ? valid : forged).push(role);
    }
    if (forged.length && !policySatisfied(pol, valid)) {
      return { ok: false, reason: 'forged' };
    }
    if (!policySatisfied(pol, valid)) {
      return { ok: false, reason: override ? 'override ignored' : 'missing sig' };
    }
    return { ok: true, share: ork.shares[p.action] };
  }

  async execute(pid, { override = false, proposal, onOrk } = {}) {
    const p = proposal ?? this.proposals.find((x) => x.id === pid) ?? { id: 'root-' + Date.now().toString(36), action: pid, sigs: {}, by: this.current };
    const shares = [];
    for (const ork of this.orks) {
      const r = await this.orkEvaluate(ork, p, override);
      if (r.ok) shares.push(r.share);
      if (onOrk) await onOrk(ork, r);
    }
    if (shares.length < THRESHOLD) {
      p.status = override ? 'blocked' : p.status;
      this.log(`${override ? 'Override' : 'Unlock'} refused · ${this.orks.length - shares.length}/${this.orks.length} ORKs said no`, 'deny');
      return { ok: false };
    }
    const raw = combine(shares.slice(0, THRESHOLD));
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    raw.fill(0);
    const v = this.vault[p.action];
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: v.iv }, key, v.ct);
    p.status = 'executed';
    v.opened = true;
    this.log(`Unlocked: ${ACTIONS[p.action].title} (${shares.length}/${this.orks.length} ORKs)`, 'ok');
    return { ok: true, payload: JSON.parse(dec.decode(pt)) };
  }
}
