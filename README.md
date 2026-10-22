[![Built with TideCloak](https://tide.org/badges/built-with-tidecloak.svg)](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked)

## Project overview

Fossil Vault is a 3D dig-site game where players excavate dinosaur skeletons. The site's most sensitive records unlock only when the landowner, museum and heritage office agree, and no admin can override that.

Built with [TideCloak](https://tide.org/tidecloak?utm_source=github&utm_medium=readme&utm_campaign=unlocked).

### 1. Vision & originality

Paleontology as shared custody. Players chisel a T. rex, a raptor and a chicken (birds are dinosaurs) out of rock. Each find feeds a vault of high-stakes records (site coordinates, 3D scan, custody deed) that open only by quorum of the people with a real stake.

### 2. Trust constraint insight

Fossil sites are looted when coordinates leak, and specimens become court fights over authority (the FBI seized *Sue* in 1992). Whoever runs the database can read coordinates or rewrite custody, so landowners hide finds from science.

### 3. Value & impact

Landowners can report fossils without losing control. Museums and regulators get verifiable, co-signed decisions. Researchers get scans with the location stripped. Example: a rancher reports a skull. Its location stays sealed until the rancher and the heritage office both sign, so no curator, developer or hacker can sell it.

### 4. Why TideCloak matters

With ordinary login plus backend roles, root can still decrypt everything. With TideCloak's Emergent Authority, each record's key is split across ORK nodes. Each node releases its part only when the policy's signatures verify. "Force unlock" and forged signatures fail, because there is no master key to take.

### 5. Prototype & storytelling

Dig with the brush (the chisel can crack fragile bones), earn XP and badges, then open **Vault**. Request an unlock, switch identity to each stakeholder to sign, and watch the 5 ORKs vote. Then sign in as **root** and try to break in: every ORK refuses.

## Setup

```bash
git clone https://github.com/facingshootingstar/fossil-vault.git
cd fossil-vault
python -m http.server 5173
```
Open http://localhost:5173 (or double-click `run.bat`). The page needs internet once to load three.js and the fonts from a CDN.

### How TideCloak fits (Plan C: simulated)

Tide's network was under load, so `js/tidecloak-sim.js` simulates TideCloak using **real WebCrypto**:

| App piece | Simulation | Real TideCloak counterpart |
|---|---|---|
| Identity switcher | 5 identities, each with its own ECDSA P-256 key | TideCloak sign-in + realm roles |
| Approvals | Real signatures over the proposal | Quorum / multi-admin approval policy |
| Vault records | AES-256-GCM; key Shamir-split 3-of-5 across ORKs, then wiped | Tide data protection (encrypt/decrypt by role, keys held by ORKs) |
| Unlock | Each ORK verifies signatures + policy before releasing its share | ORKs enforce policy; no single party can decrypt |

Simplification: the demo recombines the key in the browser. Real Tide never reassembles the key anywhere.

### Code

- `js/skeleton.js`: procedural T. rex, Velociraptor and chicken skeletons (13 diggable elements, no model download)
- `js/main.js`: three.js scene, digging game, XP/badges, vault UI
- `js/tidecloak-sim.js`: simulated TideCloak / ORK network

All data is synthetic. Records are generated when the vault is sealed, so no secret is stored in the source. Coordinates are random points at Null Island (0° N, 0° E, open ocean). A decrypted record is shown only to the roles in its policy; root and the other roles see ciphertext.
