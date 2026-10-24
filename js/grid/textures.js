// how each tile type looks, one character at a time. noise runs in global char coords so
// neighbouring tiles of the same kind knit together instead of reading as stamped squares.
import { makeNoise, fbm, mulberry32, clamp, PAL } from '../util.js';
import { T } from './world.js';

const { MOSS, SOIL, BARK, ROCK, LEAF, SAND } = PAL;
const MOSS_RAMP = '.,:;*%&#@', LEAF_RAMP = '.:-=+*%#', ROCK_RAMP = '.:-=+*#%@';
const R = (a, h) => a[Math.floor(h * a.length) % a.length];

export const hsh = (x, y, k = 0) => {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(k | 0, 1442695041) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
};
// a slow per-character flicker for things that sway or glint when their tile is redrawn
const flick = (now, h, rate, mod = 2) => ((now * rate + h * 17) | 0) % mod === 0;

// the big lavender bush at the heart of the patch
const BUSH = ['.*:*:*.', ':\\|||/:', ' _|||_ '];
const LAV = ['#9a7cc4', '#7d62b0', '#b49ad8', '#8a6cc0'];

export function makeTextures(seed) {
  const rng = mulberry32(seed ^ 0xa5a5);
  const N1 = makeNoise(rng), N2 = makeNoise(rng), N3 = makeNoise(rng);

  // -> [char, color, bg]
  return function tex(type, gx, gy, o) {
    const h = hsh(gx, gy), h2 = hsh(gx, gy, 1);
    let g;
    switch (type) {
      case T.SOIL: {
        const n = fbm(N1, gx / 11, gy / 4.5, 2);
        if (Math.abs(N2(gx / 7, gy / 2.6) - .5) < .016) g = [R(['_', '/', '\\', '-', ','], h), SOIL(.45 + n * .2)];   // drying cracks
        else if (h < .012) g = ['o', ROCK(.62)];
        else if (h > .4 + .12 * n) g = [' ', null];                                                  // quiet ground: mostly paper
        else g = [R(['.', '.', ',', "'", '`', '.', '.', '-'], h2), SOIL(clamp(.6 + .3 * n + (h - .5) * .2, 0, .95))];
        break;
      }
      case T.DAMP: {
        const n = fbm(N1, gx / 9, gy / 4, 2);
        if (h < .035) g = [flick(o.now, h, .8, 6) ? '*' : "'", 'rgba(70,140,230,.85)'];          // dew
        else if (h > .66) g = [' ', null];
        else g = [R([':', ';', ',', '.', ':', '.', ';'], h2), SOIL(clamp(.3 + .35 * n + (h - .5) * .2, 0, 1))];
        break;
      }
      case T.MOSS: case T.LUSH: {
        const lush = type === T.LUSH, L = fbm(N3, gx / 6, gy / 2.6, 3);
        if (lush && h2 < .035) { g = [R(['!', 'i', '|', '!'], h), h < .5 ? '#a0703a' : '#8a5a34']; break; }   // sporophytes
        if (h2 < (lush ? .16 : .1)) { g = [flick(o.now, h, .6) ? "'" : (lush ? '"' : ','), MOSS(lush ? .8 : .88)]; break; }   // tufts
        const tone = lush ? clamp(.32 + .6 * (1 - L) + (h - .5) * .16, 0, .999) : clamp(.05 + .6 * (1 - L) + (h - .5) * .16, 0, .999);
        g = [MOSS_RAMP[Math.floor(tone * MOSS_RAMP.length)], MOSS(clamp((lush ? .1 : .35) + .42 * L + (h2 - .5) * .2, 0, 1), lush ? 0 : .04)];
        break;
      }
      case T.PUDDLE: case T.POND:
        return [' ', null, null];   // the water layer animates these
      case T.PEBBLE: {
        if (h < .006) { g = ['@', '#b77a2e']; break; }                                         // somebody's old shell
        if (hsh(gx, gy, 3) > .72) { g = [' ', null]; break; }
        const c = R(['o', 'o', 'O', '0', '.', 'o', 'c', ',', 'O', '.', 'o', ':'], h2);
        g = [c, h < .28 ? SAND(.35 + .4 * h2) : ROCK(.25 + .55 * h2)];
        break;
      }
      case T.LEAF: {
        const v = N2(gx / 3, gy / 1.4), shade = clamp(.25 + .6 * v + (h - .5) * .3, 0, .999);
        if (hsh(gx, gy, 3) > .8) { g = [' ', null]; break; }
        const c = h2 < .07 ? R(['/', '\\', '~'], h) : LEAF_RAMP[Math.floor(shade * .8 * LEAF_RAMP.length)];
        g = [c, h < .22 ? '#c9a23f' : h < .3 ? '#9a4a2a' : LEAF(clamp(.3 + .6 * (1 - v) + (h2 - .5) * .2, 0, 1))];
        break;
      }
      case T.LOG: {
        const { lc, lr } = o;
        if (o.endR && lc === 6) { g = [lr === 1 ? '@' : ')', lr === 1 ? '#8f6b4a' : '#b38a5e']; break; }
        if (o.endL && lc === 0) { g = ['(', '#b38a5e']; break; }
        if (lr === 0) g = h < .62 ? [R(["'", ',', '^', '"', '.', ';'], h2), MOSS(.45 + .35 * h)] : ['_', BARK(.55)];
        else if (lr === 1) {
          const gr = N1(gx / 4, gy * 2.7);
          g = h < .04 ? ['@', BARK(.2)] : [gr < .35 ? '=' : gr < .55 ? '-' : gr < .75 ? '~' : '=', BARK(.3 + .35 * gr)];
        } else g = [R(['_', '=', '#', '_', '_'], h), BARK(.12 + .12 * h2)];
        break;
      }
      case T.ROCK: {
        const u = (o.lx - .5) * 2.1, v = (o.ly - .5) * 2.2, d = u * u * .85 + v * v;
        if (d > 1.15) { g = [R(['.', ':', ',', "'"], h), ROCK(.5 + .3 * h2)]; break; }   // grit around the boulder
        if (v < -.3 && N3(gx / 4, gy / 2) > .52) { g = [R(MOSS_RAMP.slice(2), h), MOSS(.3 + .4 * h2)]; break; }
        const light = clamp(-.45 * u - .55 * v + .45 * Math.sqrt(Math.max(0, 1 - d * .8)) + (h - .5) * .25 + .2, 0, 1);
        g = [ROCK_RAMP[Math.floor((1 - light) * .999 * 9)], ROCK(light * .85 + .05)];
        break;
      }
      case T.LAVENDER: {   // snails steer clear of strong-smelling herbs
        if (o.bush) {
          const c = BUSH[o.lr] && BUSH[o.lr][o.lc];
          if (c && c !== ' ') { g = [c, '*:.'.includes(c) ? R(LAV, h) : '#6f8a5c']; break; }
        }
        if (h < .38) g = [flick(o.now, h, .5) ? R(['*', ':', '"'], h2) : R([':', "'", '*'], h2), R(LAV, h2)];   // flower spikes, swaying
        else if (h < .78) g = [R(['|', '/', '\\', '|', "'"], h2), R(['#7d9a6a', '#8fa87c', '#6f8a5c'], h)];        // grey-green stems
        else g = [' ', null];
        break;
      }
      case T.VOID:   // past the edge: a few last grains, thinning out into paper
        if (o.edge > -.22 && h < (1 + o.edge / .22) * .28) g = [R(['.', ',', "'", '`'], h2), SOIL(.72 + .2 * h2)];
        else g = [' ', null];
        break;
      default: g = ['?', '#f0f'];
    }
    // land touching water gets a damp margin, so shores read as wet
    if (o.shore) {
      g[2] = 'rgba(90,155,240,.08)';
      if ((type === T.SOIL || type === T.DAMP) && h < .7) g = [R([':', '.', ',', ';', "'"], h2), 'rgba(70,115,165,.75)', g[2]];
    }
    return g;
  };
}
