// small shared helpers: randomness, noise, palettes, ascii mirroring
export const TAU = Math.PI * 2;
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = a => a[Math.floor(Math.random() * a.length)];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// value noise in [0,1]
export function makeNoise(rng) {
  const p = new Uint8Array(512), vals = new Float32Array(256);
  const perm = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  for (let i = 0; i < 256; i++) vals[i] = rng();
  const h = (i, j) => vals[p[(p[i & 255] + j) & 255]];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(h(xi, yi), h(xi + 1, yi), u), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
  };
}
export const fbm = (n, x, y, o = 4) => {
  let s = 0, a = .5, f = 1, t = 0;
  for (let i = 0; i < o; i++) { s += a * n(x * f, y * f); t += a; f *= 2.03; a *= .5; }
  return s / t;
};

export const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
// the garden is authored for the dark: THEME.dark is the default, light is the old paper look
export const THEME = { dark: true };
// colours the dark palettes produce are already right for the dark ground; C() passes them through untouched
export const AUTHORED = new Set();
// a literal colour authored for the dark ground: registered so C() leaves it alone
export const ink = c => (AUTHORED.add(c), c);
// palette(stops, darkStops)(t, fade) -> 'rgb()'. t keeps its paper meaning in both modes: 0 is strong ink,
// 1 is faint. on paper fade mixes toward white (distance); in the dark it sinks toward the ground.
export function palette(stops, dark) {
  const mk = st => st.map(([t, c]) => [t, hex(c)]);
  const s = mk(stops), d = dark ? mk(dark) : null, memo = new Map();
  const at = (S, t, fade, to) => {
    t = clamp(t, 0, 1);
    let i = 0; while (i < S.length - 2 && t > S[i + 1][0]) i++;
    const [t0, a] = S[i], [t1, b] = S[i + 1], k = (t - t0) / (t1 - t0 || 1);
    const c = [0, 1, 2].map(j => lerp(lerp(a[j], b[j], k), to[j], fade) | 0);
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };
  return (t, fade = 0) => {
    if (!THEME.dark || !d) return at(s, t, fade, [255, 255, 255]);
    const key = Math.round(clamp(t, 0, 1) * 64) * 100 + Math.round(fade * 50);
    let v = memo.get(key);
    if (!v) { v = at(d, Math.round(clamp(t, 0, 1) * 64) / 64, Math.round(fade * 50) / 50, [8, 9, 11]); memo.set(key, v); AUTHORED.add(v); }
    return v;
  };
}
// dark stops run bright -> dim as t goes 0 -> 1: on black, strong ink is a bright glyph.
// an autumn-forest palette: olive and pine mosses, ochre and rust litter, stone greys, nothing neon.
export const PAL = {
  MOSS: palette([[0, '#1f3d26'], [.28, '#36692f'], [.55, '#5f9a37'], [.8, '#98c446'], [1, '#d3e683']],
    [[0, '#e2da80'], [.25, '#b4bc5a'], [.5, '#82a244'], [.75, '#56763a'], [1, '#32472a']]),
  SOIL: palette([[0, '#4b3a2c'], [.5, '#7d6248'], [1, '#b59c7d']],
    [[0, '#cfac7c'], [.45, '#9a7c58'], [.75, '#6c5944'], [1, '#463b30']]),
  BARK: palette([[0, '#3d2b1e'], [.35, '#5f4330'], [.7, '#8f6b4a'], [1, '#c9a77c']],
    [[0, '#d0a06a'], [.35, '#a6784a'], [.7, '#6e5038'], [1, '#3a2e24']]),
  ROCK: palette([[0, '#4f5862'], [.4, '#7d8792'], [.75, '#adb6bf'], [1, '#dbe1e6']],
    [[0, '#c9ccc8'], [.4, '#93968f'], [.75, '#5c605c'], [1, '#33363a']]),
  LEAF: palette([[0, '#5a3220'], [.35, '#8a4a25'], [.65, '#b46a35'], [1, '#d59a5c']],
    [[0, '#e8b050'], [.35, '#c47a36'], [.65, '#8e4c2c'], [1, '#4a2a1e']]),
  WATER: palette([[0, '#1d4f8f'], [.4, '#3a78c9'], [.75, '#7fb0ec'], [1, '#cfe3fb']],
    [[0, '#8cbcf0'], [.4, '#5288cc'], [.75, '#2e5690'], [1, '#18294a']]),
  SAND: palette([[0, '#8c7650'], [.45, '#c2a878'], [.8, '#e3d2a8'], [1, '#f4ead2']],
    [[0, '#e6d29c'], [.45, '#b49a68'], [.8, '#76664a'], [1, '#433b2e']]),
  GRASS: palette([[0, '#2d5a23'], [.4, '#4f8a33'], [.75, '#86b84a'], [1, '#c7df82']],
    [[0, '#d8d27a'], [.4, '#9aaa50'], [.75, '#56763a'], [1, '#2a3d24']]),
};

// ascii mirroring for left-facing art
export const MIR = { '(': ')', ')': '(', '/': '\\', '\\': '/', '<': '>', '>': '<', '{': '}', '}': '{', '[': ']', ']': '[', '6': '9', '9': '6', '`': "'", 'd': 'b', 'b': 'd', 'p': 'q', 'q': 'p' };
export const mirror = t => { let o = ''; for (let i = t.length - 1; i >= 0; i--) o += MIR[t[i]] || t[i]; return o; };
export function mirrorArt(a) {
  const w = a.lines[0].length;
  return {
    ...a,
    lines: a.lines.map(mirror),
    mask: a.mask.map(m => [...m].reverse().join('')),
    head: a.head ? [w - 1 - a.head[0], a.head[1]] : undefined,
  };
}
// ascii-art shading helper: tone 0 (light) .. 1 (dark) -> char from a ramp
export const ramp = (chars, tone) => chars[Math.floor(clamp(tone, 0, .999) * chars.length)];
