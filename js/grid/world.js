// snridworld: the garden as a markov process. tiles drift between types, the weather is its own little
// chain, food ripens and rots on its own chain, and every tick each tile rolls its dice:
// P(next type | type, weather, neighbours).
import { makeNoise, fbm, mulberry32, clamp } from '../util.js';

export const T = { SOIL: 0, DAMP: 1, MOSS: 2, LUSH: 3, PUDDLE: 4, POND: 5, PEBBLE: 6, LEAF: 7, LOG: 8, ROCK: 9, LAVENDER: 10, VOID: 11 };
export const TILE = [
  { key: 'soil', name: 'dry soil', icon: ".,'", pass: true },
  { key: 'damp', name: 'damp soil', icon: ':;,', pass: true },
  { key: 'moss', name: 'moss', icon: ';*%', pass: true },
  { key: 'lush', name: 'lush moss', icon: '%&@', pass: true },
  { key: 'puddle', name: 'puddle', icon: '~-~', pass: true, wet: true },
  { key: 'pond', name: 'pond', icon: '~~~', pass: false, wet: true, fixed: true },
  { key: 'pebble', name: 'pebbles', icon: 'oO.', pass: true, fixed: true },
  { key: 'leaf', name: 'leaf litter', icon: '/=%', pass: true },
  { key: 'log', name: 'fallen log', icon: '=-=', pass: true, fixed: true },
  { key: 'rock', name: 'boulder', icon: '#%@', pass: false, fixed: true },
  { key: 'lavender', name: 'lavender', icon: '*|*', pass: true, fixed: true },
  { key: 'void', name: 'the edge of the garden', icon: '   ', pass: false, fixed: true },
];
// what it is like to crawl off a tile: the per-terrain transition noise the snagents have to live with
export const MOVE_NOTE = {
  [T.PEBBLE]: '35% stuck in the gravel',
  [T.LEAF]: '20% veer sideways (crunchy)',
  [T.PUDDLE]: '30% slide one tile further',
  [T.LAVENDER]: 'snails hate the smell. achoo.',
};

export const W = { SUN: 0, CLOUD: 1, RAIN: 2, FOG: 3 };
export const WEATHER = [
  { name: 'sun', glyph: '*' },
  { name: 'cloud', glyph: 'o' },
  { name: 'rain', glyph: '/' },
  { name: 'fog', glyph: '=' },
];
// rows: from, cols: to. rolled every few seconds, so sunny spells are geometric
export const WP = [
  [.72, .22, .00, .06],
  [.18, .60, .17, .05],
  [.00, .26, .68, .06],
  [.16, .22, .04, .58],
];

export const FOOD = {
  mushroom: { name: 'mushroom', v: 1.2 },
  cucumber: { name: 'cucumber', v: 2.4 },
  berry: { name: 'strawberry', v: 1.8 },
};
export const STAGE = ['fresh', 'overripe'];

export class World {
  constructor(cols, rows, seed) {
    this.cols = cols; this.rows = rows; this.n = cols * rows; this.seed = seed;
    this.rng = mulberry32(seed);
    const n = this.n;
    this.type = new Uint8Array(n); this.prev = new Uint8Array(n); this.fade = new Float32Array(n).fill(1);
    this.elev = new Float32Array(n); this.food = new Array(n).fill(null);
    this.weather = W.CLOUD; this.history = [W.CLOUD]; this.lastRoll = null;
    this.tick = 0; this.bush = -1; this.events = [];
    this.gen();
  }
  idx(x, y) { return y * this.cols + x; }
  nb(i, dx, dy) {
    const x = i % this.cols + dx, y = (i / this.cols | 0) + dy;
    return x < 0 || y < 0 || x >= this.cols || y >= this.rows ? -1 : y * this.cols + x;
  }
  pass(i) { return i >= 0 && TILE[this.type[i]].pass; }
  inside(i) { return i >= 0 && this.type[i] !== T.VOID; }

  gen() {
    const r = this.rng, N = [0, 1, 2, 3, 4].map(() => makeNoise(r)), EN = makeNoise(r);
    const { cols, rows, n } = this;
    // the garden's outline: a lumpy island. edge(x, y) > 0 is inside, in continuous tile units
    this.edge = (x, y) => {
      const u = (x - cols / 2) / (cols / 2 - .6), v = (y - rows / 2) / (rows / 2 - .5);
      const border = Math.min(x, y, cols - x, rows - y);   // tiles to the nearest grid edge
      return .92 - Math.hypot(u, v) + (fbm(EN, x / 4.2, y / 3.6, 3) - .5) * 1.25 + (EN(x * 1.2 + 50, y * 1.2) - .5) * .16
        - Math.max(0, 3.2 - border) * .45;
    };
    const ins = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const x = i % cols, y = i / cols | 0;
      ins[i] = x > 0 && y > 0 && x < cols - 1 && y < rows - 1 && this.edge(x + .5, y + .5) > .04 ? 1 : 0;
    }
    // keep only the biggest connected piece, so nobody is marooned on a stray islet
    const comp = new Int32Array(n).fill(-1); let best = -1, bestN = 0;
    for (let i = 0; i < n; i++) {
      if (!ins[i] || comp[i] >= 0) continue;
      const q = [i]; comp[i] = i; let cnt = 0;
      while (q.length) {
        const j = q.pop(); cnt++;
        for (const [dx, dy] of NB4) { const k = this.nb(j, dx, dy); if (k >= 0 && ins[k] && comp[k] < 0) { comp[k] = i; q.push(k); } }
      }
      if (cnt > bestN) { bestN = cnt; best = i; }
    }
    for (let i = 0; i < n; i++) ins[i] = comp[i] === best ? 1 : 0;

    let lo = 1e9, hi = -1e9;
    for (let i = 0; i < n; i++) {
      const x = i % cols, y = i / cols | 0;
      const e = fbm(N[0], x / 8, y / 6, 3) + .22 * (N[4](x / 2.4, y / 2.4) - .5);
      this.elev[i] = e;
      if (ins[i]) { lo = Math.min(lo, e); hi = Math.max(hi, e); }
    }
    for (let i = 0; i < n; i++) {
      const x = i % cols, y = i / cols | 0;
      const e = this.elev[i] = clamp((this.elev[i] - lo) / (hi - lo), 0, 1);
      if (!ins[i]) { this.type[i] = T.VOID; continue; }
      const m = fbm(N[1], x / 6 + 20, y / 5, 3), p = N[2](x / 3.2, y / 3.2), l = N[3](x / 3.8 + 7, y / 3.8);
      let t;
      if (e < .12) t = T.POND;
      else if (e < .21) t = T.PUDDLE;
      else if (e > .86 && N[4](x / 1.7, y / 1.7) > .45) t = T.ROCK;
      else if (p > .8) t = T.PEBBLE;
      else if (l > .79) t = T.LEAF;
      else {
        const w = (m - .5) * 1.6 + (1 - e) * .55 + .2;
        t = w > .68 ? T.LUSH : w > .54 ? T.MOSS : w > .4 ? T.DAMP : T.SOIL;
      }
      this.type[i] = t;
    }
    const land = i => i >= 0 && ![T.POND, T.ROCK, T.LOG, T.LAVENDER, T.VOID, T.PUDDLE].includes(this.type[i]);
    // a couple of fallen logs
    for (let logs = 0, k = 0; k < 400 && logs < Math.max(2, Math.round(n / 700)); k++) {
      const len = 3 + Math.floor(r() * 3), y = 1 + Math.floor(r() * (rows - 2)), x0 = Math.floor(r() * (cols - len));
      let ok = true;
      for (let x = x0 - 1; x <= x0 + len; x++) if (!land(this.idx(clamp(x, 0, cols - 1), y))) ok = false;
      if (!ok) continue;
      for (let x = x0; x < x0 + len; x++) this.type[this.idx(x, y)] = T.LOG;
      logs++;
    }
    // a lavender patch. the cliff-walking homage: a strip snails avoid, right next to nice moss
    for (let patches = 0, k = 0; k < 400 && patches < Math.max(1, Math.round(n / 1300)); k++) {
      const i = Math.floor(r() * n);
      if (!land(i) || this.edge(i % cols + .5, (i / cols | 0) + .5) < .25) continue;
      if (this.bush < 0) this.bush = i;
      this.type[i] = T.LAVENDER; patches++;
      const spill = [[1, 0], [2, 0], [1, 1], [-1, 0], [0, 1], [2, 1]].filter(() => r() < .6);
      for (const [dx, dy] of spill) { const j = this.nb(i, dx, dy); if (land(j)) this.type[j] = T.LAVENDER; }
    }
    // a few mushrooms to start
    for (let i = 0; i < n; i++) if (this.type[i] === T.LUSH && r() < .07) this.food[i] = makeFood('mushroom', r, 1);
  }

  // P(next | this tile, weather, neighbours) as [[type, p], ...], stay first
  transitions(i, wthr = this.weather) {
    const t = this.type[i];
    if (TILE[t].fixed) return [[t, 1]];
    let moss = 0, wet = 0, puddle = 0;
    for (const [dx, dy] of NB4) {
      const j = this.nb(i, dx, dy); if (j < 0) continue;
      const u = this.type[j];
      if (u === T.MOSS || u === T.LUSH) moss++;
      if (u === T.PUDDLE || u === T.POND) wet++;
      if (u === T.PUDDLE) puddle++;
    }
    // elevation bends every rate: hollows hold water and grow moss, hilltops dry out first
    const e = this.elev[i], low = clamp((.5 - e) * 2.5, 0, 1);
    const wf = clamp(1.6 - 1.4 * e, .3, 1.6), df = clamp(.3 + 1.4 * e, .3, 1.6), sh = wet ? .3 : 1;
    const out = [];
    const add = (k, p) => { if (p > 0) out.push([k, p]); };
    switch (wthr) {
      case W.RAIN:
        if (t === T.SOIL) add(T.DAMP, .14 * wf);
        if (t === T.DAMP) { add(T.PUDDLE, .01 + .12 * low + .03 * puddle); add(T.MOSS, (.004 + .02 * moss) * wf); }
        if (t === T.MOSS) add(T.LUSH, .03 * wf);
        if (t === T.LEAF) add(T.DAMP, .03);
        break;
      case W.FOG:
        if (t === T.SOIL) add(T.DAMP, .04 * wf);
        if (t === T.DAMP) add(T.MOSS, (.004 + .02 * moss) * wf);
        if (t === T.MOSS) add(T.LUSH, .02 * wf);
        if (t === T.PUDDLE) add(T.DAMP, .02);
        break;
      case W.CLOUD:
        if (t === T.PUDDLE) add(T.DAMP, .01 + .04 * (1 - low));
        if (t === T.DAMP) { add(T.MOSS, .015 * moss * wf); add(T.SOIL, .015 * df); }
        if (t === T.LUSH) add(T.MOSS, .015 * df);
        if (t === T.MOSS) add(T.SOIL, .004 * df * sh);
        if (t === T.SOIL || t === T.DAMP || t === T.MOSS) add(T.LEAF, .003);
        if (t === T.LEAF) add(T.DAMP, .008);
        break;
      case W.SUN:
        if (t === T.PUDDLE) add(T.DAMP, .1 * (1 - .6 * low));
        if (t === T.DAMP) add(T.SOIL, .06 * df * sh);
        if (t === T.LUSH) add(T.MOSS, .03 * df * sh);
        if (t === T.MOSS) add(T.SOIL, .009 * df * (wet ? .15 : 1) * (moss > 2 ? .35 : 1));
        if (t === T.LEAF) add(T.SOIL, .01);
        break;
    }
    let sum = out.reduce((s, [, p]) => s + p, 0);
    if (sum > .95) { out.forEach(o => o[1] *= .95 / sum); sum = .95; }
    out.unshift([t, 1 - sum]);
    return out;
  }

  // food has its own little chain: fresh -> overripe (fruit flies) -> compost, which turns the tile to lush moss
  foodTransitions(i, wthr = this.weather) {
    const f = this.food[i];
    if (!f || f.grow < 1) return [];
    const sun = wthr === W.SUN, shroom = f.kind === 'mushroom';
    if (f.stage === 0) { const p = shroom ? (sun ? .05 : .012) : .018; return [['stays fresh', 1 - p], ['-> overripe', p]]; }
    const p = shroom ? .06 : .04;
    return [['stays overripe', 1 - p], ['-> compost', p]];
  }

  setType(i, t) {
    if (this.type[i] === t) return false;
    this.prev[i] = this.type[i]; this.type[i] = t; this.fade[i] = 0;
    return true;
  }

  // one tick of the tile chain. returns the tiles that changed; food happenings land in this.events
  step(night = 0) {
    this.tick++; this.events = [];
    const r = this.rng, changed = [], wx = this.weather;
    for (let i = 0; i < this.n; i++) {
      const tr = this.transitions(i, wx);
      if (tr.length < 2) continue;
      let u = r(), k = tr[0][0];
      for (const [t, p] of tr) { if ((u -= p) < 0) { k = t; break; } }
      if (this.setType(i, k)) changed.push(i);
    }
    let shrooms = 0;
    for (const f of this.food) if (f && f.kind === 'mushroom') shrooms++;
    const damp = wx === W.RAIN || wx === W.FOG || night > .5;
    for (let i = 0; i < this.n; i++) {
      const f = this.food[i], t = this.type[i];
      if (f) {
        const tr = this.foodTransitions(i, wx);
        if (tr.length && r() < tr[1][1]) {
          if (f.stage === 0) { f.stage = 1; this.events.push({ t: 'overripe', i, f }); }
          else {
            this.food[i] = null; this.events.push({ t: 'compost', i, f });
            if (!TILE[t].fixed && t !== T.PUDDLE && this.setType(i, T.LUSH)) changed.push(i);
          }
        }
        continue;
      }
      if (damp && shrooms < Math.round(this.n / 110) && (t === T.LUSH || t === T.MOSS)) {
        let byLog = false;
        for (const [dx, dy] of NB4) if (this.type[this.nb(i, dx, dy)] === T.LOG) byLog = true;
        if (r() < (t === T.LUSH ? .005 : .001) + (byLog ? .03 : 0)) { this.food[i] = makeFood('mushroom', r); shrooms++; this.events.push({ t: 'sprout', i, f: this.food[i] }); }
      }
    }
    return changed;
  }

  stepWeather() {
    const from = this.weather, row = WP[from];
    let u = this.rng(), to = from;
    for (let k = 0; k < 4; k++) { if ((u -= row[k]) < 0) { to = k; break; } }
    this.weather = to; this.lastRoll = { from, to, p: row[to] };
    this.history.push(to); if (this.history.length > 18) this.history.shift();
    return to !== from;
  }
}

export const NB4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];
let FOOD_ID = 1;
export function makeFood(kind, r = Math.random, grown = 0) {
  return { id: FOOD_ID++, kind, bites: 0, max: kind === 'mushroom' ? 3 : 4, grow: grown, hue: r(), stage: 0 };
}
