"use client";

import { useRef, useMemo, useEffect, useState, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/* ───────────────────────────────────────────────────────
   Stamp pass — accumulates brushstrokes into an FBO.
   Reads the previous frame, applies slow organic morphing
   (noise-based UV displacement), decays, and deposits
   new paint at the interpolated mouse trail.
   ─────────────────────────────────────────────────────── */

const stampVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const stampFrag = /* glsl */ `
uniform sampler2D uPrev;
uniform sampler2D uTextMask;
uniform vec2 uMouse;
uniform vec2 uPrevMouse;
uniform float uTime;
uniform float uDecay;
uniform vec2 uRes;
uniform float uActive;
uniform float uDrift;
uniform float uTextMaskStrength;

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  vec2 shift = vec2(100.0);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = vUv;
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);

  vec2 morph = vec2(
    fbm(uv * 3.0 + uTime * 0.05) - 0.5,
    fbm(uv * 3.0 + uTime * 0.05 + 43.0) - 0.5
  ) * 0.0018 * uDrift;

  float h = texture2D(uPrev, uv + morph).r * uDecay;

  if (uActive < 0.5) {
    gl_FragColor = vec4(h, 0.0, 0.0, 1.0);
    return;
  }

  vec2 dir = uMouse - uPrevMouse;
  float spd = length(dir * asp);
  float ang = length(dir) > 0.0003
    ? atan(dir.y * asp.y, dir.x * asp.x)
    : 0.0;
  float cs = cos(ang), sn = sin(ang);

  float paperGrain = fbm(uv * 600.0);
  float grainMask = 0.65 + paperGrain * 0.7;

  int steps = int(clamp(spd * 140.0, 1.0, 32.0));
  float deposit = 0.0;
  float edgePool = 0.0;

  for (int i = 0; i <= 32; i++) {
    if (i > steps) break;
    float t = float(i) / max(float(steps), 1.0);
    vec2 pos = mix(uPrevMouse, uMouse, t);
    vec2 diff = (uv - pos) * asp;

    vec2 rd = vec2(diff.x * cs + diff.y * sn, -diff.x * sn + diff.y * cs);
    rd.x /= max(1.0 + spd * 8.0, 1.0);

    float wobble = noise(vec2(t * 40.0 + ang * 2.0, uTime * 0.3));

    float brushAngle = 0.785;
    float dirEffect = abs(sin(ang - brushAngle));
    float dirWidth = 0.55 + dirEffect * 0.75;

    float r = (0.024 + spd * 0.03) * dirWidth * (1.0 + smoothstep(0.008, 0.04, spd) * 0.15) * (0.9 + wobble * 0.2);

    float boundaryNoise = noise(vec2(atan(rd.y, rd.x) * 2.0 + t * 5.0, length(rd) * 30.0));
    float d = length(rd) + (boundaryNoise - 0.5) * r * 0.12;

    float stroke = exp(-d * d / (r * r * 0.5));
    stroke *= smoothstep(r * 1.3, r * 0.4, d);

    vec2 bristleCoord = vec2(rd.x * 12.0, rd.y * 180.0);
    float bristle = noise(bristleCoord + vec2(uTime * 0.04, ang * 0.5));

    float edgeDist = abs(rd.y) / max(r, 0.001);
    float edgeMask = smoothstep(0.4, 0.9, edgeDist);
    bristle = mix(1.0, smoothstep(0.3, 0.6, bristle), edgeMask * 0.4);

    float dryness = smoothstep(0.02, 0.06, spd);
    float dryNoise = noise(uv * 60.0 + vec2(ang, uTime * 0.03));
    bristle = mix(bristle, bristle * smoothstep(0.2, 0.7, dryNoise), dryness * 0.3);

    stroke *= mix(1.0, grainMask, 0.4);
    stroke *= bristle;
    deposit = max(deposit, stroke);

    float poolZone = smoothstep(r * 0.5, r * 0.9, d) * smoothstep(r * 1.4, r * 0.9, d);
    edgePool = max(edgePool, poolZone * bristle * 0.5);
  }

  if (spd > 0.02) {
    float splatterChance = fbm(uv * 300.0 + uTime * 0.5);
    vec2 mouseAsp = uMouse * asp;
    float mouseDist = length(uv * asp - mouseAsp);
    float splatterMask = smoothstep(0.15, 0.03, mouseDist) * smoothstep(0.005, 0.02, mouseDist);
    float splatter = step(0.82, splatterChance) * splatterMask * spd * 8.0;
    deposit = max(deposit, splatter * grainMask);
  }

  // Text-shape mask: when uTextMaskStrength > 0, new ink only deposits where
  // the mask is white (i.e., inside the text glyph shapes). Existing FBO ink
  // (h, decayed from previous frame) is unaffected — it just decays away.
  // Result: brush physically forms the text shape over time.
  float maskValue = texture2D(uTextMask, vUv).r;
  float effectiveMask = mix(1.0, maskValue, uTextMaskStrength);
  deposit *= effectiveMask;
  edgePool *= effectiveMask;

  float inkAmount = 0.18 * (0.6 + spd * 2.5);
  h = min(h + deposit * inkAmount + edgePool * 0.06, 1.0);
  gl_FragColor = vec4(h, 0.0, 0.0, 1.0);
}`;

const displayVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const displayFrag = /* glsl */ `
uniform sampler2D uHeight;
uniform vec2 uRes;

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.0 + vec2(100.0);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 tx = 1.0 / uRes;

  float h  = texture2D(uHeight, vUv).r;
  float hL = texture2D(uHeight, vUv - vec2(tx.x, 0.0)).r;
  float hR = texture2D(uHeight, vUv + vec2(tx.x, 0.0)).r;
  float hU = texture2D(uHeight, vUv + vec2(0.0, tx.y)).r;
  float hD = texture2D(uHeight, vUv - vec2(0.0, tx.y)).r;

  vec3 N = normalize(vec3((hL - hR) * 8.0, (hD - hU) * 8.0, 1.0));
  vec3 L = normalize(vec3(0.4, 0.6, 1.0));
  float diff = dot(N, L) * 0.5 + 0.5;

  float grad = length(vec2(hR - hL, hU - hD)) * 20.0;
  float edgeDarken = smoothstep(0.0, 1.0, grad) * 0.15;

  float inkDensity = smoothstep(0.0, 0.05, h);
  float shade = mix(0.16, 0.01, smoothstep(0.0, 0.45, h));
  shade -= edgeDarken;
  shade = max(shade, 0.0);

  float paperFiber = fbm(vUv * 800.0) * 0.08;
  float thinInkMask = 1.0 - smoothstep(0.0, 0.3, h);
  shade += paperFiber * thinInkMask;

  vec3 color = vec3(1.0);
  float alpha = clamp(inkDensity * (0.85 + h * 0.6), 0.0, 1.0);

  gl_FragColor = vec4(color, alpha);
}`;

/* ───────────────────────────────────────────────────────
   Path types + Catmull-Rom helper
   Coordinate system: source x 0→1024 left→right, y 0→1024 bottom→top
   ─────────────────────────────────────────────────────── */

interface PathPoint { x: number; y: number }
interface StrokeDef { points: PathPoint[]; duration: number; gap?: number }

function catmullRom(pts: [number, number][], n = 30): PathPoint[] {
  if (pts.length < 2) return pts.map(([x, y]) => ({ x, y }));
  const out: PathPoint[] = [];
  const p = [pts[0], ...pts, pts[pts.length - 1]];
  const segments = p.length - 3;

  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const seg = Math.min(Math.floor(t * segments), segments - 1);
    const lt = (t * segments) - seg;
    const lt2 = lt * lt, lt3 = lt2 * lt;

    const p0 = p[seg], p1 = p[seg + 1], p2 = p[seg + 2], p3 = p[seg + 3];
    out.push({
      x: 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * lt + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * lt2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * lt3),
      y: 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * lt + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * lt2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * lt3),
    });
  }
  return out;
}

// Standard transform: source 1024×1024, centered around (512, 400), output to UV
function makeTransform(scale: number, cx: number, cy: number) {
  return (x: number, y: number): [number, number] => [
    cx + ((x - 512) / 1024) * scale,
    cy + ((y - 400) / 1024) * scale,
  ];
}

function buildStrokes(
  groups: [number, number][][],
  durations: number[],
  gaps: number[],
  scale = 0.75,
  cx = 0.5,
  cy = 0.52,
): StrokeDef[] {
  const hw = makeTransform(scale, cx, cy);
  return groups.map((pts, i) => ({
    points: catmullRom(pts.map(([x, y]) => hw(x, y)), pts.length * 5),
    duration: durations[i],
    gap: gaps[i] ?? 0,
  }));
}

/* ───────────────────────────────────────────────────────
   Character path generators
   ─────────────────────────────────────────────────────── */

// 潘 — Pan (existing). Cursive (行書), 4 connected gestures.
function generatePanPaths(): StrokeDef[] {
  const shuiRadical: [number, number][] = [
    [230,770],
    [270,740],[290,700],
    [280,660],[230,620],
    [180,570],[150,520],
    [160,480],[200,450],
    [210,400],[190,340],
    [160,260],[150,180],
    [160,110],[190,60],
    [220,80],[260,150],
    [280,250],[300,370],
  ];
  const fanTop: [number, number][] = [
    [730,800],[710,800],
    [660,810],[580,780],
    [500,740],[440,720],
    [420,700],[400,670],
    [410,630],[450,600],
    [490,590],[530,610],
    [590,650],[650,690],
    [710,720],[730,710],
    [740,680],[720,650],
    [680,620],[640,610],
  ];
  const middleSection: [number, number][] = [
    [340,515],[400,510],
    [520,530],[660,560],
    [780,570],[840,555],
    [820,560],[750,575],
    [650,620],[580,680],
    [560,720],[550,690],
    [560,620],[565,520],
    [560,420],[555,360],
    [545,400],[520,460],
    [490,490],[440,440],
    [400,380],[360,340],
    [330,310],[340,320],
    [380,350],[440,400],
    [510,460],[570,510],
    [630,500],[710,450],
    [800,400],[900,380],
    [950,375],[965,375],
  ];
  const tianBox: [number, number][] = [
    [370,280],[385,265],
    [400,240],[415,160],
    [425,80],[432,10],
    [435,-5],[435,20],
    [435,100],[440,200],
    [445,265],[470,275],
    [530,280],[620,290],
    [710,300],[750,300],
    [775,290],[785,270],
    [790,240],[785,180],
    [778,110],[765,40],
    [750,0],[740,-30],
    [735,-10],[720,60],
    [700,130],[660,160],
    [600,170],[530,160],
    [480,150],[470,152],
    [485,160],[530,190],
    [555,220],[568,240],
    [575,210],[578,150],
    [575,100],[570,60],
    [562,40],[540,25],
    [510,15],[480,20],
    [470,25],[510,35],
    [570,45],[640,50],
    [690,48],[700,44],
  ];
  return buildStrokes(
    [shuiRadical, fanTop, middleSection, tianBox],
    [0.50, 0.55, 0.80, 0.85],
    [0.04, 0.03, 0.03, 0],
  );
}

// 家 — home/family. 行書 form: 宀 cap, 豕 spine, 撇, 捺 with hinted inner zigzag.
// Reference: Wang Xizhi (Lantingji Xu), Zhao Mengfu running-script.
function generateJiaPaths(): StrokeDef[] {
  // Group 1 — 宀 cap as one gesture: press-dot → implied lift → wide arc → right shoulder hook
  const roof: [number, number][] = [
    [510, 770], [515, 745],            // top dot, slight downward press
    [505, 735], [488, 728],            // tail of dot, brush lightens
    [380, 712], [320, 705],            // implied air-trace into cap entry
    [310, 700], [320, 695],            // tiny inflection at entry (蠶頭)
    [430, 700], [560, 705], [680, 710],// long horizontal sweep, slight upward tilt
    [745, 712], [780, 705],            // toward right shoulder
    [790, 670], [785, 615], [770, 575],// rounded right hook descending
  ];
  // Group 2 — 豕 short slant + top horizontal + curving vertical-spine
  const spine: [number, number][] = [
    [450, 580],                        // entry slant under roof
    [495, 575], [560, 580], [640, 585],// short top horizontal
    [690, 588], [705, 580],            // turn at right end
    [695, 545], [665, 500],            // small downward turn
    [610, 460], [540, 410],            // diagonal spine descent
    [490, 350], [475, 280],            // continue toward bottom of spine
    [485, 240], [510, 215],            // soft tail
  ];
  // Group 3 — long 撇 (left-falling) with hinted inner zigzag at start
  const piee: [number, number][] = [
    [610, 480],                        // start mid-right (top of 撇)
    [555, 445], [520, 415],            // gathering momentum
    [490, 380], [510, 360],            // tiny inner-stroke hint (zigzag)
    [475, 350], [445, 330],            // back into main 撇 trajectory
    [395, 280], [340, 220],            // 撇 sweeping down-left
    [275, 145], [215, 70], [180, 25],  // long taper to lower-left
  ];
  // Group 4 — long 捺 (right-falling) with widening pressure, flying-white tail
  const naa: [number, number][] = [
    [490, 460],                        // entry from spine area
    [520, 425], [555, 390],            // initial gentle descent
    [610, 340], [675, 280],            // accelerating sweep
    [745, 215], [810, 140],            // widening 捺 body
    [860, 75], [890, 40], [905, 25],   // tapering decisive exit
  ];
  return buildStrokes(
    [roof, spine, piee, naa],
    [0.55, 0.50, 0.45, 0.40],          // later strokes faster → drier brush
    [0.05, 0.04, 0.03, 0],
  );
}

// 作 — do/make. 行書 form: 亻 single S-curve + 乍 collapsed grouped gesture.
// Reference: Mi Fu (Shu Su Tie), running-script letters.
// Note: in this coord system y=0 is BOTTOM, y=1024 is TOP. Vertical descent = y decreasing.
function generateZuoPaths(): StrokeDef[] {
  // Group 1 — 亻 as one continuous gesture: entry dot → 撇 down-left → curl right → vertical → kick
  const ren: [number, number][] = [
    [310, 790], [305, 765],            // entry dot top
    [298, 720], [275, 655],            // 撇 starts down-left
    [240, 560], [212, 470],            // 撇 main descent
    [200, 395], [220, 360],            // 撇 ends, curl right
    [260, 365], [292, 400],            // light connecting filament rising slightly
    [305, 440], [305, 380],            // vertical begins (briefly inflects up before going down)
    [302, 290], [298, 200], [296, 110],// long vertical descent
    [310, 90], [325, 95],              // small rightward kick at base
  ];
  // Group 2 — 乍 as one collapsed gesture: 撇-into-horizontal cap, vertical, wavy inner horizontals
  const zha: [number, number][] = [
    [495, 790], [475, 730],            // 乍 entry: small 撇 at top
    [450, 660], [445, 615],            // continues down
    [475, 605], [560, 600],            // turns into first horizontal
    [660, 605], [745, 615],            // sweeps right
    [755, 600], [740, 565],            // small turn down (cap completes)
    [665, 525], [600, 490],            // brush moves into vertical position
    [598, 430], [598, 350], [598, 250],// long vertical of 乍, slightly leaning
    [600, 180], [605, 130],            // vertical descends to bottom
    // wavy horizontals collapsed inside (single back-and-forth zigzag)
    [605, 130], [550, 150],            // back-left along bottom horizontal
    [490, 150], [475, 165],            // continues left
    [510, 200], [600, 240], [710, 280],// up-right scribble (middle horizontal hint)
    [780, 280], [800, 270],            // exit
  ];
  return buildStrokes(
    [ren, zha],
    [0.65, 0.85],
    [0.06, 0],
  );
}

// 我 — I/me. 行書 form dominated by long 戈 hook + terminal up-flick.
// Reference: Wang Xizhi (Lantingji Xu), Zhao Mengfu running-script.
function generateWoPaths(): StrokeDef[] {
  // Group 1 — top 撇 flowing into long top horizontal
  const topBar: [number, number][] = [
    [328, 790], [350, 745],            // 撇 entry, slightly down-right
    [378, 710], [398, 700],            // 撇 ends, brush curves into horizontal start
    [470, 698], [560, 702], [650, 708],// horizontal sweep across top
    [725, 712], [770, 705],            // approach right end, slight tilt up
  ];
  // Group 2 — vertical-hook on left (descends then hooks right at base)
  const leftHook: [number, number][] = [
    [445, 720],                        // entry from upper area
    [440, 640], [435, 530], [430, 410],// long vertical descent
    [428, 300], [430, 215],            // continuing down
    [438, 185], [462, 175], [495, 188],// horizontal hook out to right at base
    [515, 200],                        // small terminal pickup
  ];
  // Group 3 — 戈 horizontal + long diagonal sweep + terminal up-flick (signature stroke)
  const geHook: [number, number][] = [
    [200, 490], [330, 488], [470, 492],// horizontal entry across middle
    [620, 498], [770, 505],            // sweeping right
    [785, 480], [778, 445],            // turn at right end into diagonal
    [740, 390], [690, 330],            // begin diagonal descent
    [625, 250], [555, 165],            // long sweeping diagonal down-left
    [490, 95], [445, 55],              // approaching bottom
    [420, 50], [425, 75], [465, 100],  // terminal up-flick (戈 hook)
  ];
  // Group 4 — small 撇 cross + top-right dot (final touches)
  const dotPie: [number, number][] = [
    [580, 365], [530, 295], [475, 230],// small 撇 going down-left across body
    [475, 230], [600, 380],            // implied lift, brush travels to dot position
    [770, 600], [798, 580], [810, 565],// top-right dot of 戈
  ];
  return buildStrokes(
    [topBar, leftHook, geHook, dotPie],
    [0.40, 0.50, 0.85, 0.40],          // 戈 sweep gets the dominant timing
    [0.05, 0.05, 0.04, 0],
  );
}

// 信 — trust/letter. 行書 form: 亻 S-curve + 言 top dot/horizontal + zigzag inner + small 口 loop.
// Reference: Wang Xizhi running-script samples, Tokyo National Museum running-script works.
function generateXinPaths(): StrokeDef[] {
  // Group 1 — 亻 (same template as 作)
  const ren: [number, number][] = [
    [310, 790], [305, 765],            // entry dot top
    [298, 720], [275, 655],            // 撇 starts down-left
    [240, 560], [212, 470],            // 撇 main descent
    [200, 395], [220, 360],            // 撇 ends, curl right
    [260, 365], [292, 400],            // light connecting filament
    [305, 440], [305, 380],            // begin vertical
    [302, 290], [298, 200], [296, 110],// long vertical descent
    [310, 90], [325, 95],              // small rightward kick at base
  ];
  // Group 2 — 言 top: press dot → drops directly into long first horizontal
  const yanTop: [number, number][] = [
    [615, 800], [612, 770],            // top dot, press
    [600, 760],                        // brush trails out of dot
    [495, 720], [560, 710], [660, 715],// drops into first horizontal
    [750, 720], [810, 718],            // sweeps long across to right
  ];
  // Group 3 — collapsed three middle horizontals into wavy zigzag (brush stays on paper)
  const yanZigzag: [number, number][] = [
    [505, 615], [600, 610], [720, 615],// second horizontal (main)
    [705, 595], [560, 555],            // returns leftward (light filament)
    [495, 540], [600, 540], [720, 545],// third horizontal (top of 口)
  ];
  // Group 4 — 口 as a small flat loop at bottom (continuous closing motion)
  const kouLoop: [number, number][] = [
    [495, 540], [488, 460], [485, 380], // left wall down
    [488, 350], [510, 340],             // turn into bottom
    [600, 345], [700, 350], [725, 355], // bottom horizontal sweeping right
    [738, 380], [735, 450], [728, 510], // right wall back up
    [705, 540], [620, 540], [510, 540], // close top (light filament)
  ];
  return buildStrokes(
    [ren, yanTop, yanZigzag, kouLoop],
    [0.55, 0.45, 0.40, 0.55],
    [0.06, 0.04, 0.04, 0],
  );
}

// Helper: convert a DOM rect to UV bounds and generate a single continuous
// wavy stroke through it. One smooth oscillating motion left→right with
// vertical amplitude tuned to cover the full title height (brush radius +
// wave amplitude ≈ glyph height). Reads as one calligraphic gesture passing
// through the text rather than discrete back-and-forth passes.
function sweepPointsFromRect(
  rect: DOMRect,
  viewportW: number,
  viewportH: number,
  padding = 8,
): [number, number][] | null {
  if (rect.width <= 0 || rect.height <= 0) return null;

  const leftUV = Math.max(0, (rect.left - padding) / viewportW);
  const rightUV = Math.min(1, (rect.right + padding) / viewportW);
  const topUV = 1 - Math.max(0, (rect.top - padding) / viewportH);
  const bottomUV = 1 - Math.min(viewportH, (rect.bottom + padding) / viewportH);

  const widthUV = rightUV - leftUV;
  const heightUV = topUV - bottomUV;
  const midUV = (topUV + bottomUV) / 2;
  // Wave amplitude — ~35% of title height. Combined with the brush radius
  // (~0.024 UV), the brush covers from baseline to cap height.
  const amp = heightUV * 0.35;

  // Single continuous wavy stroke through the middle of the title.
  // Number of oscillations scales with width so wider titles get more waves.
  const numWaves = Math.max(2, Math.round(widthUV * 8));
  const pts: [number, number][] = [];
  pts.push([leftUV, midUV]);
  for (let i = 0; i <= numWaves; i++) {
    const t = (i + 0.5) / (numWaves + 1);
    const x = leftUV + widthUV * t;
    const y = midUV + (i % 2 === 0 ? amp : -amp);
    pts.push([x, y]);
  }
  pts.push([rightUV, midUV]);
  return pts;
}

// Intro morph — DOM-driven sweeps over the home text region. Each text line's
// actual bounding box determines its sweep, so the brush passes through the
// real title positions regardless of viewport size or font scaling.
function generateIntroMorphPaths(): StrokeDef[] {
  const make = (
    pts: [number, number][],
    duration: number,
    gap: number,
  ): StrokeDef => ({
    points: catmullRom(pts, pts.length * 8),
    duration,
    gap,
  });

  if (typeof document !== "undefined") {
    const lines = Array.from(
      document.querySelectorAll(".hero-text-3d .text-3d-line"),
    ) as HTMLElement[];

    if (lines.length > 0) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const sweeps: StrokeDef[] = [];

      lines.forEach((el, i) => {
        const rect = el.getBoundingClientRect();
        const pts = sweepPointsFromRect(rect, w, h, 8);
        if (!pts) return;
        // Larger lines get longer durations
        const duration = 0.25 + Math.min(rect.height / w, 0.05) * 6;
        sweeps.push(make(pts, duration, i < lines.length - 1 ? 0.04 : 0));
      });

      if (sweeps.length > 0) return sweeps;
    }
  }

  // Fallback for SSR or when DOM isn't ready
  return [
    make(
      [
        [0.18, 0.55], [0.50, 0.555], [0.84, 0.55],
        [0.84, 0.515], [0.50, 0.520], [0.18, 0.515],
      ],
      0.55,
      0,
    ),
  ];
}

// Page-morph — DOM-driven sweep that fits the actual .page-header-title
// bounding box. The brush serpentines back and forth covering the title's
// real position + size; mask clips ink to the glyph shapes.
function generatePageMorphPaths(): StrokeDef[] {
  const make = (
    pts: [number, number][],
    duration: number,
    gap: number,
  ): StrokeDef => ({
    points: catmullRom(pts, pts.length * 8),
    duration,
    gap,
  });

  if (typeof document !== "undefined") {
    const titleEl = document.querySelector(
      ".page-header-title",
    ) as HTMLElement | null;
    if (titleEl) {
      const rect = titleEl.getBoundingClientRect();
      const pts = sweepPointsFromRect(
        rect,
        window.innerWidth,
        window.innerHeight,
        12,
      );
      if (pts) return [make(pts, 0.85, 0)];
    }
  }

  // Fallback for when the title element isn't available
  return [
    make(
      [
        [0.03, 0.79], [0.30, 0.785], [0.55, 0.79],
        [0.55, 0.74], [0.30, 0.745], [0.03, 0.74],
        [0.03, 0.69], [0.30, 0.695], [0.55, 0.69],
      ],
      0.85,
      0,
    ),
  ];
}

const CHARACTER_PATHS: Record<string, () => StrokeDef[]> = {
  "潘": generatePanPaths,
  "家": generateJiaPaths,
  "作": generateZuoPaths,
  "我": generateWoPaths,
  "信": generateXinPaths,
  "__intro_morph__": generateIntroMorphPaths,
  "__page_morph__": generatePageMorphPaths,
};

/* ───────────────────────────────────────────────────────
   Text mask — offscreen canvas with the home page's text
   rendered as white-on-black. Uploaded as a Three.js texture
   and sampled in the stamp shader to clip ink deposits to the
   text glyph shapes during the intro morph phase.
   ─────────────────────────────────────────────────────── */

// DOM-based mask generation: query the actual rendered text elements via
// getBoundingClientRect() + getComputedStyle() to get exact positions and
// fonts. This guarantees the brush mask aligns with whatever is on screen,
// regardless of viewport size, font loading, or layout changes.
//
// Targets all elements with the .brush-text-target class (page titles, home
// hero text). Each element is rendered into the mask at its real screen
// position with its actual font metrics.
function generateTextMaskFromDOM(
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#fff";

  if (typeof document === "undefined") return canvas;

  // Find all text elements that should be brushed-into.
  const selectors = [
    ".page-header-title",
    ".hero-text-3d .text-3d-line",
  ];
  const targets: HTMLElement[] = [];
  selectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      targets.push(el as HTMLElement);
    });
  });

  targets.forEach((el) => {
    const text = el.textContent?.trim();
    if (!text) return;

    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const cs = window.getComputedStyle(el);
    const fontSize = parseFloat(cs.fontSize);
    const fontFamily = cs.fontFamily;
    const fontStyle = cs.fontStyle;
    const fontWeight = cs.fontWeight;
    const textAlign = cs.textAlign;
    const letterSpacing = cs.letterSpacing;
    const textTransform = cs.textTransform;

    ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.textBaseline = "alphabetic";

    if ("letterSpacing" in ctx && letterSpacing && letterSpacing !== "normal") {
      (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
        letterSpacing;
    }

    let displayText = text;
    if (textTransform === "uppercase") displayText = text.toUpperCase();

    // Approximate baseline: bottom of element minus typical descender depth.
    // Most fonts: descender ≈ 0.15-0.20 of font size below baseline.
    const baselineY = rect.bottom - fontSize * 0.18;

    let textX: number;
    if (textAlign === "center" || textAlign === "start" && cs.direction === "rtl") {
      textX = rect.left + rect.width / 2;
      ctx.textAlign = "center";
    } else if (textAlign === "right" || textAlign === "end") {
      textX = rect.right;
      ctx.textAlign = "right";
    } else {
      // Default left
      textX = rect.left;
      ctx.textAlign = "left";
    }

    ctx.fillText(displayText, textX, baselineY);
  });

  return canvas;
}

/* ───────────────────────────────────────────────────────
   Scene
   ─────────────────────────────────────────────────────── */

interface PaintSceneProps {
  onReady?: () => void;
  drawChar?: string | null;
  onDrawComplete?: () => void;
  textMaskKey?: string;
}

function PaintScene({
  onReady,
  drawChar,
  onDrawComplete,
  textMaskKey = "/",
}: PaintSceneProps) {
  const { gl, size } = useThree();

  const readyFired = useRef(false);
  useEffect(() => {
    if (!readyFired.current) {
      readyFired.current = true;
      onReady?.();
    }
  }, [onReady]);

  const targets = useMemo(() => {
    const o: THREE.RenderTargetOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
    };
    return [
      new THREE.WebGLRenderTarget(1, 1, o),
      new THREE.WebGLRenderTarget(1, 1, o),
    ];
  }, []);

  const offScene = useMemo(() => new THREE.Scene(), []);
  const offCam = useMemo(
    () => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    []
  );

  // Text mask: regenerated from current DOM whenever textMaskKey changes
  // (i.e., the active page changed). The DOM is the source of truth — we
  // measure the actual rendered title element so the brush mask aligns
  // pixel-perfectly with it regardless of viewport/font/layout state.
  const textMaskTexture = useMemo(() => {
    if (typeof window === "undefined") return new THREE.Texture();
    const canvas = generateTextMaskFromDOM(
      window.innerWidth,
      window.innerHeight,
    );
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateMask = () => {
      const canvas = generateTextMaskFromDOM(
        window.innerWidth,
        window.innerHeight,
      );
      textMaskTexture.image = canvas;
      textMaskTexture.needsUpdate = true;
    };
    updateMask();

    let timer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(updateMask, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (timer) clearTimeout(timer);
    };
  }, [textMaskKey, textMaskTexture]);

  const stampMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: stampVert,
        fragmentShader: stampFrag,
        uniforms: {
          uPrev: { value: null },
          uTextMask: { value: textMaskTexture as THREE.Texture },
          uMouse: { value: new THREE.Vector2(-1, -1) },
          uPrevMouse: { value: new THREE.Vector2(-1, -1) },
          uTime: { value: 0 },
          uDecay: { value: 0.996 },
          uRes: { value: new THREE.Vector2(1, 1) },
          uActive: { value: 0 },
          uDrift: { value: 0 },
          uTextMaskStrength: { value: 0 },
        },
      }),
    []
  );

  useEffect(() => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), stampMat);
    offScene.add(mesh);
    return () => {
      offScene.remove(mesh);
      mesh.geometry.dispose();
    };
  }, [offScene, stampMat]);

  useEffect(() => {
    return () => {
      targets[0].dispose();
      targets[1].dispose();
      stampMat.dispose();
    };
  }, [targets, stampMat]);

  // Mouse state
  const mouseRaw = useRef(new THREE.Vector2(-1, -1));
  const mouseSmooth = useRef(new THREE.Vector2(-1, -1));
  const mousePrev = useRef(new THREE.Vector2(-1, -1));
  const hasMoved = useRef(false);
  const pingPong = useRef(0);

  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      mouseRaw.current.set(
        e.clientX / window.innerWidth,
        1 - e.clientY / window.innerHeight
      );
      hasMoved.current = true;
    };
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) {
        mouseRaw.current.set(
          t.clientX / window.innerWidth,
          1 - t.clientY / window.innerHeight
        );
        hasMoved.current = true;
      }
    };
    window.addEventListener("mousemove", onMouse);
    window.addEventListener("touchmove", onTouch, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("touchmove", onTouch);
    };
  }, []);

  useEffect(() => {
    const w = Math.floor(size.width);
    const h = Math.floor(size.height);
    targets[0].setSize(w, h);
    targets[1].setSize(w, h);
    stampMat.uniforms.uRes.value.set(w, h);
  }, [size, targets, stampMat]);

  // Draw-character state — re-derived when drawChar changes
  const charPaths = useMemo(() => {
    if (!drawChar) return null;
    const gen = CHARACTER_PATHS[drawChar];
    return gen ? gen() : null;
  }, [drawChar]);

  const charTimeline = useMemo(() => {
    if (!charPaths) return null;
    const entries: { start: number; end: number }[] = [];
    let t = 0;
    for (let i = 0; i < charPaths.length; i++) {
      const s = charPaths[i];
      entries.push({ start: t, end: t + s.duration });
      t += s.duration + (s.gap ?? 0.06);
    }
    return { entries, totalDuration: t };
  }, [charPaths]);

  const drawState = useRef({
    currentStroke: -1,
    startTime: -1,
    pathStarted: false,
    done: false,
    activeChar: null as string | null,
  });

  // Reset draw state whenever drawChar changes
  useEffect(() => {
    drawState.current = {
      currentStroke: -1,
      startTime: -1,
      pathStarted: false,
      done: false,
      activeChar: drawChar ?? null,
    };
  }, [drawChar]);

  const onDrawCompleteRef = useRef(onDrawComplete);
  onDrawCompleteRef.current = onDrawComplete;

  const drawTarget = useRef(new THREE.Vector2(0.5, 0.5));
  const dispRef = useRef<THREE.ShaderMaterial>(null);

  function brushEase(t: number): number {
    if (t < 0.12) {
      const n = t / 0.12;
      return n * n * n * 0.12;
    }
    if (t < 0.3) {
      const n = (t - 0.12) / 0.18;
      return 0.12 + n * n * 0.18;
    }
    if (t < 0.8) {
      const n = (t - 0.3) / 0.5;
      const s = n * n * n * (n * (n * 6 - 15) + 10);
      return 0.30 + s * 0.50;
    }
    const n = (t - 0.8) / 0.2;
    return 0.80 + (1 - (1 - n) * (1 - n)) * 0.20;
  }

  useFrame(({ clock }) => {
    const u = stampMat.uniforms;
    const elapsed = clock.elapsedTime;

    // Animate text-mask strength: enabled while drawing any morph character.
    // Brush ink only deposits within the active page's text glyph shapes,
    // so the brushstrokes physically form the text on EVERY transition.
    const isMorphing =
      drawChar === "__intro_morph__" || drawChar === "__page_morph__";
    const targetMaskStrength = isMorphing ? 1.0 : 0.0;
    u.uTextMaskStrength.value +=
      (targetMaskStrength - u.uTextMaskStrength.value) * 0.15;

    // Character-drawing mode
    if (charPaths && charTimeline && !drawState.current.done) {
      const st = drawState.current;
      if (st.startTime < 0) st.startTime = elapsed;
      const drawElapsed = elapsed - st.startTime;

      if (drawElapsed > charTimeline.totalDuration) {
        st.done = true;
        u.uActive.value = 0;
        onDrawCompleteRef.current?.();
      } else {
        let strokeIdx = -1;
        let strokeProgress = 0;
        let isDrawing = false;

        for (let i = 0; i < charTimeline.entries.length; i++) {
          const { start, end } = charTimeline.entries[i];
          if (drawElapsed >= start && drawElapsed <= end) {
            strokeIdx = i;
            strokeProgress = (drawElapsed - start) / (end - start);
            isDrawing = true;
            break;
          }
          if (drawElapsed < start) break;
        }

        if (!isDrawing) {
          u.uActive.value = 0;
        } else {
          if (strokeIdx !== st.currentStroke) {
            st.currentStroke = strokeIdx;
            st.pathStarted = false;
          }

          const stroke = charPaths[strokeIdx];
          const eased = brushEase(Math.min(strokeProgress, 1));
          const pts = stroke.points;
          const rawIdx = eased * (pts.length - 1);
          const lo = Math.floor(rawIdx);
          const hi = Math.min(lo + 1, pts.length - 1);
          const frac = rawIdx - lo;

          const tx = pts[lo].x + (pts[hi].x - pts[lo].x) * frac;
          const ty = pts[lo].y + (pts[hi].y - pts[lo].y) * frac;
          drawTarget.current.set(tx, ty);

          if (!st.pathStarted) {
            mouseSmooth.current.set(tx, ty);
            mousePrev.current.set(tx, ty);
            st.pathStarted = true;
            u.uActive.value = 0;
          } else {
            mousePrev.current.copy(mouseSmooth.current);
            mouseSmooth.current.lerp(drawTarget.current, 0.45);
            u.uActive.value = 1;
          }
        }
      }
      // Pause drift while drawing
      u.uDrift.value = 0;
    } else {
      // Mouse mode
      mousePrev.current.copy(mouseSmooth.current);
      if (hasMoved.current) {
        mouseSmooth.current.lerp(mouseRaw.current, 0.12);
      }
      u.uActive.value = hasMoved.current ? 1 : 0;
      u.uDrift.value = Math.min(1, u.uDrift.value + 0.005);
    }

    const wr = targets[pingPong.current];
    const rd = targets[1 - pingPong.current];

    u.uPrev.value = rd.texture;
    u.uMouse.value.copy(mouseSmooth.current);
    u.uPrevMouse.value.copy(mousePrev.current);
    u.uTime.value = elapsed;

    gl.setRenderTarget(wr);
    gl.render(offScene, offCam);
    gl.setRenderTarget(null);

    if (dispRef.current) {
      dispRef.current.uniforms.uHeight.value = wr.texture;
      dispRef.current.uniforms.uRes.value.set(wr.width, wr.height);
    }

    pingPong.current = 1 - pingPong.current;
  });

  const dispUniforms = useMemo(
    () => ({
      uHeight: { value: null as THREE.Texture | null },
      uRes: { value: new THREE.Vector2(1, 1) },
    }),
    []
  );

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={dispRef}
        vertexShader={displayVert}
        fragmentShader={displayFrag}
        uniforms={dispUniforms}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}

interface BrushstrokeReliefProps {
  onReady?: () => void;
  drawChar?: string | null;
  onDrawComplete?: () => void;
  textMaskKey?: string;
}

export default function BrushstrokeRelief({
  onReady,
  drawChar,
  onDrawComplete,
  textMaskKey,
}: BrushstrokeReliefProps) {
  return (
    <div className="brushstroke-canvas">
      <Canvas
        gl={{ alpha: true, antialias: false }}
        camera={{ position: [0, 0, 1] }}
        style={{ background: "transparent" }}
      >
        <PaintScene
          onReady={onReady}
          drawChar={drawChar}
          onDrawComplete={onDrawComplete}
          textMaskKey={textMaskKey}
        />
      </Canvas>
    </div>
  );
}
