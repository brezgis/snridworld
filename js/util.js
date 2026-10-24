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
// palette(stops)(t, fade) -> 'rgb()', fade mixes toward white (atmospheric distance)
export function palette(stops) {
  const s = stops.map(([t, c]) => [t, hex(c)]);
  return (t, fade = 0) => {
    t = clamp(t, 0, 1);
    let i = 0; while (i < s.length - 2 && t > s[i + 1][0]) i++;
    const [t0, a] = s[i], [t1, b] = s[i + 1], k = (t - t0) / (t1 - t0 || 1);
    const c = [0, 1, 2].map(j => lerp(lerp(a[j], b[j], k), 255, fade) | 0);
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };
}
export const PAL = {
  MOSS: palette([[0, '#1f3d26'], [.28, '#36692f'], [.55, '#5f9a37'], [.8, '#98c446'], [1, '#d3e683']]),
  SOIL: palette([[0, '#4b3a2c'], [.5, '#7d6248'], [1, '#b59c7d']]),
  BARK: palette([[0, '#3d2b1e'], [.35, '#5f4330'], [.7, '#8f6b4a'], [1, '#c9a77c']]),
  ROCK: palette([[0, '#4f5862'], [.4, '#7d8792'], [.75, '#adb6bf'], [1, '#dbe1e6']]),
  LEAF: palette([[0, '#5a3220'], [.35, '#8a4a25'], [.65, '#b46a35'], [1, '#d59a5c']]),
  WATER: palette([[0, '#1d4f8f'], [.4, '#3a78c9'], [.75, '#7fb0ec'], [1, '#cfe3fb']]),
  SAND: palette([[0, '#8c7650'], [.45, '#c2a878'], [.8, '#e3d2a8'], [1, '#f4ead2']]),
  GRASS: palette([[0, '#2d5a23'], [.4, '#4f8a33'], [.75, '#86b84a'], [1, '#c7df82']]),
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
