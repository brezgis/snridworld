// the snails' heads. a shared model of how crawling works (P), and three ways of choosing:
// value iteration (knows P and R, plans), q-learning with or without replay (learns from bumps), and none at all.
import { T } from './world.js';

export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0], [0, 0]];   // N E S W stay
export const TAG = { OK: 0, STUCK: 1, VEER: 2, SLIP: 3, BUMP: 4, STAY: 5 };
export const GAMMA = .94;
const K = 3;   // at most three outcomes per (state, action)

// P(s' | s, a) for the current terrain, flattened so value iteration does not allocate
export class Model {
  constructor(world) {
    this.w = world; const m = world.n * 5 * K;
    this.ns = new Int32Array(m); this.np = new Float32Array(m); this.tag = new Uint8Array(m);
    this.rebuild();
  }
  rebuild() {
    const w = this.w, { ns, np, tag } = this;
    const go = (s, d) => { const j = w.nb(s, DIRS[d][0], DIRS[d][1]); return w.pass(j) ? j : -1; };
    for (let s = 0; s < w.n; s++) {
      const t = w.type[s];
      for (let a = 0; a < 5; a++) {
        const out = [];
        if (a === 4 || !w.pass(s)) out.push([s, 1, TAG.STAY]);
        else {
          const move = (d, p, tg) => {
            const j = go(s, d);
            if (j < 0) { out.push([s, p, TAG.BUMP]); return; }
            if (t === T.PUDDLE && tg === TAG.OK) {
              const k = go(j, d);
              if (k >= 0) { out.push([j, p * .7, TAG.OK]); out.push([k, p * .3, TAG.SLIP]); return; }
            }
            out.push([j, p, tg]);
          };
          let rest = 1;
          if (t === T.PEBBLE) { out.push([s, .35, TAG.STUCK]); rest = .65; }
          if (t === T.LEAF) { move(a, .8 * rest, TAG.OK); move((a + 1) % 4, .1 * rest, TAG.VEER); move((a + 3) % 4, .1 * rest, TAG.VEER); }
          else move(a, rest, TAG.OK);
        }
        const o = (s * 5 + a) * K;
        for (let k = 0; k < K; k++) {
          const e = out[k];
          ns[o + k] = e ? e[0] : s; np[o + k] = e ? e[1] : 0; tag[o + k] = e ? e[2] : TAG.STAY;
        }
      }
    }
  }
  sample(s, a, rng = Math.random) {
    const o = (s * 5 + a) * K; let u = rng();
    for (let k = 0; k < K; k++) if ((u -= this.np[o + k]) < 0 || k === K - 1 || this.np[o + k + 1] === 0) return [this.ns[o + k], this.tag[o + k]];
    return [s, TAG.STAY];
  }
  likely(s, a) {   // the most probable landing tile, for drawing intent
    const o = (s * 5 + a) * K; let best = 0;
    for (let k = 1; k < K; k++) if (this.np[o + k] > this.np[o + best]) best = k;
    return this.ns[o + best];
  }
}

const argmax = (Q, s, rng) => {
  let best = -1e9, pick = 4, ties = 0;
  for (let a = 0; a < 5; a++) {
    const q = Q[s * 5 + a];
    if (q > best + 1e-9) { best = q; pick = a; ties = 1; }
    else if (Math.abs(q - best) <= 1e-9 && rng() * ++ties < 1) pick = a;
  }
  return pick;
};

// knows the rules, sweeps the whole garden (synchronously, so you can watch value ripple out from food)
export class Planner {
  constructor(n) { this.kind = 'plan'; this.V = new Float32Array(n); this.V2 = new Float32Array(n); this.Q = new Float32Array(n * 5); this.eps = .03; }
  // term[s] = 1 where a meal waits: reaching it is a goal, so the future is cut there (classic gridworld terminal)
  sweep(model, rew, term) {
    const { V, V2, Q } = this, { ns, np } = model, w = model.w;
    for (let s = 0; s < w.n; s++) {
      if (!w.pass(s)) { V2[s] = 0; continue; }
      let best = -1e9;
      for (let a = 0; a < 5; a++) {
        const o = (s * 5 + a) * K; let q = 0;
        for (let k = 0; k < K; k++) { const p = np[o + k]; if (p) { const j = ns[o + k]; q += p * (rew[j] + (term[j] ? 0 : GAMMA * V[j])); } }
        Q[s * 5 + a] = q; if (q > best) best = q;
      }
      V2[s] = best;
    }
    this.V = V2; this.V2 = V;
  }
  act(s, rng = Math.random) { return rng() < this.eps ? Math.floor(rng() * 4) : argmax(this.Q, s, rng); }
  value(s) { return this.V[s]; }
  greedy(s) { return argmax(this.Q, s, () => .5); }
}

// learns only from what happens to it. replay > 0 makes it dyna-q: it daydreams old transitions between steps
export class Learner {
  constructor(n, replay = 0) {
    this.kind = 'learn'; this.replay = replay;
    this.Q = new Float32Array(n * 5).fill(.8);     // optimistic: everything might be wonderful
    this.visits = new Uint32Array(n); this.mem = new Map(); this.keys = []; this.alpha = .3;
  }
  eps(s) { return Math.max(.05, .7 / Math.sqrt(1 + this.visits[s] * .45)); }
  act(s, rng = Math.random) { return rng() < this.eps(s) ? Math.floor(rng() * 5) : argmax(this.Q, s, rng); }
  maxQ(s) { let m = -1e9; for (let a = 0; a < 5; a++) m = Math.max(m, this.Q[s * 5 + a]); return m; }
  upd(s, a, r, s2, done) { const i = s * 5 + a; this.Q[i] += this.alpha * (r + (done ? 0 : GAMMA * this.maxQ(s2)) - this.Q[i]); }
  // returns what it remembered about this move before, so the snail can be surprised
  learn(s, a, r, s2, done) {
    this.visits[s]++;
    this.upd(s, a, r, s2, done);
    const key = s * 5 + a, before = this.mem.get(key);
    if (this.replay) {
      if (!before) this.keys.push(key);
      this.mem.set(key, [r, s2, done]);
      for (let k = 0; k < this.replay; k++) {
        const kk = this.keys[Math.floor(Math.random() * this.keys.length)], [rr, ss, dd] = this.mem.get(kk);
        this.upd(kk / 5 | 0, kk % 5, rr, ss, dd);
      }
    }
    return before;
  }
  value(s) { return this.maxQ(s); }
  greedy(s) { return argmax(this.Q, s, () => .5); }
}

// a snladybug. no rewards, no plans: a uniform random walk, i.e. a plain markov chain over tiles
export class Wanderer {
  constructor(n) { this.kind = 'random'; this.visits = new Float32Array(n); this.total = 0; }
  act(s, rng = Math.random) { return Math.floor(rng() * 4); }
  visit(s) { this.visits[s]++; this.total++; }
  value(s) { return this.total ? this.visits[s] / this.total : 0; }
  greedy() { return -1; }
}
