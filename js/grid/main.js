// snridworld: a gridworld garden. the tiles are a markov chain, the weather is a markov chain, food ripens and
// rots on its own chain, and the snails are little MDP snagents: some plan with value iteration, some learn by
// bumping into things. they smell food, race for it, sleep at night and lay eggs that inherit their brains.
import { World, T, TILE, W, WEATHER, WP, FOOD, STAGE, MOVE_NOTE, NB4, makeFood } from './world.js';
import { Model, Planner, Learner, Wanderer, DIRS, TAG, GAMMA } from './brain.js';
import { makeTextures, hsh } from './textures.js';
import { THEME, C, ui as uiPal } from './theme.js';
import { makeNoise, fbm, mulberry32, clamp, lerp, pick, rand, mirror, hex } from '../util.js';

const TW = 7, TH = 3;                         // a tile is 7 x 3 characters
const $ = s => document.querySelector(s);
const cv = $('#scene'), ctx = cv.getContext('2d');
const L = {};
const S = {
  t: 0, sim: 0, speed: 1, paused: false, view: 0, tool: 'cucumber', test: location.search.includes('test'),
  tickT: 0, wxT: 0, sweepT: 0, tintT: 1, waterT: 1, atmoT: 1, overT: 1, uiT: 1, night: 0, cardOpen: false,
  hover: -1, mx: -1, my: -1, lv: [0, 1, 0, 0],   // smoothed weather levels: sun cloud rain fog
  camX: 0, camY: 0, goal: null, drag: null, follow: false, menu: false,
};
let seed = (Math.random() * 2 ** 31) | 0;
let world, model, tex, snagents = [], eggs = [], sel = 0;
let charTile, charLX, charLY, charEdge, charEA, shownT, tileChars;
let terrain, vp = {}, tiny = {};   // terrain: a screen-sized layer that scrolls with the camera
let dirty = new Set(), fading = new Set(), tintDirty = true;
let trail = new Map(), parts = [], floats = [], flies = [], butterflies = [];
let NF1, NF2;

const WET = t => t === T.PUDDLE || t === T.POND;
const BASE_R = [-.25, 0, .03, .08, .04, 0, -.06, 0, .03, 0, -1.2, 0];   // reward for entering each tile type
// soft ground colour per terrain, one pixel per character, smoothed up: the map reads as a patchwork, not noise
const TINT_L = [
  [226, 188, 124, .2], [150, 112, 76, .17], [112, 186, 66, .18], [64, 150, 46, .26], [70, 145, 245, .24], [42, 112, 232, .4],
  [140, 148, 160, .15], [218, 128, 46, .18], [140, 96, 60, .2], [100, 112, 130, .22], [162, 124, 218, .24], [0, 0, 0, 0],
];
const TINT_D = [
  [140, 104, 64, .12], [105, 80, 58, .16], [56, 150, 70, .2], [50, 195, 85, .27], [55, 125, 250, .3], [45, 105, 240, .42],
  [130, 138, 152, .1], [195, 105, 40, .16], [140, 92, 56, .2], [110, 124, 145, .18], [160, 120, 230, .2], [0, 0, 0, 0],
];
const SPEEDS = [.25, .5, 1, 2, 4, 8];
const SWEEPS = 12;                // value-iteration sweeps per sim second
const SMELL = 5.5;                // tiles: how far a ripe meal's scent carries
const DAY = 160;                  // sim seconds per day
const GROW = 150;                 // sim seconds for a snaby to grow up
const MAX_SNAGENTS = 14;
const TOOLS = [
  { id: 'cucumber', key: '1', icon: '(:.:)', label: 'cucumber' },
  { id: 'berry', key: '2', icon: '\\V/', label: 'berry' },
  { id: 'lavender', key: '3', icon: '*|*', label: 'lavender' },
  { id: 'water', key: '4', icon: '~-~', label: 'water' },
  { id: 'moss', key: '5', icon: ',;%', label: 'moss' },
];
const NAMES = ['Pim', 'Okra', 'Lentil', 'Moth', 'Bean', 'Crumpet', 'Plum', 'Mabel', 'Sprout', 'Nib', 'Bramble', 'Thimble',
  'Dew', 'Spoon', 'Kettle', 'Sage', 'Wren', 'Button', 'Quill', 'Sorrel', 'Pebble', 'Toast', 'Cress', 'Ivy', 'Bun', 'Orzo'];

const CAST = [
  { name: 'Gerald', pr: 'he', brain: 'plan', shell: '#b77a2e', spiral: '@', role: 'the gourmand', fav: 'cucumber',
    blurb: 'lives to eat. cucumber above all else.', R: { food: 1.7 } },
  { name: 'Pea', pr: 'she', brain: 'plan', shell: '#5a8fd8', spiral: 'e', role: 'the bather', fav: 'berry',
    blurb: 'would live in a puddle if anyone let her.', R: { [T.PUDDLE]: .24, [T.SOIL]: -.45, [T.DAMP]: .02 } },
  { name: 'Mochi', pr: 'she', brain: 'plan', shell: '#b0606a', spiral: '&', role: 'the homebody', fav: 'mushroom',
    blurb: 'finds the plushest moss and stays put.', R: { [T.LUSH]: .17, [T.MOSS]: .07, [T.PEBBLE]: -.25, food: .8 } },
  { name: 'Fig', pr: 'he', brain: 'dyna', shell: '#8f8a3a', spiral: '%', role: 'the student', fav: 'berry',
    blurb: 'never read the rules. remembers everything, though.' },
  { name: 'Turnip', pr: 'he', brain: 'q', shell: '#c99a45', spiral: '8', role: 'the free spirit', fav: 'cucumber',
    blurb: 'no notes, no replay, big dreams.' },
  { name: 'Dot', pr: 'she', brain: 'random', shell: '#d4455a', role: 'a snladybug',
    blurb: 'a snladybug: not a snail, but snail-adjacent. has no goals. walks anyway.' },
];
const PRONOUN = { he: { sub: 'he', obj: 'him', pos: 'his' }, she: { sub: 'she', obj: 'her', pos: 'her' } };
const BRAIN_TXT = {
  plan: p => `value iteration. knows how crawling works (P) and what ${p.sub} likes (R), and re-plans the whole garden 12 times a second, counting only food ${p.sub} has smelled.`,
  dyna: p => `dyna-q. learns only from what happens to ${p.obj}, then daydreams 25 remembered moves after every step. follows ${p.pos} nose when ${p.sub} smells food.`,
  q: p => `plain q-learning. learns only from the single step ${p.sub} just took. follows ${p.pos} nose, eventually gets there.`,
  random: p => `none: a uniform random walk. ${p.pos} visit map converges to the stationary distribution of the chain.`,
};
const LINES = {
  idle: ['...', 'mm', 'slow is fine', 'ok', 'hm.', 'nice day', 'i am going places'],
  [W.RAIN]: ['rain!!', 'wet. good.', 'best weather', 'splish'],
  [W.SUN]: ['too bright', 'need damp', 'squint', 'hot shell'],
  [W.FOG]: ['spooky', 'soft air', 'where is everyone'],
  [T.LUSH]: ['so plush', 'comfy', 'moss :)', 'squish'], [T.PUDDLE]: ['bath time', 'splash', 'so wet'],
  [T.LOG]: ['old wood smells nice', 'log!', 'bark :)'], [T.SOIL]: ['crunchy. dry.', 'ugh, dust', 'parched'],
  [T.LEAF]: ['crinkle', 'leaves!'], [T.MOSS]: ['soft moss', 'mossy'],
  plan: ['as planned', 'V says this way', 'i have a plan', 'computing...'],
  dyna: ['i remember this', 'noted', 'hm, new', 'ah yes'],
  q: ['what is this', 'let me try...', 'new to me', 'is this good?'],
  random: ['?', '!', 'la', 'whee'],
  night: ['so dark', 'stars?', 'sleepy', 'night moss'],
};

/* ================================================================ layout, camera & layers */
function layout() {
  L.W = innerWidth; L.H = innerHeight; L.DPR = Math.min(2, devicePixelRatio || 1);
  L.FS = L.W < 640 ? 12 : 14;
  L.FONT = `${L.FS}px 'JetBrains Mono', ui-monospace, Menlo, monospace`;
  L.BOLD = `700 ${L.FS}px 'JetBrains Mono', ui-monospace, Menlo, monospace`;
  ctx.font = L.FONT;
  L.CW = ctx.measureText('M').width; L.CH = Math.round(L.FS * 1.25);
  L.M = 120;   // viewport layers overhang the screen by this much, so panning never shows a seam
  cv.width = Math.round(L.W * L.DPR); cv.height = Math.round(L.H * L.DPR);
  cv.style.width = L.W + 'px'; cv.style.height = L.H + 'px';
}
function sizeWorld() {
  // the garden is bigger than the screen: you wander it by dragging
  L.cols = clamp(Math.round(2.3 * L.W / (TW * L.CW)), 40, 64);
  L.rows = clamp(Math.round(2.3 * L.H / (TH * L.CH)), 28, 44);
  L.GC = L.cols * TW; L.GR = L.rows * TH; L.gw = L.GC * L.CW; L.gh = L.GR * L.CH;
}
function mkVP() {
  const c = document.createElement('canvas');
  c.width = Math.round((L.W + 2 * L.M) * L.DPR); c.height = Math.round((L.H + 2 * L.M) * L.DPR);
  const x = c.getContext('2d');
  return { cv: c, ctx: x, ox: 0, oy: 0 };
}
// start a viewport layer redraw at the current camera; returns the visible char range (with overhang)
function beginVP(l) {
  l.ox = S.camX; l.oy = S.camY;
  const c = l.ctx;
  c.setTransform(L.DPR, 0, 0, L.DPR, (L.M - l.ox) * L.DPR, (L.M - l.oy) * L.DPR);
  c.clearRect(l.ox - L.M, l.oy - L.M, L.W + 2 * L.M, L.H + 2 * L.M);
  c.font = L.FONT; c.textBaseline = 'top';
  return {
    gx0: clamp(Math.floor((l.ox - L.M) / L.CW), 0, L.GC), gx1: clamp(Math.ceil((l.ox + L.W + L.M) / L.CW), 0, L.GC),
    gy0: clamp(Math.floor((l.oy - L.M) / L.CH), 0, L.GR), gy1: clamp(Math.ceil((l.oy + L.H + L.M) / L.CH), 0, L.GR),
  };
}
function blitVP(l) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(l.cv, Math.round((l.ox - L.M - S.camX) * L.DPR), Math.round((l.oy - L.M - S.camY) * L.DPR)); }
const vpStale = l => Math.abs(l.ox - S.camX) > L.M * .7 || Math.abs(l.oy - S.camY) > L.M * .7;
function mkTiny(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); return { cv: c, ctx: x, img: x.createImageData(w, h) };
}
const camR = v => Math.round(v * L.DPR) / L.DPR;
const worldT = c => c.setTransform(L.DPR, 0, 0, L.DPR, -camR(S.camX) * L.DPR, -camR(S.camY) * L.DPR);
function clampCam() {
  const mx = L.W * .3, my = L.H * .3;
  S.camX = L.gw <= L.W ? (L.gw - L.W) / 2 : clamp(S.camX, -mx, L.gw - L.W + mx);
  S.camY = L.gh <= L.H ? (L.gh - L.H) / 2 : clamp(S.camY, -my, L.gh - L.H + my);
}
function lookAt(s, instant) {
  const x = ((s % world.cols) + .5) * TW * L.CW - L.W / 2, y = (((s / world.cols) | 0) + .5) * TH * L.CH - L.H / 2;
  if (instant) { S.camX = x; S.camY = y; clampCam(); } else S.goal = { x, y };
}

/* ================================================================ setup */
function init() {
  layout(); sizeWorld();
  world = new World(L.cols, L.rows, seed);
  model = new Model(world);
  tex = makeTextures(seed);
  const r = mulberry32(seed ^ 0xf00d); NF1 = makeNoise(r); NF2 = makeNoise(r);
  buildCharMap();
  vp = { water: mkVP(), atmo: mkVP(), over: mkVP() };
  tiny = { shade: mkTiny(L.GC, L.GR), veil: mkTiny(L.cols, L.rows), tint: mkTiny(L.GC, L.GR), tintB: mkTiny(L.GC, L.GR), paper: mkTiny(L.GC, L.GR) };
  paintPaper();
  dirty = new Set(); fading = new Set();
  for (let i = 0; i < world.n; i++) dirty.add(i);
  trail = new Map(); parts = []; floats = []; eggs = [];
  flies = Array.from({ length: 30 }, () => ({ x: rand(0, L.gw), y: rand(0, L.gh), ph: rand(0, 9), k: rand(0, 100) }));
  butterflies = Array.from({ length: 3 }, () => ({ x: rand(0, L.gw), y: rand(0, L.gh), vx: rand(-20, 20), vy: 0, k: rand(0, 100), col: pick(['#e0812f', '#d9b23a', '#c86a9a']) }));
  S.lv = [0, 1, 0, 0]; S.tickT = 0; S.wxT = 0; S.sim = 0;
  spawnSnagents();
  for (let k = 0; k < 40; k++) sweepAll();
  S.waterT = S.atmoT = S.overT = S.uiT = 1;
  S.camX = (L.gw - L.W) / 2; S.camY = (L.gh - L.H) / 2; clampCam();
  makeTerrain();
}

function buildCharMap() {
  const { GC, GR } = L, n = GC * GR, rng = mulberry32(seed ^ 0x1234), NJ = makeNoise(rng), NK = makeNoise(rng);
  charTile = new Int32Array(n); charLX = new Float32Array(n); charLY = new Float32Array(n); shownT = new Uint8Array(n);
  charEdge = new Float32Array(n); charEA = new Float32Array(n);
  tileChars = Array.from({ length: world.n }, () => []);
  const crisp = k => world.type[k] === T.LOG || k === world.bush;
  for (let gy = 0; gy < GR; gy++) for (let gx = 0; gx < GC; gx++) {
    const gi = gy * GC + gx, bx = gx / TW | 0, by = gy / TH | 0, b = world.idx(bx, by);
    // jitter which tile a character samples from, so the borders between terrains are ragged and organic
    let fx = (gx + .5) / TW + (NJ(gx / 5, gy / 2.2) - .5) * .62 + (NK(gx / 1.6, gy / .9) - .5) * .22;
    let fy = (gy + .5) / TH + (NK(gx / 5 + 30, gy / 2.2) - .5) * .5 + (NJ(gx / 1.6 + 9, gy / .9) - .5) * .18;
    let tx = clamp(Math.floor(fx), 0, L.cols - 1), ty = clamp(Math.floor(fy), 0, L.rows - 1), j = world.idx(tx, ty);
    if (crisp(b) || crisp(j)) { j = b; fx = (gx + .5) / TW; fy = (gy + .5) / TH; tx = bx; ty = by; }
    charTile[gi] = j; charLX[gi] = fx - tx; charLY[gi] = fy - ty;
    // the rim of the garden: a continuous field, so the edge frays character by character
    const F = world.edge((gx + .5) / TW, (gy + .5) / TH);
    charEdge[gi] = F; charEA[gi] = world.type[j] === T.VOID ? 0 : clamp(F / .16, 0, 1);
    tileChars[j].push(gi);
  }
}

function makeSnagent(def, s, brain) {
  const R = BASE_R.slice(); let food = 1;
  for (const [k, v] of Object.entries(def.R || {})) { if (k === 'food') food = v; else R[+k] = v; }
  return {
    ...def, brainObj: brain, R: def.Rarr || R, foodMul: def.foodMul ?? food, rew: new Float32Array(world.n), term: new Uint8Array(world.n),
    s, from: s, to: s, act: 4, tag: TAG.STAY, state: 'idle', mt: 0, dur: 1, wait: rand(.2, 1.5),
    face: Math.random() < .5 ? 1 : -1, phase: 0, hunger: rand(.2, .6), ret: 0, steps: 0, hist: [], curve: [],
    say: null, sayCD: rand(4, 14), shock: 0, blink: 0, blinkT: rand(2, 6), eatT: 0, pace: rand(.85, 1.15),
    knows: new Set(), meals: 0, eggCD: rand(150, 240), age: def.baby ? 0 : 1e9, sleepT: 0, zT: 0, gen: def.gen || 1,
  };
}
const newBrain = k => k === 'plan' ? new Planner(world.n) : k === 'dyna' ? new Learner(world.n, 25) : k === 'q' ? new Learner(world.n, 0) : new Wanderer(world.n);
function spawnSnagents() {
  const keepSel = sel;
  snagents = [];
  const taken = new Set();
  const cx = world.cols / 2, cy = world.rows / 2;
  for (const def of CAST) {
    const ok = i => world.pass(i) && world.type[i] !== T.LAVENDER && !taken.has(i);
    let s = -1;
    // start everyone near the middle, so the first view has company
    for (let k = 0; k < 600 && s < 0; k++) {
      const i = world.idx(clamp(Math.round(cx + rand(-1, 1) * (3 + k / 40)), 0, world.cols - 1), clamp(Math.round(cy + rand(-1, 1) * (2 + k / 60)), 0, world.rows - 1));
      if (ok(i) && (k > 300 || world.type[i] === T.MOSS || world.type[i] === T.LUSH)) s = i;
    }
    if (s < 0) s = [...Array(world.n).keys()].find(ok);
    taken.add(s);
    snagents.push(makeSnagent(def, s, newBrain(def.brain)));
  }
  sel = Math.min(keepSel, snagents.length - 1);
}

/* ================================================================ rewards, smell & brains */
const ripe = s => { const f = world.food[s]; return f && f.grow >= 1; };
const tdist = (a, b) => Math.hypot(a % world.cols - b % world.cols, ((a / world.cols) | 0) - ((b / world.cols) | 0));
// plan = true: only meals this snagent has smelled count (planners do not get to cheat)
function rewOf(a, s, moved = true, plan = false) {
  let r = a.R[world.type[s]];
  const f = world.food[s];
  if (moved && f && f.grow >= 1 && a.brain !== 'random' && (!plan || a.knows.has(f.id)))
    r += FOOD[f.kind].v * (f.stage ? .6 : 1) * a.foodMul * (f.kind === a.fav ? 1.5 : 1) * (.35 + a.hunger);
  return r;
}
function sweepAll() {
  for (const a of snagents) {
    if (a.brain !== 'plan') continue;
    for (let s = 0; s < world.n; s++) { a.rew[s] = rewOf(a, s, true, true); a.term[s] = ripe(s) && a.knows.has(world.food[s].id) ? 1 : 0; }
    a.brainObj.sweep(model, a.rew, a.term);
  }
}
const valueOf = (a, s) => a.brainObj.value(s);
function nearestKnown(a) {
  let best = -1, bd = 1e9;
  for (let i = 0; i < world.n; i++) {
    const f = world.food[i];
    if (!f || f.grow < 1 || !a.knows.has(f.id)) continue;
    const d = tdist(a.s, i); if (d < bd) { bd = d; best = i; }
  }
  return best;
}
// who can smell what: scent reaches SMELL tiles. noticing is a little event, with a '!' and a reaction
function smell() {
  for (let i = 0; i < world.n; i++) {
    const f = world.food[i];
    if (!f || f.grow < 1) continue;
    for (const a of snagents) {
      if (a.brain === 'random' || a.knows.has(f.id) || tdist(a.s, i) > SMELL) continue;
      a.knows.add(f.id);
      if (a.state === 'sleep') { if (a.hunger < .45) continue; a.state = 'idle'; a.wait = .4; setSay(a, '*sniff*', true); continue; }
      const p = artPos(a);
      parts.push({ t: 'glyph', gx: p.col + 2, gy: p.row - 1, ch: '!', col: a.shell, life: 1, vy: -1.2 });
      setSay(a, f.kind === a.fav ? pick([`${FOOD[f.kind].name}?!`, 'i smell my favorite', 'ooh ooh']) : pick(['smell that?', 'sniff sniff', 'food?', 'ooh']), true);
    }
  }
}
function stepToward(s, goal) {
  const gx = goal % world.cols, gy = goal / world.cols | 0, sx = s % world.cols, sy = s / world.cols | 0;
  const opts = [];
  for (let a = 0; a < 4; a++) {
    const j = world.nb(s, DIRS[a][0], DIRS[a][1]);
    if (!world.pass(j) || world.type[j] === T.LAVENDER) continue;
    const d = Math.abs(gx - (sx + DIRS[a][0])) + Math.abs(gy - (sy + DIRS[a][1]));
    if (d < Math.abs(gx - sx) + Math.abs(gy - sy)) opts.push(a);
  }
  return opts.length ? pick(opts) : -1;
}

/* ================================================================ terrain drawing */
// the terrain lives on a screen-sized layer (plus overhang) at full resolution. when the camera drifts far
// enough, the pixels are shifted and only the newly exposed strips are drawn
function setTerrainT(l) { l.ctx.setTransform(L.DPR, 0, 0, L.DPR, (L.M - l.ox) * L.DPR, (L.M - l.oy) * L.DPR); l.ctx.font = L.FONT; l.ctx.textBaseline = 'top'; }
function tRange(l, inset = 0) {
  return {
    gx0: clamp(Math.floor((l.ox - L.M) / L.CW) + inset, 0, L.GC), gx1: clamp(Math.ceil((l.ox + L.W + L.M) / L.CW) - inset, 0, L.GC),
    gy0: clamp(Math.floor((l.oy - L.M) / L.CH) + inset, 0, L.GR), gy1: clamp(Math.ceil((l.oy + L.H + L.M) / L.CH) - inset, 0, L.GR),
  };
}
function makeTerrain() {
  terrain = mkVP(); terrain.buf = mkVP();
  terrain.ox = camR(S.camX); terrain.oy = camR(S.camY); setTerrainT(terrain);
  terrain.R = tRange(terrain);
  for (let i = 0; i < world.n; i++) dirty.add(i);
}
function scrollTerrain() {
  const l = terrain, nx = camR(S.camX), ny = camR(S.camY);
  if (Math.abs(nx - l.ox) < L.M * .5 && Math.abs(ny - l.oy) < L.M * .5) return;
  const old = tRange(l, 1), b = l.buf;
  b.ctx.setTransform(1, 0, 0, 1, 0, 0); b.ctx.clearRect(0, 0, b.cv.width, b.cv.height);
  b.ctx.drawImage(l.cv, Math.round((l.ox - nx) * L.DPR), Math.round((l.oy - ny) * L.DPR));
  [l.cv, b.cv] = [b.cv, l.cv]; [l.ctx, b.ctx] = [b.ctx, l.ctx];
  l.ox = nx; l.oy = ny; setTerrainT(l); l.R = tRange(l);
  const R = l.R;
  for (let gy = R.gy0; gy < R.gy1; gy++) for (let gx = R.gx0; gx < R.gx1; gx++)
    if (gx < old.gx0 || gx >= old.gx1 || gy < old.gy0 || gy >= old.gy1) drawChar(gy * L.GC + gx);
}
function shown(ti, gx, gy) { return world.fade[ti] < 1 && hsh(gx, gy, 5) > world.fade[ti] ? world.prev[ti] : world.type[ti]; }
function drawChar(gi) {
  const c = terrain.ctx, gx = gi % L.GC, gy = gi / L.GC | 0, ti = charTile[gi], R = terrain.R;
  const onLayer = gx >= R.gx0 && gx < R.gx1 && gy >= R.gy0 && gy < R.gy1;
  let ty = shown(ti, gx, gy);
  const F = charEdge[gi], ea = charEA[gi];
  if (ea <= 0) ty = T.VOID;
  shownT[gi] = ty;
  const x0 = Math.round(gx * L.CW), x1 = Math.round((gx + 1) * L.CW), y0 = gy * L.CH;
  if (onLayer) c.clearRect(x0, y0, x1 - x0, L.CH);
  let shore = false;
  if (!WET(ty) && ty !== T.VOID) for (const [dx, dy] of NB4) {
    const x = gx + dx, y = gy + dy;
    if (x >= 0 && y >= 0 && x < L.GC && y < L.GR && WET(world.type[charTile[y * L.GC + x]])) { shore = true; break; }
  }
  const tx = ti % world.cols, tyy = ti / world.cols | 0;
  const [ch, col] = tex(ty, gx, gy, {
    lx: charLX[gi], ly: charLY[gi], lc: gx - tx * TW, lr: gy - tyy * TH, shore, now: S.t, bush: ti === world.bush, edge: F,
    endL: tx === 0 || world.type[ti - 1] !== T.LOG, endR: tx === world.cols - 1 || world.type[ti + 1] !== T.LOG,
  });
  const d = tiny.tint.img.data, k = gi * 4, tn = (THEME.dark ? TINT_D : TINT_L)[ty];
  const [r, g, b, al] = shore ? [110, 160, 225, (THEME.dark ? 40 : 50) * ea] : [tn[0], tn[1], tn[2], Math.min(255, tn[3] * 255 * ea * (THEME.dark ? 1.1 : 1.25))];
  if (d[k] !== r || d[k + 1] !== g || d[k + 2] !== b || Math.abs(d[k + 3] - al) > 1) { d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = al; tintDirty = true; }
  if (onLayer && ch && ch !== ' ' && col) {
    c.globalAlpha = ty === T.VOID ? 1 : .35 + .65 * ea;
    c.fillStyle = C(col); c.fillText(ch, gx * L.CW, y0);
    c.globalAlpha = 1;
  }
}
function touch(i, spread = true) {
  dirty.add(i);
  if (!spread) return;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = world.nb(i, dx, dy); if (j >= 0) dirty.add(j); }
}
function flushDirty() {
  for (const ti of dirty) for (const gi of tileChars[ti]) drawChar(gi);
  dirty.clear();
}
function redrawAll() { for (let i = 0; i < world.n; i++) dirty.add(i); S.waterT = S.atmoT = S.overT = S.tintT = 1; paintPaper(); }
// the garden's sheet of paper: follows the island's rim, reaching a little past the last grains, soft-edged
function paintPaper() {
  if (!tiny.paper) return;
  const p = tiny.paper, d = p.img.data, [r, g, b] = hex(uiPal().paper);
  for (let gi = 0; gi < charEdge.length; gi++) {
    const k = gi * 4; d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = clamp((charEdge[gi] + .16) / .2, 0, 1) * 255;
  }
  p.ctx.putImageData(p.img, 0, 0);
}

function drawWater() {
  const l = vp.water, c = l.ctx, { gx0, gx1, gy0, gy1 } = beginVP(l), { GC, CW, CH } = L, t = S.t;
  const rain = S.lv[2];
  // batch by style: thousands of ripple glyphs, only a handful of colours
  const B = new Map(), put = (col, a, ch, x, y) => { const k = col + '|' + a; let v = B.get(k); if (!v) B.set(k, v = []); v.push(ch, x, y); };
  for (let gy = gy0; gy < gy1; gy++) for (let gx = gx0; gx < gx1; gx++) {
    const gi = gy * GC + gx, ty = shownT[gi];
    if (!WET(ty)) continue;
    const h = hsh(gx, gy, 2), pond = ty === T.POND, ea = charEA[gi] > .97 ? 1 : Math.round(charEA[gi] * 5) / 5;
    if (pond && hsh(gx >> 1, gy, 9) < .03) { put(h < .5 ? '#4f8a3a' : '#6aa04a', ea, h < .3 ? '@' : h < .6 ? 'o' : '(', gx * CW, gy * CH); continue; }   // lily pads
    const w = Math.sin(gx * .42 + gy * 1.25 + t * 1.15 + h * 1.4) + .75 * Math.sin(gx * .16 - gy * .55 - t * .62) + rain * .4 * Math.sin(t * 7 + h * 30);
    const ch = pond ? (w > .9 ? '~' : w > .25 ? '-' : w > -.4 ? (h < .6 ? '.' : ' ') : (h < .3 ? '_' : '.'))
      : (w > .9 ? '~' : w > .2 ? '-' : (h < .5 ? '.' : ' '));
    if (ch === ' ') continue;
    put(pond ? (ch === '~' ? 'rgba(30,85,185,.85)' : 'rgba(40,95,190,.6)') : (ch === '~' ? 'rgba(50,115,215,.8)' : 'rgba(60,125,215,.55)'), ea, ch, gx * CW, gy * CH);
  }
  for (const [k, v] of B) {
    const [col, a] = k.split('|');
    c.globalAlpha = +a; c.fillStyle = C(col);
    for (let i = 0; i < v.length; i += 3) c.fillText(v[i], v[i + 1], v[i + 2]);
  }
  c.globalAlpha = 1;
}

// cloud shadows live on a one-pixel-per-character canvas that gets smoothed up: soft, seamless.
// fog and sun light go on a viewport layer
function drawAtmo() {
  const { GC, GR } = L, t = S.sim, [sun, cloud, rain, fog] = S.lv;
  const sh = tiny.shade, d = sh.img.data, dark = THEME.dark;
  const amt = cloud * .85 + rain * 1.15 + fog * .25;
  const [sr, sg, sb] = dark ? [0, 0, 6] : [105, 108, 116];   // neutral grey, light touch: only water is blue
  for (let gy = 0; gy < GR; gy++) for (let gx = 0; gx < GC; gx++) {
    const gi = gy * GC + gx, k = gi * 4;
    const m = fbm(NF1, gx / 34 + t * .045, gy / 13 + t * .012, 2);
    const a = (clamp((m - .42) * 3, 0, 1) * amt * (dark ? .17 : .075) + rain * .035) * charEA[gi];
    d[k] = sr; d[k + 1] = sg; d[k + 2] = sb; d[k + 3] = a * 255;
  }
  sh.ctx.putImageData(sh.img, 0, 0);
  const l = vp.atmo, c = l.ctx, { gx0, gx1, gy0, gy1 } = beginVP(l);
  const X = l.ox - L.M, Y = l.oy - L.M, w = L.W + 2 * L.M, h = L.H + 2 * L.M;
  if (sun > .05) { c.fillStyle = dark ? `rgba(255,200,120,${.03 * sun})` : `rgba(255,214,120,${.05 * sun})`; c.fillRect(X, Y, w, h); }
  if (fog > .02) {
    c.fillStyle = dark ? `rgba(70,82,100,${.22 * fog})` : `rgba(236,240,246,${.32 * fog})`; c.fillRect(X, Y, w, h);
    for (let gy = gy0; gy < gy1; gy++) for (let gx = gx0; gx < gx1; gx++) {
      const m = NF2(gx / 14 - S.t * .3, gy / 3.6) * .6 + NF2(gx / 5 - S.t * .55 + 40, gy / 1.6) * .4;
      if (m < .58) continue;
      const a = clamp((m - .58) * 3, 0, 1) * fog * .55;
      c.fillStyle = dark ? `rgba(150,165,190,${a.toFixed(3)})` : `rgba(140,155,178,${a.toFixed(3)})`;
      c.fillText(m > .7 ? '~' : hsh(gx, gy, 4) < .5 ? '-' : '.', gx * L.CW, gy * L.CH);
    }
  }
}

/* ================================================================ the overlay: what the selected snagent believes */
const mixHex = (a, b, t) => { const A = hex(a), B = hex(b); return `rgb(${lerp(A[0], B[0], t) | 0},${lerp(A[1], B[1], t) | 0},${lerp(A[2], B[2], t) | 0})`; };
const VRAMP = '.,:;-=+*#%';
function drawOverlay() {
  const l = vp.over, c = l.ctx;
  const { gx0, gx1, gy0, gy1 } = beginVP(l);
  if (!S.view) return;
  const a = snagents[sel], n = world.n, vals = new Float32Array(n);
  let lo = 1e9, hi = -1e9;
  for (let s = 0; s < n; s++) { if (!world.pass(s)) continue; const v = vals[s] = valueOf(a, s); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const span = hi - lo || 1, rnd = a.brain === 'random';
  // half rank, half linear: the whole ramp gets used, but a cucumber still reads as a peak
  const order = [];
  for (let s = 0; s < n; s++) if (world.pass(s)) order.push(s);
  order.sort((p, q) => vals[p] - vals[q]);
  const norm = new Float32Array(n);
  order.forEach((s, k) => { norm[s] = .5 * k / Math.max(1, order.length - 1) + .5 * (vals[s] - lo) / span; });
  const tx0 = Math.floor(gx0 / TW), tx1 = Math.ceil(gx1 / TW), ty0 = Math.floor(gy0 / TH), ty1 = Math.ceil(gy1 / TH);
  const vis = s => { const tx = s % world.cols, ty = s / world.cols | 0; return tx >= tx0 && tx < tx1 && ty >= ty0 && ty < ty1; };
  const pal = uiPal(), halo = pal.halo;
  if (S.view === 1) {
    const vl = tiny.veil, d = vl.img.data, [pr, pg, pb] = hex(pal.paper);
    for (let s = 0; s < n; s++) { const k = s * 4; d[k] = pr; d[k + 1] = pg; d[k + 2] = pb; d[k + 3] = world.pass(s) ? 224 : world.inside(s) ? 70 : 0; }
    vl.ctx.putImageData(vl.img, 0, 0);
    c.save(); c.imageSmoothingEnabled = false; c.drawImage(vl.cv, 0, 0, L.gw, L.gh); c.restore();
    const lowC = THEME.dark ? (rnd ? '#3a2a30' : '#2a3442') : (rnd ? '#e8d6da' : '#cfd9e6');
    for (let s = 0; s < n; s++) {
      if (!world.pass(s) || !vis(s)) continue;
      const v = norm[s], tx = s % world.cols, ty = s / world.cols | 0, ch = VRAMP[Math.floor(clamp(v, 0, .999) * VRAMP.length)];
      c.fillStyle = mixHex(lowC, a.shell, clamp(v * 1.15 - .1, 0, 1));
      // one character per cell, with a hairline gap, so the overlay reads as a classic gridworld table
      for (let lr = 0; lr < TH; lr++) for (let lc = 0; lc < TW - 1; lc++) c.fillText(ch, (tx * TW + lc) * L.CW, (ty * TH + lr) * L.CH);
    }
  }
  if (rnd) return;
  // policy arrows, cut out with a halo
  c.font = L.BOLD; c.lineJoin = 'round'; c.lineWidth = 3.2;
  const lr = a.brainObj;
  for (let s = 0; s < n; s++) {
    if (!world.pass(s) || !vis(s)) continue;
    const tx = s % world.cols, ty = s / world.cols | 0, X = tx * TW, Y = ty * TH;
    const unseen = a.brain !== 'plan' && !lr.visits[s];
    const act = lr.greedy(s);
    const cells = unseen ? [[3, 1, '?']]
      : act === 0 ? [[3, 0, '^'], [3, 1, '|']] : act === 2 ? [[3, 1, '|'], [3, 2, 'v']]
      : act === 1 ? [[2, 1, '-'], [3, 1, '-'], [4, 1, '>']] : act === 3 ? [[2, 1, '<'], [3, 1, '-'], [4, 1, '-']] : [[3, 1, 'o']];
    for (const [lc, rr, ch] of cells) {
      const x = (X + lc) * L.CW, y = (Y + rr) * L.CH;
      if (!unseen) { c.strokeStyle = halo; c.strokeText(ch, x, y); }
      c.fillStyle = unseen ? 'rgba(125,138,155,.55)' : C(mixHex('#2b3442', a.shell, .3));
      c.fillText(ch, x, y);
    }
  }
  c.font = L.FONT;
}

/* ================================================================ snagents */
function setSay(a, text, force) {
  if (!force && a.say && a.say.t < 1.4) return;
  a.say = { text, t: 0 };
  a.sayCD = rand(10, 24);
}
function floatText(gx, gy, text, col) { floats.push({ x: gx * L.CW, y: gy * L.CH, text, col, t: 0 }); }
const tileCenter = s => [(s % world.cols) * TW + 3, (s / world.cols | 0) * TH];

// someone is on (or crawling onto) this square
const occupied = (t, self) => snagents.some(o => o !== self && (o.s === t || (o.state === 'move' && o.to === t)));
function decide(a) {
  const s = a.s, b = a.brainObj;
  // bedtime: at night, snagents with nothing to chase curl up
  if (S.night > .6 && (a.brain === 'random' || (a.hunger < .75 && nearestKnown(a) < 0)) && Math.random() < .3) {
    a.state = 'sleep'; a.sleepT = rand(10, 22); a.zT = 0;
    if (a.brain !== 'random' && Math.random() < .5) setSay(a, pick(['night night', 'yawn', 'zz']));
    return;
  }
  let act = -1;
  if (b.kind === 'learn' && Math.random() < .55) {   // learners follow their noses toward meals they have smelled
    const g = nearestKnown(a);
    if (g >= 0 && tdist(s, g) <= SMELL + 2) act = stepToward(s, g);
  }
  if (act < 0) act = b.act(s);
  let [ns, tag] = model.sample(s, act);
  if (ns !== s && occupied(ns, a)) {
    ns = s; tag = TAG.BUMP;
    if (a.brain !== 'random' && Math.random() < .35) setSay(a, pick(['oh, sorry', 'after you', 'excuse me', 'hi :)']));
  }
  a.act = act; a.tag = tag; a.from = s; a.to = ns; a.mt = 0;
  const t = world.type[s], baseDur = a.brain === 'random' ? .55 : (a.age < GROW ? .8 : 1.05) / a.pace;
  a.dur = tag === TAG.STAY ? 1.4 : tag === TAG.BUMP ? .8 : tag === TAG.STUCK ? 1.1 : tag === TAG.SLIP ? baseDur * 1.15
    : baseDur * (t === T.PEBBLE ? 1.4 : t === T.PUDDLE ? .75 : t === T.LUSH ? 1.1 : 1);
  const dx = DIRS[act][0] || (ns % world.cols) - (s % world.cols);
  if (dx) a.face = Math.sign(dx);
  if (a.brain === 'random') return (a.state = 'move');
  const p = Math.random();
  if (tag === TAG.STUCK && p < .45) setSay(a, pick(['pebbles :(', 'stuck', 'ugh, gravel', 'nnngh']));
  else if (tag === TAG.VEER && p < .6) setSay(a, pick(['oops', 'crunchy leaves!', 'not that way', 'wrong turn']));
  else if (tag === TAG.SLIP) setSay(a, pick(['wheee!', 'whoa', 'sliiide']), true);
  else if (tag === TAG.BUMP && p < .5) setSay(a, pick(['bonk', 'oof', 'wall?']));
  a.state = 'move';
}

function arrive(a) {
  const from = a.from, s = a.s = a.to, b = a.brainObj;
  if (a.brain === 'random') { b.visit(s); a.steps++; a.state = 'idle'; a.wait = rand(0, .25); return; }
  const moved = s !== from, meal = moved && ripe(s);
  const r = rewOf(a, s, moved);
  a.ret += r; a.steps++; a.hist.push(r); if (a.hist.length > 48) a.hist.shift();
  if (a.steps % 8 === 0) { const h = a.hist.slice(-24); a.curve.push(h.reduce((x, y) => x + y, 0) / h.length); if (a.curve.length > 80) a.curve.shift(); }
  const [gx, gy] = tileCenter(s);
  if (b.kind === 'learn') {
    const before = b.learn(from, a.act, r, s, meal);
    if (before && before[0] > .8 && r < .3 && Math.random() < .7) setSay(a, pick(["where'd it go?", 'it was HERE', 'hm. gone.']), true);
  }
  a.state = 'idle'; a.wait = a.act === 4 ? rand(.3, 1.2) : rand(.05, .35);
  const f = world.food[s];
  if (meal || (f && f.grow >= 1 && a.act === 4)) {
    a.state = 'eat'; a.eatT = 0; a.hunger = 0; a.knows.add(f.id);
    // a race? someone else was closing in on this one
    const rival = snagents.find(o => o !== a && o.brain !== 'random' && o.knows.has(f.id) && o.state !== 'eat' && tdist(o.s, s) <= 2.5);
    if (rival && Math.random() < .7) setSay(a, pick(['mine!', 'got it!', 'beat you']), true);
    else setSay(a, f.kind === a.fav ? pick([`${FOOD[f.kind].name}!!`, 'my favorite', 'best day']) : pick(['nom', 'nom nom', 'snack']), true);
  }
  if (world.type[s] === T.LAVENDER) {
    a.shock = 1.6; setSay(a, pick(['achoo!', 'too smelly', 'ugh, lavender', 'nope nope', 'so fragrant. no.']), true);
    for (let k = 0; k < 3; k++) parts.push({ t: 'glyph', gx: gx + rand(-2, 2), gy: gy + rand(-1, 0), ch: pick(['*', '~', "'"]), col: '#9a7cc4', life: .9, age: k * -.15 });
  }
  if (Math.abs(r) >= .5) floatText(gx - 1, gy, (r > 0 ? '+' : '') + r.toFixed(1), r > 0 ? '#3f8a3a' : '#c0404a');
}

// a meal is finished: the eater might lay an egg, and anyone who was racing for it is disappointed
function foodGone(i, f, eater) {
  for (const o of snagents) {
    if (o === eater || o.brain === 'random' || !o.knows.has(f.id) || o.state === 'sleep') continue;
    if (tdist(o.s, i) <= 4.5) setSay(o, pick(['aw', 'no fair', 'next time', 'hey!', 'i was coming']), true);
  }
  if (!eater) return;
  eater.meals++;
  const total = snagents.length + eggs.length;
  if (eater.meals >= 4 && eater.eggCD <= 0 && eater.age >= GROW && total < MAX_SNAGENTS) {
    eggs.push({ s: i, parent: eater, t: 0, hatch: rand(28, 40), wob: rand(0, 9) });
    eater.meals = 0; eater.eggCD = rand(260, 420);
    setSay(eater, pick(['an egg!', 'look what i made', 'oh! an egg']), true);
    const [gx, gy] = tileCenter(i); floatText(gx - 2, gy - 1, 'egg!', '#b8a070');
  }
}
function hatch(e) {
  const p = e.parent, b = newBrain(p.brain);
  // the snaby inherits a fuzzy copy of its parent's brain
  if (p.brain === 'plan') b.V.set(p.brainObj.V);
  else {
    for (let i = 0; i < b.Q.length; i++) b.Q[i] = p.brainObj.Q[i] + rand(-.12, .12);
    for (let s = 0; s < world.n; s++) b.visits[s] = Math.floor(p.brainObj.visits[s] * .3);
  }
  const used = new Set(snagents.map(x => x.name));
  const name = pick(NAMES.filter(n => !used.has(n))) || 'Smol';
  const [r0, g0, b0] = hex(p.shell), j = () => Math.round(rand(-18, 18));
  const shell = '#' + [r0 + j(), g0 + j(), b0 + j()].map(v => clamp(v, 30, 230).toString(16).padStart(2, '0')).join('');
  const a = makeSnagent({
    name, pr: pick(['he', 'she']), brain: p.brain, shell, spiral: p.spiral, role: `${p.name}'s snaby`, fav: Math.random() < .7 ? p.fav : pick(['cucumber', 'berry', 'mushroom']),
    blurb: `hatched from an egg. inherited a fuzzy copy of ${p.name}'s brain and tastes.`, baby: true, gen: p.gen + 1,
    Rarr: p.R.map((v, t) => t === T.LAVENDER || t === T.VOID ? v : v + rand(-.03, .03)), foodMul: +(p.foodMul * rand(.85, 1.15)).toFixed(2),
  }, e.s, b);
  if (occupied(e.s, null)) {   // hatch onto a free square next door if the nest is busy
    const free = NB4.map(([dx, dy]) => world.nb(e.s, dx, dy)).find(j => world.pass(j) && world.type[j] !== T.LAVENDER && !occupied(j, null));
    if (free !== undefined) a.s = a.from = a.to = free;
  }
  a.knows = new Set(p.knows);
  snagents.push(a);
  setSay(a, pick(['hello world', 'hi!', '!', 'where am i']), true);
  const [gx, gy] = tileCenter(e.s);
  for (let k = 0; k < 4; k++) parts.push({ t: 'glyph', gx: gx + rand(-2, 2), gy: gy + rand(0, 1), ch: pick(["'", '`', ',', '.']), col: '#cdb98f', life: .9, vy: -1.5 });
  if (Math.random() < .8) setSay(p, pick(['my snaby!', 'welcome :)', 'hi little one', 'SNABY']), true);
}

function updateSnagent(a, dt) {
  a.hunger = Math.min(1, a.hunger + dt * .012);
  a.age += dt; a.eggCD -= dt;
  if (a.age >= GROW && a.age - dt < GROW) setSay(a, pick(['all grown up', 'i am big now', 'no longer a snaby']), true);
  if (a.say) { a.say.t += dt; if (a.say.t > 2.6) a.say = null; }
  a.shock = Math.max(0, a.shock - dt);
  if ((a.blinkT -= dt) < 0) { a.blink = .15; a.blinkT = rand(2.5, 7); }
  a.blink = Math.max(0, a.blink - dt);
  if ((a.sayCD -= dt) < 0 && a.state !== 'eat' && a.state !== 'sleep') {
    const k = world.type[a.s], lines = [...(LINES[k] || []), ...(LINES[world.weather] || []), ...LINES[a.brain], ...(a.brain === 'random' ? [] : LINES.idle), ...(S.night > .5 ? LINES.night : [])];
    if (a.brain !== 'random' || Math.random() < .3) setSay(a, pick(lines)); else a.sayCD = rand(10, 20);
  }
  if (a.state === 'sleep') {
    a.sleepT -= dt;
    if ((a.zT -= dt) < 0) {
      a.zT = rand(1, 1.6);
      const p = artPos(a); parts.push({ t: 'glyph', gx: p.col + 3.5, gy: p.row - .3, ch: pick(['z', 'z', 'Z']), col: '#7d8aa8', life: 1.6, vy: -.7, drift: .8 });
    }
    if (a.sleepT < 0 || S.night < .25) { a.state = 'idle'; a.wait = rand(.2, 1); if (S.night < .25 && a.brain !== 'random' && Math.random() < .6) setSay(a, pick(['morning', 'good morning', 'yawn'])); }
    return;
  }
  if (a.state === 'move') {
    a.mt += dt / a.dur; a.phase += dt * 6;
    if (a.tag !== TAG.STAY && a.tag !== TAG.BUMP && a.tag !== TAG.STUCK && a.brain !== 'random') {
      const p = artPos(a); trail.set((p.row + 1) * L.GC + p.col + (a.face > 0 ? 0 : 4), S.sim);
    }
    if (a.mt >= 1) arrive(a);
  } else if (a.state === 'eat') {
    a.eatT += dt; a.phase += dt * 2;
    const f = world.food[a.s];
    if (!f) a.state = 'idle';
    else if (a.eatT > .7) {
      a.eatT = 0; f.bites++;
      const [gx, gy] = tileCenter(a.s);
      parts.push({ t: 'glyph', gx: gx + rand(-2, 2), gy: gy + 1 + rand(-.5, .5), ch: pick(['.', "'", ',']), col: f.kind === 'cucumber' ? '#8fc46e' : f.kind === 'berry' ? '#d4455a' : '#c8a080', life: .8, vy: -2 });
      if (f.bites >= f.max) {
        world.food[a.s] = null; a.state = 'idle'; a.wait = rand(.6, 1.4);
        if (Math.random() < .5) setSay(a, pick(['full :)', 'burp', 'mmm.']), true);
        foodGone(a.s, f, a);
      }
    }
  } else if ((a.wait -= dt) <= 0) decide(a);
}

// where the art sits, in whole characters (snapped: everything moves on the character grid)
function artPos(a) {
  const fx = a.from % world.cols, fy = a.from / world.cols | 0, tx = a.to % world.cols, ty = a.to / world.cols | 0;
  let x = tx, y = ty;
  if (a.state === 'move') {
    if (a.tag === TAG.BUMP) {
      const k = (a.mt < .5 ? a.mt : 1 - a.mt) * .5;
      x = fx + DIRS[a.act][0] * k; y = fy + DIRS[a.act][1] * k;
    } else { x = lerp(fx, tx, a.mt); y = lerp(fy, ty, a.mt); }
  }
  return { col: Math.round(x * TW + 1), row: Math.round(y * TH + 1) };
}

const FEET = ['---', '-~-', '~--', '--~'];
const flip = (lines, mask) => [lines.map(mirror), mask.map(m => [...m].reverse().join(''))];
function snagentArt(a) {
  const asleep = a.state === 'sleep';
  if (a.brain === 'random') {
    let lines = ['{:}' + (a.blink > 0 || asleep ? '.' : 'o')], mask = ['rkrk'];
    if (a.face < 0) [lines, mask] = flip(lines, mask);
    return { lines, mask, colors: { r: a.shell, k: '#36404d' }, dx: 1, dy: 1 };
  }
  const S0 = a.spiral, onWater = world.type[a.s] === T.PUDDLE;
  const colors = { s: a.shell, e: '#36404d', b: onWater ? '#5b84c4' : '#7d8a98' };
  let lines, mask, dx = 0;
  if (a.age < GROW) {   // snaby: two characters wide
    const E = a.blink > 0 || asleep ? '.' : '"';
    lines = [S0 + E, (a.state === 'move' && Math.floor(a.phase) % 2 ? '~' : '-') + ')']; mask = ['se', 'bb']; dx = 2;
  } else if (a.shock > .4 || asleep) { lines = [' (' + S0 + ') ', " '-' "]; mask = [' sss ', ' sss ']; }
  else {
    const E = a.blink > 0 ? '.' : a.state === 'eat' ? '^' : a.tag === TAG.BUMP && a.state === 'move' ? '*' : '"';
    const ph = a.state === 'move' && a.tag !== TAG.STAY ? Math.floor(a.phase) % 4 : 0;
    lines = [' (' + S0 + ')' + E, "'" + FEET[ph] + ')']; mask = [' ssse', 'bbbbb'];
  }
  if (a.face < 0) [lines, mask] = flip(lines, mask);
  return { lines, mask, colors, dx, dy: 0 };
}

// glyphs cut out of the ground with a soft halo in the paper colour, instead of white boxes
function drawArt(c, art, col, row, alpha = 1) {
  c.font = L.BOLD; c.globalAlpha = alpha; c.lineJoin = 'round'; c.lineWidth = 4.2; c.strokeStyle = uiPal().halo;
  art.lines.forEach((ln, r) => { for (let i = 0; i < ln.length; i++) if (ln[i] !== ' ') c.strokeText(ln[i], (col + i) * L.CW, (row + r) * L.CH); });
  art.lines.forEach((ln, r) => {
    for (let i = 0; i < ln.length; i++) {
      if (ln[i] === ' ') continue;
      c.fillStyle = C(art.colors[art.mask[r][i]] || '#36404d'); c.fillText(ln[i], (col + i) * L.CW, (row + r) * L.CH);
    }
  });
  c.globalAlpha = 1; c.font = L.FONT;
}
function bubble(c, text, cx, row, col, alpha) {
  c.font = L.BOLD; c.lineJoin = 'round'; c.lineWidth = 4;
  const x0 = Math.round(cx - text.length / 2) * L.CW, y = row * L.CH;
  c.globalAlpha = alpha;
  c.strokeStyle = uiPal().halo; c.strokeText(text, x0, y);
  c.fillStyle = C(col); c.fillText(text, x0, y);
  c.globalAlpha = 1; c.font = L.FONT;
}
// a gentle pool of light under the selected snagent, so you can always find them
function drawPool(c, a) {
  const p = artPos(a), x = (p.col + 2.5) * L.CW, y = (p.row + 1) * L.CH, R = 4.2 * L.CW * 3.2;
  c.save(); c.translate(x, y); c.scale(1, .62);
  const g = c.createRadialGradient(0, 0, 0, 0, 0, R);
  const [r, gg, b] = hex(a.shell);
  if (THEME.dark) { g.addColorStop(0, `rgba(${r},${gg},${b},.26)`); g.addColorStop(.5, `rgba(${r},${gg},${b},.1)`); g.addColorStop(1, `rgba(${r},${gg},${b},0)`); }
  else { g.addColorStop(0, 'rgba(255,253,242,.82)'); g.addColorStop(.45, 'rgba(255,252,240,.4)'); g.addColorStop(1, 'rgba(255,252,240,0)'); }
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fill();
  c.restore();
}

// every snagent sits in a small soft clearing: the texture under them calms down so they read at a glance
function drawClearing(c, a) {
  const p = artPos(a), small = a.brain === 'random' || a.age < GROW;
  const x = (p.col + 2.5) * L.CW, y = (p.row + (small ? 1.5 : 1)) * L.CH, R = (small ? 2.6 : 4) * L.CW;
  const [pr, pg, pb] = hex(uiPal().paper), [r, g, b] = hex(a.shell);
  c.save(); c.translate(x, y); c.scale(1, .55);
  const gr = c.createRadialGradient(0, 0, 0, 0, 0, R);
  if (THEME.dark) { gr.addColorStop(0, `rgba(${r},${g},${b},.2)`); gr.addColorStop(.35, `rgba(${pr},${pg},${pb},.72)`); }
  else { gr.addColorStop(0, `rgba(${pr},${pg},${pb},.85)`); gr.addColorStop(.45, `rgba(${pr},${pg},${pb},.7)`); }
  gr.addColorStop(1, `rgba(${pr},${pg},${pb},0)`);
  c.fillStyle = gr; c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fill();
  c.restore();
}

// the selected snagent's intent: follow its greedy policy forward and draw it as a dotted path
function drawIntent(c, a) {
  if (a.brain === 'random' || S.view === 2 || a.state === 'sleep') return;
  let s = a.state === 'move' ? a.to : a.s;
  const seen = new Set([s]), pts = [s];
  for (let k = 0; k < 14; k++) {
    const act = a.brainObj.greedy(s);
    if (act < 0 || act === 4) break;
    if (a.brain !== 'plan' && !a.brainObj.visits[s]) break;
    const ns = model.likely(s, act);
    if (ns === s || seen.has(ns)) break;
    seen.add(ns); pts.push(ns); s = ns;
  }
  if (pts.length < 2) return;
  c.font = L.BOLD;
  const cen = i => [(i % world.cols) * TW + 3, (i / world.cols | 0) * TH + 1];
  for (let k = 1; k < pts.length; k++) {
    const [x0, y0] = cen(pts[k - 1]), [x1, y1] = cen(pts[k]), steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let j = 1; j <= steps; j++) {
      if (x0 !== x1 && j % 2) continue;
      const x = Math.round(lerp(x0, x1, j / steps)), y = Math.round(lerp(y0, y1, j / steps));
      const fade = 1 - k / (pts.length + 1), pulse = .55 + .45 * Math.sin(S.t * 4 - (k * 7 + j) * .35);
      c.globalAlpha = fade * pulse;
      c.fillStyle = C(a.shell); c.fillText(j === steps && k === pts.length - 1 ? 'x' : '.', x * L.CW, y * L.CH);
    }
  }
  c.globalAlpha = 1; c.font = L.FONT;
}

/* ================================================================ foods & eggs */
const FOOD_ART = {
  mushroom: { lines: [' .-. ', '(o.o)', ' )_( '], mask: [' ccc ', 'csdsc', ' ttt '] },
  cucumber: { lines: [' .-. ', '(:.:)', " `-' "], mask: [' rrr ', 'rfsfr', ' rrr '] },
  berry: { lines: [' \\V/ ', '(.:.)', ' \\_/ '], mask: [' lll ', 'rsrsr', ' rrr '] },
};
function foodColors(f) {
  const cap = f.hue < .6 ? '#c8503c' : f.hue < .85 ? '#a8743f' : '#d9a03a';
  const cols = f.kind === 'mushroom' ? { c: cap, s: '#f3e6c8', d: cap, t: '#b8a888' }
    : f.kind === 'cucumber' ? { r: '#3f7f3a', f: '#8fc46e', s: '#b9b25e' } : { l: '#4f9a3a', r: '#d4455a', s: '#e0b23a' };
  if (f.stage) for (const k in cols) cols[k] = mixHex(cols[k], '#7a6248', .45);   // overripe: browning
  return cols;
}
function drawFood(c, i, f) {
  const art = FOOD_ART[f.kind], tx = i % world.cols, ty = i / world.cols | 0;
  const show = f.grow >= 1 ? 3 : f.grow > .6 ? 2 : 1;   // mushrooms push up out of the moss
  const bob = f.kind === 'mushroom' ? 0 : Math.round(Math.sin(S.t * 1.5 + f.hue * 9) * .3);
  const lines = art.lines.map((ln, r) => r < 3 - show ? ' '.repeat(5) : [...ln].map((ch, k) => hsh(tx * 9 + k, ty * 9 + r, 8) < f.bites / f.max ? ' ' : ch).join(''));
  drawArt(c, { lines, mask: art.mask, colors: foodColors(f) }, tx * TW + 1, ty * TH + bob);
  if (f.stage) {   // fruit flies
    c.fillStyle = C('rgba(60,60,60,.75)'); c.font = L.BOLD;
    for (let k = 0; k < 3; k++) {
      const a = S.t * (3 + k) + k * 2.1 + f.hue * 9;
      c.fillText(k % 2 ? '`' : '.', Math.round(tx * TW + 3 + Math.cos(a) * 3.2) * L.CW, Math.round(ty * TH + .6 + Math.sin(a * 1.3) * 1.1) * L.CH);
    }
    c.font = L.FONT;
  }
}
function drawEgg(c, e) {
  const [gx, gy] = tileCenter(e.s), k = e.t / e.hatch;
  const wob = k > .7 ? Math.round(Math.sin(S.t * 18 + e.wob) * (k - .7) * 3) : 0;
  drawArt(c, { lines: [k > .9 ? '0' : 'O'], mask: ['e'], colors: { e: '#b8a070' } }, gx + 1 + wob, gy + 2);
}

/* ================================================================ particles */
function updateParts(dt, sdt) {
  const [sun, , rain] = S.lv;
  const gx0 = Math.floor(S.camX / L.CW), gxN = Math.ceil(L.W / L.CW);
  const n = rain * gxN * 1.1 * dt;
  for (let k = 0; k < n + (Math.random() < n % 1 ? 1 : 0); k++)
    parts.push({ t: 'rain', gx: gx0 + Math.floor(rand(0, gxN)), y: S.camY + rand(-40, L.H * .3), vy: rand(380, 520), end: S.camY + rand(0, L.H) });
  if (sun > .4 && Math.random() < sun * 8 * dt) {
    const gi = Math.floor(Math.random() * shownT.length);
    if (WET(shownT[gi])) parts.push({ t: 'glyph', gx: gi % L.GC, gy: gi / L.GC | 0, ch: '*', col: 'rgba(235,170,40,1)', life: .6 });
  }
  // scent: ripe meals breathe out wisps that drift as far as they can be smelled
  for (let i = 0; i < world.n; i++) {
    const f = world.food[i];
    if (!f || f.grow < 1 || Math.random() > 2.2 * sdt) continue;
    const [gx, gy] = tileCenter(i), ang = rand(0, Math.PI * 2), sp = rand(.5, 1);
    parts.push({ t: 'scent', x: gx, y: gy + 1, vx: Math.cos(ang) * SMELL * TW / 3 * sp, vy: Math.sin(ang) * SMELL * TH / 3 * sp, life: 3, ch: pick(['~', "'", '.', ',', '~']), col: Object.values(foodColors(f))[1] });
  }
  for (const p of parts) {
    p.age = (p.age || 0) + dt;
    if (p.t === 'rain') {
      p.y += p.vy * dt;
      if (p.y >= p.end) {
        p.dead = true;
        const gx = p.gx, gy = Math.floor(p.end / L.CH), gi = gy * L.GC + gx;
        if (gx >= 0 && gx < L.GC && gi >= 0 && gi < shownT.length && shownT[gi] !== T.VOID) parts.push(WET(shownT[gi])
          ? { t: 'ripple', gx, gy, life: .7 } : { t: 'glyph', gx, gy, ch: pick(['.', ',', "'"]), col: 'rgba(80,140,230,1)', life: .3 });
      }
    } else if (p.t === 'scent') { p.x += p.vx * sdt; p.y += p.vy * sdt; if (p.age > p.life) p.dead = true; }
    else if (p.age > p.life) p.dead = true;
  }
  parts = parts.filter(p => !p.dead);
  for (const f of floats) f.t += dt;
  floats = floats.filter(f => f.t < 1.6);
  for (const f of flies) {
    f.k += dt * .3;
    f.x += (NF2(f.k, 3) - .5) * 60 * dt; f.y += (NF2(4, f.k) - .5) * 40 * dt;
    f.x = (f.x + L.gw) % L.gw; f.y = (f.y + L.gh) % L.gh;
  }
  for (const b of butterflies) {
    b.k += dt;
    b.vx += (NF1(b.k * .4, 7) - .5) * 160 * dt; b.vy += (NF1(9, b.k * .4) - .5) * 160 * dt - Math.sin(b.k * 9) * 40 * dt;
    b.vx = clamp(b.vx, -45, 45); b.vy = clamp(b.vy, -35, 35);
    b.x = (b.x + b.vx * dt + L.gw) % L.gw; b.y = (b.y + b.vy * dt + L.gh) % L.gh;
  }
}
function drawParts(c) {
  const [sun, cloud, , fog] = S.lv;
  for (const p of parts) {
    if (p.t === 'rain') {
      c.fillStyle = C('rgba(80,140,230,.5)');
      c.fillText(p.vy > 450 ? '|' : "'", p.gx * L.CW, p.y);
    } else if (p.t === 'ripple') {
      const k = p.age / p.life;
      c.fillStyle = C(`rgba(60,125,215,${((1 - k) * .9).toFixed(2)})`);
      if (k < .35) c.fillText('o', p.gx * L.CW, p.gy * L.CH);
      else { c.fillText('(', (p.gx - 1) * L.CW, p.gy * L.CH); c.fillText(')', (p.gx + 1) * L.CW, p.gy * L.CH); }
    } else if (p.t === 'scent') {
      const k = p.age / p.life;
      c.globalAlpha = Math.sin(k * Math.PI) * .45; c.fillStyle = C(p.col);
      c.fillText(p.ch, Math.round(p.x) * L.CW, Math.round(p.y) * L.CH);
      c.globalAlpha = 1;
    } else if (p.t === 'glyph') {
      if (p.age < 0) continue;
      const k = p.age / p.life;
      c.globalAlpha = 1 - k; c.font = L.BOLD; c.fillStyle = C(p.col);
      c.fillText(p.ch, (p.gx + (p.drift || 0) * p.age) * L.CW, (p.gy + (p.vy || -.6) * p.age) * L.CH);
      c.globalAlpha = 1; c.font = L.FONT;
    }
  }
  // fireflies: fog and night bring them out. in the dark garden they really glow
  const fl = Math.max(fog, S.night);
  if (fl > .05) {
    c.font = L.BOLD;
    if (THEME.dark) { c.shadowColor = 'rgba(200,240,90,.9)'; c.shadowBlur = 8; }
    for (const f of flies) {
      const a = fl * (.5 + .5 * Math.sin(S.t * 2.3 + f.ph)) ** 2;
      if (a < .05) continue;
      c.fillStyle = THEME.dark ? `rgba(215,245,110,${a.toFixed(3)})` : `rgba(150,190,30,${a.toFixed(3)})`;
      c.fillText(a > .5 ? '*' : '.', Math.round(f.x / L.CW) * L.CW, Math.round(f.y / L.CH) * L.CH);
    }
    c.shadowBlur = 0; c.font = L.FONT;
  }
  const bv = clamp(sun + cloud * .3 - fog, 0, 1) * (1 - S.night);
  if (bv > .1) for (const b of butterflies) {
    c.globalAlpha = bv; c.font = L.BOLD; c.fillStyle = C(b.col);
    c.fillText(Math.sin(S.t * 14 + b.k) > 0 ? '>i<' : '-i-', Math.round(b.x / L.CW) * L.CW, Math.round(b.y / L.CH) * L.CH);
    c.globalAlpha = 1; c.font = L.FONT;
  }
}

/* ================================================================ loop */
const dayPhase = () => (S.sim / DAY + .3) % 1;   // 0 midnight, .5 noon
function update(dt) {
  const sdt = S.paused ? 0 : dt * S.speed;
  S.sim += sdt;
  S.night = clamp((Math.cos(dayPhase() * Math.PI * 2) - .05) / .45, 0, 1);
  // weather levels ease toward the current state so a roll reads as the sky changing, not a cut
  for (let k = 0; k < 4; k++) S.lv[k] = lerp(S.lv[k], world.weather === k ? 1 : 0, 1 - Math.exp(-sdt * .6));
  S.tickT += sdt;
  if (S.tickT >= 1.5) {
    S.tickT -= 1.5;
    const ch = world.step(S.night);
    for (const i of ch) { touch(i); fading.add(i); }
    for (const e of world.events) {
      const [gx, gy] = tileCenter(e.i);
      if (e.t === 'compost') {
        floatText(gx - 3, gy, 'compost', '#6f8a4a');
        for (let k = 0; k < 4; k++) parts.push({ t: 'glyph', gx: gx + rand(-3, 3), gy: gy + rand(0, 2), ch: pick([',', "'", '"']), col: '#5f9a37', life: 1.2, vy: -.8 });
        snagents.forEach(o => { if (o.state === 'eat' && o.s === e.i) o.state = 'idle'; });
        foodGone(e.i, e.f, null);
      }
    }
    model.rebuild();
    smell();
  }
  S.wxT += sdt;
  if (S.wxT >= 7) { S.wxT -= 7; world.stepWeather(); }
  for (const i of fading) {
    world.fade[i] = Math.min(1, world.fade[i] + sdt / 1.4);
    touch(i);
    if (world.fade[i] >= 1) fading.delete(i);
  }
  for (let i = 0; i < world.n; i++) { const f = world.food[i]; if (f && f.grow < 1) { f.grow = Math.min(1, f.grow + sdt / 3); if (f.grow >= 1) smell(); } }
  // a few random tiles redraw each frame, so tufts sway, dew glints and lavender nods
  {
    const tw = TW * L.CW, th = TH * L.CH, x0 = Math.max(0, Math.floor(S.camX / tw)), y0 = Math.max(0, Math.floor(S.camY / th));
    const nx = Math.min(world.cols - x0, Math.ceil(L.W / tw) + 1), ny = Math.min(world.rows - y0, Math.ceil(L.H / th) + 1);
    for (let k = nx * ny * .5 * dt; k > 0; k--) if (k >= 1 || Math.random() < k) dirty.add(world.idx(x0 + Math.floor(Math.random() * nx), y0 + Math.floor(Math.random() * ny)));
  }
  S.sweepT += sdt;
  let sw = 0;
  while (S.sweepT >= 1 / SWEEPS && sw++ < 8) { S.sweepT -= 1 / SWEEPS; sweepAll(); }
  if (sw >= 8) S.sweepT = 0;
  for (const a of snagents.slice()) updateSnagent(a, sdt);
  for (const e of eggs) e.t += sdt;
  for (const e of eggs.filter(e => e.t >= e.hatch)) hatch(e);
  eggs = eggs.filter(e => e.t < e.hatch);
  for (const [gi, t0] of trail) if (S.sim - t0 > 40) trail.delete(gi);
  updateParts(dt, sdt);
  // camera: glide toward a goal (or follow the selected snagent)
  if (S.follow && !S.drag) lookAt(snagents[sel].s);
  if (S.goal && !S.drag) {
    const k = 1 - Math.exp(-dt * 5);
    S.camX += (S.goal.x - S.camX) * k; S.camY += (S.goal.y - S.camY) * k; clampCam();
    if (Math.hypot(S.goal.x - S.camX, S.goal.y - S.camY) < .5) S.goal = null;
  }
}

function render(dt) {
  scrollTerrain();
  flushDirty();
  if ((S.waterT += dt) > .14 || vpStale(vp.water)) { S.waterT = 0; drawWater(); }
  if ((S.atmoT += dt) > .1 || vpStale(vp.atmo)) { S.atmoT = 0; drawAtmo(); }
  if ((S.overT += dt) > .12 || vpStale(vp.over)) { S.overT = 0; drawOverlay(); }
  const pal = uiPal();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = pal.table; ctx.fillRect(0, 0, cv.width, cv.height);
  worldT(ctx); ctx.font = L.FONT; ctx.textBaseline = 'top';
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.drawImage(tiny.paper.cv, 0, 0, L.gw, L.gh); ctx.restore();
  // slime first, so it tints under the terrain characters
  for (const [gi, t0] of trail) {
    const a = .13 * (1 - (S.sim - t0) / 40);
    ctx.fillStyle = THEME.dark ? `rgba(110,170,240,${(a * .8).toFixed(3)})` : `rgba(110,170,240,${a.toFixed(3)})`;
    ctx.fillRect((gi % L.GC) * L.CW, (gi / L.GC | 0) * L.CH, L.CW + .3, L.CH);
  }
  if (tintDirty && (S.tintT += dt) > .1) {
    S.tintT = 0;
    // blur at character resolution, so terrain colours bleed into each other instead of showing tile edges
    tiny.tint.ctx.putImageData(tiny.tint.img, 0, 0); tintDirty = false;
    const b = tiny.tintB.ctx; b.clearRect(0, 0, L.GC, L.GR); b.filter = 'blur(1.6px)'; b.drawImage(tiny.tint.cv, 0, 0); b.filter = 'none';
  }
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.drawImage(tiny.tintB.cv, 0, 0, L.gw, L.gh); ctx.restore();
  drawGrid(ctx);
  blitVP(terrain); worldT(ctx);
  blitVP(vp.water);
  worldT(ctx);
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.drawImage(tiny.shade.cv, 0, 0, L.gw, L.gh); ctx.restore();
  for (let i = 0; i < world.n; i++) if (world.food[i]) drawFood(ctx, i, world.food[i]);
  for (const e of eggs) drawEgg(ctx, e);
  if (S.view) { blitVP(vp.over); worldT(ctx); }
  // night falls over the ground; the snagents stay legible on top of it
  if (S.night > .01) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = THEME.dark ? `rgba(0,2,10,${(.4 * S.night).toFixed(3)})` : `rgba(28,38,80,${(.3 * S.night).toFixed(3)})`;
    ctx.fillRect(0, 0, cv.width, cv.height); worldT(ctx);
  }
  drawPool(ctx, snagents[sel]);
  for (const a of snagents) drawClearing(ctx, a);
  drawIntent(ctx, snagents[sel]);
  const order = snagents.map((a, i) => [a, i, artPos(a)]).sort((p, q) => p[2].row - q[2].row);
  for (const [a, , p] of order) { const art = snagentArt(a); drawArt(ctx, art, p.col + art.dx, p.row + art.dy); }
  drawParts(ctx);
  blitVP(vp.atmo); worldT(ctx);
  for (const [a, i, p] of order) {
    const cx = p.col + 2.5;
    if (a.say) bubble(ctx, a.say.text, cx, p.row - 1, pal.ink, clamp(Math.min(a.say.t * 6, (2.6 - a.say.t) * 2), 0, 1));
    else if (i === sel) bubble(ctx, a.name, cx, p.row - 1, a.shell, .6 + .25 * Math.sin(S.t * 3));
  }
  ctx.font = L.BOLD; ctx.lineJoin = 'round'; ctx.lineWidth = 3.4; ctx.strokeStyle = pal.halo;
  for (const f of floats) {
    ctx.globalAlpha = clamp(1.6 - f.t, 0, 1);
    ctx.strokeText(f.text, f.x, f.y - f.t * 18);
    ctx.fillStyle = C(f.col); ctx.fillText(f.text, f.x, f.y - f.t * 18);
  }
  ctx.globalAlpha = 1;
  // hovered tile: four little corners
  if (S.hover >= 0 && world.inside(S.hover) && !S.drag?.moved) {
    const X = (S.hover % world.cols) * TW, Y = (S.hover / world.cols | 0) * TH;
    ctx.fillStyle = C('rgba(70,140,235,.9)');
    for (const [dx, dy, ch] of [[0, 0, '.'], [6, 0, '.'], [0, 2, "'"], [6, 2, "'"]]) ctx.fillText(ch, (X + dx) * L.CW, (Y + dy) * L.CH);
  }
  ctx.font = L.FONT;
}

// the gridworld's bones, faintly under everything: dotted seams between tiles and a + where they cross.
// only inside the garden, and a little stronger around the pointer
function drawGrid(c) {
  const tw = TW * L.CW, th = TH * L.CH, [gr, gg, gb] = uiPal().grid;
  const tx0 = Math.max(1, Math.floor(S.camX / tw)), tx1 = Math.min(world.cols - 1, Math.ceil((S.camX + L.W) / tw));
  const ty0 = Math.max(1, Math.floor(S.camY / th)), ty1 = Math.min(world.rows - 1, Math.ceil((S.camY + L.H) / th));
  const ins = (x, y) => world.inside(world.idx(x, y));
  const mx = S.mx >= 0 ? S.mx + S.camX : -1e9, my = S.my >= 0 ? S.my + S.camY : -1e9, RAD = 170;
  const base = S.view ? .26 : .15;
  c.save(); c.lineWidth = 1; c.setLineDash([2, 3]);
  c.strokeStyle = `rgba(${gr},${gg},${gb},${base})`;
  c.beginPath();
  for (let y = ty0 - 1; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) if (y >= 0 && ins(x - 1, y) && ins(x, y)) { c.moveTo(x * tw, y * th); c.lineTo(x * tw, (y + 1) * th); }
  for (let y = ty0; y <= ty1; y++) for (let x = tx0 - 1; x <= tx1; x++) if (x >= 0 && ins(x, y - 1) && ins(x, y)) { c.moveTo(x * tw, y * th); c.lineTo((x + 1) * tw, y * th); }
  c.stroke();
  c.setLineDash([]);
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
    if (!(ins(x - 1, y - 1) && ins(x, y - 1) && ins(x - 1, y) && ins(x, y))) continue;
    const X = x * tw, Y = y * th, near = clamp(1 - Math.hypot(X - mx, Y - my) / RAD, 0, 1);
    c.strokeStyle = `rgba(${gr},${gg},${gb},${(base * 1.7 + near * .45).toFixed(3)})`;
    const k = 2.5 + near * 2;
    c.beginPath(); c.moveTo(X - k, Y); c.lineTo(X + k, Y); c.moveTo(X, Y - k); c.lineTo(X, Y + k); c.stroke();
  }
  c.restore();
}

let last = 0;
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000 || 0); last = now;
  S.t += dt;
  update(dt); render(dt);
  if ((S.uiT += dt) > .25) { S.uiT = 0; ui(); }
  requestAnimationFrame(frame);
}

/* ================================================================ panels */
const pad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
// panels refresh four times a second; only touch the DOM when something changed, so hover and clicks stay steady
const setHTML = (el, h) => { if (el._h !== h) { el._h = h; el.innerHTML = h; } };
const fmt = v => (v >= 0 ? '+' : '') + (Math.abs(v) < 10 ? v.toFixed(2) : v.toFixed(1));
const pf = p => p === 0 ? ' . ' : p >= 1 ? '1.0' : p.toFixed(2).slice(1);
const bar = (v, n = 10) => '[' + '#'.repeat(Math.round(clamp(v, 0, 1) * n)) + '.'.repeat(n - Math.round(clamp(v, 0, 1) * n)) + ']';
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const shellArt = a => a.brain === 'random' ? '{:}o' : a.age < GROW ? `${a.spiral}"` : `_(${a.spiral})"`;
const brainName = a => a.brain === 'plan' ? 'planner' : a.brain === 'random' ? 'random' : 'learner';

function spark(hist) {
  return hist.map(r => r <= -1 ? '<b class="bad">!</b>' : esc('_.,:-=+*#%@'[Math.floor(clamp((r + .3) / 1.1, 0, .999) * 11)])).join('');
}
// a three-row ascii column chart of the learning curve (mean reward per step over time)
function plot(arr, w = 40) {
  const v = arr.slice(-w);
  if (v.length < 3) return null;
  const lo = Math.min(0, ...v), hi = Math.max(.05, ...v), rows = ['', '', ''];
  for (const x of v) {
    const h = (x - lo) / (hi - lo || 1) * 9;
    for (let k = 0; k < 3; k++) rows[k] += ' .:|'[clamp(Math.round(h - 3 * (2 - k)), 0, 3)];
  }
  return { rows, lo, hi };
}
function mood(a) {
  if (a.state === 'sleep') return 'asleep';
  if (a.state === 'eat') return 'eating';
  if (a.shock > 0) return 'sneezing';
  const g = nearestKnown(a);
  if (g >= 0) return `smells ${FOOD[world.food[g].kind].name}`;
  if (a.age < GROW) return 'a snaby';
  if (a.hunger > .75) return 'hungry';
  return pick(['pottering', 'wandering', 'content']);
}
const clock = () => { const m = Math.floor(dayPhase() * 24 * 60); return `${String(m / 60 | 0).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

function ui() {
  const w = world.weather, day = Math.floor(S.sim / DAY + .3) + 1;
  $('#sub').textContent = `a markov garden · day ${day} ${clock()}${S.night > .5 ? ' (night)' : ''} · ${S.paused ? 'paused' : 'x' + S.speed}`;
  let h = `<div class="hist">${world.history.map((k, i) => `<span class="w${k}" style="opacity:${(.3 + .7 * (i + 1) / world.history.length).toFixed(2)}">${WEATHER[k].glyph}</span>`).join('')}</div>`;
  h += '<table><tr><th></th>' + WEATHER.map(x => `<th>${x.name}</th>`).join('') + '</tr>';
  WP.forEach((row, f) => {
    h += `<tr class="${f === w ? 'now' : ''}"><td>${f === w ? '&gt; ' : '  '}${WEATHER[f].name}</td>`
      + row.map(p => `<td style="background:rgba(var(--blue),${(p * (f === w ? .55 : .22)).toFixed(3)})">${pf(p)}</td>`).join('') + '</tr>';
  });
  h += '</table>';
  const lr = world.lastRoll;
  h += `<div class="roll">${lr ? `rolled ${WEATHER[lr.from].name} &rarr; ${WEATHER[lr.to].name} (p ${pf(lr.p)})` : 'first roll soon'} <span>${bar(S.wxT / 7, 7)}</span></div>`;
  setHTML($('#wx'), h);

  setHTML($('#cast'), `<div class="hd">${snagents.length} snagents <i>(snail agents. dot is an honorary snladybug)</i></div>` + snagents.map((a, i) =>
    `<button data-i="${i}" class="${i === sel ? 'on' : ''}"><b style="color:${a.shell}">${esc(pad(shellArt(a), 5))}</b> ${pad(a.name, 8)}<i>${a.state === 'sleep' ? 'zz' : brainName(a)}</i> <span>${a.brain === 'random' ? a.steps + ' st' : fmt(a.ret)}</span></button>`).join('')
    + (eggs.length ? `<div class="eggs">${eggs.map(e => `O <i>${e.parent.name}'s egg ${bar(e.t / e.hatch, 6)} snaby soon</i>`).join('<br>')}</div>` : ''));

  const a = snagents[sel], b = a.brainObj;
  let c = `<div class="nm"><b style="color:${a.shell}">${esc(shellArt(a))}</b> ${a.name} <i>${a.role}</i> <span class="tg">${S.cardOpen ? '[-]' : '[+]'}</span></div>`;
  c += `<div class="ln">${brainName(a)} · ${mood(a)}${a.brain === 'random' ? '' : ` · return ${fmt(a.ret)}`}</div>`;
  if (S.cardOpen) {
    c += `<div class="blurb">${a.blurb}${a.gen > 1 ? ` generation ${a.gen}.` : ''}</div>`;
    c += `<div class="brain"><u>brain</u> ${BRAIN_TXT[a.brain](PRONOUN[a.pr || 'she'])}</div>`;
    if (a.brain === 'random') {
      const seen = b.visits.reduce((n, v) => n + (v > 0), 0);
      c += `<div>${a.steps} steps · stepped on ${Math.round(100 * seen / world.n)}% of tiles</div>`;
    } else {
      if (b.kind === 'learn') {
        const seen = b.visits.reduce((n, v) => n + (v > 0), 0);
        c += `<div>ε here ${b.eps(a.s).toFixed(2)} · seen ${Math.round(100 * seen / world.n)}% · ${b.replay ? b.mem.size + ' memories' : 'no memory'}</div>`;
      } else c += `<div>γ ${GAMMA} · V here ${fmt(b.value(a.s))}</div>`;
      c += `<div>hunger <span class="mono">${bar(a.hunger)}</span> · ${a.steps} steps · ${a.meals} meals</div>`;
      c += `<div class="spk">r <span class="mono">${spark(a.hist) || '...'}</span></div>`;
      const pl = plot(a.curve);
      c += pl ? `<div class="plot"><div class="dim">learning curve · mean r / step</div><pre>${pl.rows.map((r, k) => esc(r) + ' ' + (k === 0 ? fmt(pl.hi) : k === 2 ? fmt(pl.lo) : '')).join('\n')}</pre></div>`
        : '<div class="dim">learning curve: give it a minute</div>';
      const show = [T.SOIL, T.DAMP, T.MOSS, T.LUSH, T.PUDDLE, T.PEBBLE, T.LOG, T.LAVENDER];
      c += `<div class="rw">${show.map(t => `<span><em>${esc(TILE[t].icon)}</em>${TILE[t].key} ${fmt(a.R[t]).replace('+0.00', '0')}</span>`).join('')}<span><em>(o)</em>food x${a.foodMul} · ${FOOD[a.fav].name} x1.5</span></div>`;
    }
  }
  setHTML($('#card'), c);

  setHTML($('#tools'), TOOLS.map(t => `<button data-tool="${t.id}" class="${S.tool === t.id ? 'on' : ''}"><pre>${esc(t.icon)}</pre><span>${t.key} ${t.label}</span></button>`).join('')
    + '<div class="sep"></div>'
    + `<button data-k="menu" class="mb ${S.menu ? 'on' : ''}"><pre>${S.menu ? '[x]' : '[=]'}</pre><span>menu</span></button>`);
  const menu = $('#menu');
  menu.classList.toggle('show', S.menu);
  if (S.menu) {
    setHTML(menu, `<button data-k="v" class="${S.view ? 'on' : ''}"><b>v</b> beliefs: ${['off', 'values', 'policy'][S.view]}</button>`
      + `<button data-k="f" class="${S.follow ? 'on' : ''}"><b>f</b> follow ${snagents[sel].name}</button>`
      + `<button data-k="w"><b>w</b> roll the weather</button>`
      + `<button data-k=" " class="${S.paused ? 'on' : ''}"><b>space</b> ${S.paused ? 'paused' : 'pause'}</button>`
      + `<button data-k="+"><b>- +</b> speed x${S.speed}</button>`
      + `<button data-k="d"><b>d</b> ${THEME.dark ? 'light' : 'dark'} mode</button>`
      + `<button data-k="n"><b>n</b> a new garden</button>`
      + '<div class="hint">drag to wander · click a snagent · tab cycles</div>');
    const r = $('#tools button[data-k="menu"]').getBoundingClientRect(), w = menu.offsetWidth;
    menu.style.left = clamp(r.right - w, 8, innerWidth - w - 8) + 'px';
    menu.style.bottom = (innerHeight - $('#tools').getBoundingClientRect().top + 6) + 'px';
  }
  tip();
}

function tip() {
  const el = $('#tip');
  if (S.hover < 0 || S.drag?.moved) { el.classList.remove('show'); return; }
  const i = S.hover, t = world.type[i], a = snagents[sel];
  if (t === T.VOID) { el.classList.remove('show'); return; }
  const who = snagents.find(x => x.s === i && x.state !== 'move');
  let h = '';
  if (who) h += `<b style="color:${who.shell}">${who.name}</b> <i>${who.role} · ${mood(who)}</i><br>`;
  const f = world.food[i];
  h += `<b>${TILE[t].name}</b>${f ? ` · ${STAGE[f.stage]} ${FOOD[f.kind].name}` : ''} <span class="dim">(${i % world.cols},${i / world.cols | 0})</span>`;
  const tr = world.transitions(i);
  if (tr.length > 1) h += `<br><span class="dim">next tick under ${WEATHER[world.weather].name}:</span><br>` + tr.filter(([, p]) => p > .001)
    .map(([k, p]) => `<span class="mono">${esc(pad(k === t ? 'stays' : '→ ' + TILE[k].key, 9))} ${bar(p, 8)} ${Math.round(p * 100)}%</span>`).join('<br>');
  else if (TILE[t].fixed) h += '<br><span class="dim">fixed: does not change</span>';
  const ft = world.foodTransitions(i);
  if (ft.length) h += `<br><span class="dim">the ${FOOD[f.kind].name}, next tick:</span><br>` + ft.map(([k, p]) => `<span class="mono">${esc(pad(k, 15))} ${bar(p, 6)} ${(p * 100).toFixed(1)}%</span>`).join('<br>');
  if (MOVE_NOTE[t]) h += `<br><span class="dim">crawling off: ${MOVE_NOTE[t]}</span>`;
  if (world.pass(i)) {
    if (a.brain === 'random') h += `<br><span style="color:${a.shell}">${a.name}</span> visits here ${(100 * a.brainObj.value(i)).toFixed(1)}% of the time`;
    else {
      const act = a.brainObj.greedy(i), seen = a.brain === 'plan' || a.brainObj.visits[i];
      h += `<br><span style="color:${a.shell}">${a.name}</span>: r ${fmt(rewOf(a, i, true, true))} · ${seen ? `V ${fmt(a.brainObj.value(i))} · π ${'^>v<o'[act]}` : 'never been here'}`;
      if (f && f.grow >= 1 && !a.knows.has(f.id)) h += ' · <i>has not smelled this yet</i>';
    }
  }
  setHTML(el, h);
  el.classList.add('show');
  const r = el.getBoundingClientRect();
  let x = S.mx + 16, y = S.my + 16;
  if (x + r.width > innerWidth - 8) x = S.mx - r.width - 12;
  if (y + r.height > innerHeight - 8) y = S.my - r.height - 12;
  el.style.transform = `translate(${Math.max(8, x)}px,${Math.max(8, y)}px)`;
}

/* ================================================================ input */
function tileAt(px, py) {
  const gx = (px + S.camX) / L.CW, gy = (py + S.camY) / L.CH;
  const tx = Math.floor(gx / TW), ty = Math.floor(gy / TH);
  return tx < 0 || ty < 0 || tx >= world.cols || ty >= world.rows ? -1 : world.idx(tx, ty);
}
function snagentAt(px, py) {
  const gx = (px + S.camX) / L.CW, gy = (py + S.camY) / L.CH;
  for (let k = snagents.length - 1; k >= 0; k--) {
    const p = artPos(snagents[k]);
    if (gx >= p.col - 1 && gx <= p.col + 6 && gy >= p.row - 1 && gy <= p.row + 2) return k;
  }
  return -1;
}
function useTool(i) {
  const t = world.type[i], [X, Y] = tileCenter(i);
  const say = txt => floatText(X - txt.length / 2, Y, txt, '#7d8a9b');
  if (t === T.VOID) return;
  if (S.tool === 'cucumber' || S.tool === 'berry') {
    if (!world.pass(i) || t === T.LAVENDER) return say('no');
    world.food[i] = makeFood(S.tool, Math.random, 1);
    parts.push({ t: 'glyph', gx: X, gy: Y - .5, ch: 'v', col: '#7d8a9b', life: .5, vy: 1 });
    smell();
    return;
  }
  let to = -1;
  if (S.tool === 'lavender') to = t === T.LAVENDER ? (i === world.bush ? -1 : T.DAMP) : TILE[t].fixed || !world.pass(i) ? -1 : T.LAVENDER;
  if (S.tool === 'water') to = TILE[t].fixed ? -1 : T.PUDDLE;
  if (S.tool === 'moss') to = TILE[t].fixed ? -1 : t === T.MOSS ? T.LUSH : t === T.LUSH ? -1 : T.MOSS;
  if (to < 0) return say('nope');
  if (world.setType(i, to)) { touch(i); fading.add(i); model.rebuild(); }
  if (to === T.LAVENDER) world.food[i] = null;
}
function select(k, center) {
  if (k === sel) setSay(snagents[k], snagents[k].brain === 'random' ? pick(['!', '?', ':)']) : pick(['<3', 'hi', 'oh!', 'hehe']), true);
  else S.cardOpen = true;
  sel = k; S.overT = 1;
  if (center) lookAt(snagents[k].s);
}
const pan = (dx, dy) => { S.goal = { x: (S.goal?.x ?? S.camX) + dx, y: (S.goal?.y ?? S.camY) + dy }; S.follow = false; };
const KEYS = {
  'v': () => { S.view = (S.view + 1) % 3; S.overT = 1; },
  'w': () => { world.stepWeather(); S.wxT = 0; },
  ' ': () => { S.paused = !S.paused; },
  '+': () => { S.speed = SPEEDS[(SPEEDS.indexOf(S.speed) + 1) % SPEEDS.length]; },
  '=': () => KEYS['+'](),
  '-': () => { S.speed = SPEEDS[Math.max(0, SPEEDS.indexOf(S.speed) - 1)]; },
  'n': () => { seed = (Math.random() * 2 ** 31) | 0; init(); },
  'd': () => setTheme(!THEME.dark),
  'f': () => { S.follow = !S.follow; if (S.follow) lookAt(snagents[sel].s); },
  'menu': () => { S.menu = !S.menu; },
  'Escape': () => { S.menu = false; },
  'Tab': () => select((sel + 1) % snagents.length, true),
  'ArrowLeft': () => pan(-180, 0), 'ArrowRight': () => pan(180, 0), 'ArrowUp': () => pan(0, -140), 'ArrowDown': () => pan(0, 140),
};
function setTheme(dark) {
  THEME.dark = dark;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  if (world) redrawAll();
}
addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tool = TOOLS.find(t => t.key === e.key);
  if (tool) S.tool = tool.id;
  else if (KEYS[e.key]) { e.preventDefault(); KEYS[e.key](); }
  else return;
  S.uiT = 1;
});
// click to act, drag to wander the garden
cv.addEventListener('pointerdown', e => {
  S.mx = e.clientX; S.my = e.clientY;
  S.drag = { x: e.clientX, y: e.clientY, cx: S.camX, cy: S.camY, moved: false };
  cv.setPointerCapture(e.pointerId);
});
cv.addEventListener('pointermove', e => {
  S.mx = e.clientX; S.my = e.clientY;
  const d = S.drag;
  if (d) {
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) { d.moved = true; S.goal = null; S.follow = false; cv.classList.add('grabbing'); }
    if (d.moved) { S.camX = d.cx - (e.clientX - d.x); S.camY = d.cy - (e.clientY - d.y); clampCam(); }
  }
  S.hover = tileAt(e.clientX, e.clientY);
  cv.classList.toggle('over', !d?.moved && snagentAt(e.clientX, e.clientY) >= 0);
});
cv.addEventListener('pointerup', e => {
  const d = S.drag; S.drag = null; cv.classList.remove('grabbing');
  if (!d || d.moved) return;
  const k = snagentAt(e.clientX, e.clientY);
  if (k >= 0) select(k);
  else { const i = tileAt(e.clientX, e.clientY); if (i >= 0) useTool(i); }
  S.hover = tileAt(e.clientX, e.clientY); S.uiT = 1;
});
cv.addEventListener('pointercancel', () => { S.drag = null; cv.classList.remove('grabbing'); });
cv.addEventListener('pointerleave', () => { if (!S.drag) S.hover = -1; });
cv.addEventListener('wheel', e => { e.preventDefault(); S.goal = null; S.follow = false; S.camX += e.deltaX; S.camY += e.deltaY; clampCam(); }, { passive: false });
$('#cast').addEventListener('pointerdown', e => { const b = e.target.closest('button'); if (b) { select(+b.dataset.i, true); S.uiT = 1; } });
$('#card').addEventListener('pointerdown', () => { S.cardOpen = !S.cardOpen; S.uiT = 1; });
$('#menu').addEventListener('pointerdown', e => {
  const b = e.target.closest('button'); if (b) { KEYS[b.dataset.k](); S.uiT = 1; }
});
$('#tools').addEventListener('pointerdown', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.tool) S.tool = b.dataset.tool; else KEYS[b.dataset.k]();
  S.uiT = 1;
});
let resizeT = 0;
addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    const fs = L.FS; layout();
    if (L.FS !== fs) { init(); return; }
    vp = { water: mkVP(), atmo: mkVP(), over: mkVP() };
    clampCam(); makeTerrain(); S.waterT = S.atmoT = S.overT = 1;
  }, 250);
});

setTheme(matchMedia('(prefers-color-scheme: dark)').matches);
document.fonts.load(`12px 'JetBrains Mono'`).finally(() => {
  init();
  if (S.test) window.SR = { S, get world() { return world; }, get snagents() { return snagents; }, get eggs() { return eggs; }, step: dt => { update(dt); }, render: () => { render(1); ui(); }, frame: dt => render(dt), KEYS, lookAt };
  else requestAnimationFrame(frame);
});
