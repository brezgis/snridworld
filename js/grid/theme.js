// light and night. every colour is authored for paper; C() re-lights it for the dark garden:
// strong (dark) ink becomes strong (light) ink, hue kept, greens and blues glowing a little.
import { clamp, THEME, AUTHORED } from '../util.js';
export { THEME };
export const PAL_UI = {
  // paper is the garden's ground; table is what the garden sits on, so the island has a frame
  light: { paper: '#f4efe3', table: '#dcd7ca', halo: 'rgba(244,239,227,.95)', ink: '#2b3442', grid: [70, 110, 160] },
  dark: { paper: '#26211c', table: '#211d19', halo: 'rgba(38,33,28,.92)', ink: '#ece4d4', grid: [170, 150, 118] },
};
export const ui = () => THEME.dark ? PAL_UI.dark : PAL_UI.light;

function parse(c) {
  if (c[0] === '#') {
    const h = c.length === 4 ? [...c.slice(1)].map(x => x + x).join('') : c.slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const m = c.match(/[\d.]+/g).map(Number);
  return [m[0], m[1], m[2], m.length > 3 ? m[3] : 1];
}
function toHsl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function fromHsl(h, s, l) {
  if (!s) return [l, l, l].map(v => Math.round(v * 255));
  const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < .5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255));
}
// light mode: the shared palettes were tuned for white, so on paper they get a little more saturation and depth
function day(c) {
  const [r, g, b, a] = parse(c);
  let [h, s, l] = toHsl(r / 255, g / 255, b / 255);
  if (s < .06) return c;   // greys stay grey
  const [R, G, B] = fromHsl(h, Math.min(1, s * 1.32 + .04), l > .35 ? l * .9 : l);
  return `rgba(${R},${G},${B},${a})`;
}
// literal colours (shells, flowers, accents) authored for paper: strong ink becomes a bright glyph,
// hue kept, a touch muted so nothing goes neon on black
function night(c) {
  const [r, g, b, a] = parse(c);
  let [h, s, l] = toHsl(r / 255, g / 255, b / 255);
  s = Math.min(1, s * .95);
  const [R, G, B] = fromHsl(h, s, clamp(.2 + (1 - l) * .66, 0, .9));
  return `rgba(${R},${G},${B},${a})`;
}
const memo = [new Map(), new Map()];
export const C = c => {
  if (!c) return c;
  if (THEME.dark && AUTHORED.has(c)) return c;
  const m = memo[THEME.dark ? 1 : 0];
  let v = m.get(c);
  if (v === undefined) { v = THEME.dark ? night(c) : day(c); m.set(c, v); }
  return v;
};
// the snagents' own colours in the dark: lifted and a touch richer, so a shell always pops out of the moss
const brightMemo = new Map();
export function bright(c) {
  if (!THEME.dark) return c;
  let v = brightMemo.get(c);
  if (!v) {
    const [r, g, b, a] = parse(c);
    const [h, s, l] = toHsl(r / 255, g / 255, b / 255);
    const [R, G, B] = fromHsl(h, Math.min(1, s * 1.1 + .05), clamp(Math.max(l, .66), 0, .86));
    v = `rgba(${R},${G},${B},${a})`; brightMemo.set(c, v); AUTHORED.add(v);
  }
  return v;
}
