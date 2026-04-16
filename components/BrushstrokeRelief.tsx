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
uniform vec2 uMouse;
uniform vec2 uPrevMouse;
uniform float uTime;
uniform float uDecay;
uniform vec2 uRes;
uniform float uActive;
uniform float uDrift;

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

// Fractal Brownian Motion — layered noise for organic richness
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

  // Organic drift — morph the accumulated ink slowly (suppressed during intro)
  vec2 morph = vec2(
    fbm(uv * 3.0 + uTime * 0.05) - 0.5,
    fbm(uv * 3.0 + uTime * 0.05 + 43.0) - 0.5
  ) * 0.0018 * uDrift;

  float h = texture2D(uPrev, uv + morph).r * uDecay;

  if (uActive < 0.5) {
    gl_FragColor = vec4(h, 0.0, 0.0, 1.0);
    return;
  }

  // Stroke direction & speed
  vec2 dir = uMouse - uPrevMouse;
  float spd = length(dir * asp);
  float ang = length(dir) > 0.0003
    ? atan(dir.y * asp.y, dir.x * asp.x)
    : 0.0;
  float cs = cos(ang), sn = sin(ang);

  // Paper grain — ink absorbs unevenly into the surface
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

    // Rotate into stroke-aligned space (x = along, y = across)
    vec2 rd = vec2(diff.x * cs + diff.y * sn, -diff.x * sn + diff.y * cs);

    // Elongation
    rd.x /= max(1.0 + spd * 8.0, 1.0);

    // Organic brush wobble — radius varies along the stroke
    float wobble = noise(vec2(t * 40.0 + ang * 2.0, uTime * 0.3));

    // Calligraphy brush simulation — width depends on stroke direction
    // Brush held at ~45° angle: perpendicular motion = thick, parallel = thin
    float brushAngle = 0.785; // 45° — standard Chinese brush hold
    float dirEffect = abs(sin(ang - brushAngle));
    // Width ranges from 0.55x (moving along brush axis) to 1.3x (perpendicular)
    float dirWidth = 0.55 + dirEffect * 0.75;

    float r = (0.024 + spd * 0.03) * dirWidth * (1.0 + smoothstep(0.008, 0.04, spd) * 0.15) * (0.9 + wobble * 0.2);

    // Smooth brush boundary — subtle distortion for organic feel without jaggedness
    float boundaryNoise = noise(vec2(atan(rd.y, rd.x) * 2.0 + t * 5.0, length(rd) * 30.0));
    float d = length(rd) + (boundaryNoise - 0.5) * r * 0.12;

    // Smooth falloff — wide gaussian for clean calligraphic edges
    float stroke = exp(-d * d / (r * r * 0.5));
    stroke *= smoothstep(r * 1.3, r * 0.4, d);

    // Subtle bristle texture — mostly solid with gentle variation
    vec2 bristleCoord = vec2(rd.x * 12.0, rd.y * 180.0);
    float bristle = noise(bristleCoord + vec2(uTime * 0.04, ang * 0.5));

    // Bristle only at outer edges, solid core — smooth calligraphy look
    float edgeDist = abs(rd.y) / max(r, 0.001);
    float edgeMask = smoothstep(0.4, 0.9, edgeDist);
    bristle = mix(1.0, smoothstep(0.3, 0.6, bristle), edgeMask * 0.4);

    // Flying white — very subtle, only at high speed
    float dryness = smoothstep(0.02, 0.06, spd);
    float dryNoise = noise(uv * 60.0 + vec2(ang, uTime * 0.03));
    bristle = mix(bristle, bristle * smoothstep(0.2, 0.7, dryNoise), dryness * 0.3);

    // Light paper grain interaction
    stroke *= mix(1.0, grainMask, 0.4);

    stroke *= bristle;
    deposit = max(deposit, stroke);

    // Ink pools at stroke edges
    float poolZone = smoothstep(r * 0.5, r * 0.9, d) * smoothstep(r * 1.4, r * 0.9, d);
    edgePool = max(edgePool, poolZone * bristle * 0.5);
  }

  // Splatter — tiny ink droplets flung off fast strokes
  if (spd > 0.02) {
    float splatterChance = fbm(uv * 300.0 + uTime * 0.5);
    vec2 mouseAsp = uMouse * asp;
    float mouseDist = length(uv * asp - mouseAsp);
    float splatterMask = smoothstep(0.15, 0.03, mouseDist) * smoothstep(0.005, 0.02, mouseDist);
    float splatter = step(0.82, splatterChance) * splatterMask * spd * 8.0;
    deposit = max(deposit, splatter * grainMask);
  }

  // Accumulate ink + edge pooling — more dramatic at slow speed (press), lighter at fast
  float inkAmount = 0.18 * (0.6 + spd * 2.5);
  h = min(h + deposit * inkAmount + edgePool * 0.06, 1.0);
  gl_FragColor = vec4(h, 0.0, 0.0, 1.0);
}`;

/* ───────────────────────────────────────────────────────
   Display pass — renders the height map as dark ink
   with subtle relief texture.
   ─────────────────────────────────────────────────────── */

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

  // Relief normals
  vec3 N = normalize(vec3((hL - hR) * 8.0, (hD - hU) * 8.0, 1.0));
  vec3 L = normalize(vec3(0.4, 0.6, 1.0));
  float diff = dot(N, L) * 0.5 + 0.5;

  // Ink edge concentration
  float grad = length(vec2(hR - hL, hU - hD)) * 20.0;
  float edgeDarken = smoothstep(0.0, 1.0, grad) * 0.15;

  // Dark ink
  float inkDensity = smoothstep(0.0, 0.05, h);
  float shade = mix(0.16, 0.01, smoothstep(0.0, 0.45, h));
  shade -= edgeDarken;
  shade = max(shade, 0.0);

  // Paper fiber texture
  float paperFiber = fbm(vUv * 800.0) * 0.08;
  float thinInkMask = 1.0 - smoothstep(0.0, 0.3, h);
  shade += paperFiber * thinInkMask;

  // Relief modulation
  vec3 color = vec3(shade * (0.5 + diff * 0.5));

  // Ink opacity
  float alpha = inkDensity * (0.55 + h * 0.45);

  gl_FragColor = vec4(color, alpha);
}`;

/* ───────────────────────────────────────────────────────
   Intro animation — draw 潘 (Pan) character
   Coordinate system: x 0→1 left→right, y 0→1 bottom→top
   ─────────────────────────────────────────────────────── */

interface PathPoint { x: number; y: number }
interface StrokeDef { points: PathPoint[]; duration: number; gap?: number }

// Catmull-Rom spline for smooth, flowing curves through control points
function catmullRom(pts: [number, number][], n = 30): PathPoint[] {
  if (pts.length < 2) return pts.map(([x, y]) => ({ x, y }));
  const out: PathPoint[] = [];
  // Pad start/end for tangent calculation
  const p = [pts[0], ...pts, pts[pts.length - 1]];
  const segments = p.length - 3;

  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const seg = Math.min(Math.floor(t * segments), segments - 1);
    const lt = (t * segments) - seg;
    const lt2 = lt * lt, lt3 = lt2 * lt;

    const p0 = p[seg], p1 = p[seg + 1], p2 = p[seg + 2], p3 = p[seg + 3];
    // Catmull-Rom coefficients (tension 0.5)
    out.push({
      x: 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * lt + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * lt2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * lt3),
      y: 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * lt + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * lt2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * lt3),
    });
  }
  return out;
}

function generateIntroPaths(): StrokeDef[] {
  // 潘 — authentic semi-cursive (行書) style
  // Principles from calligraphy research:
  //   - 氵 simplified to single flowing gesture (not three separate dots)
  //   - Left radical simplified, right component emphasized
  //   - Connected writing (連綿体) — brush stays on paper within components
  //   - No hesitation — continuous rhythm, mind precedes brush
  //   - Overfilled brush gradually dries out (dark → light contrast)

  const scale = 0.75;
  const cx = 0.5;
  const cy = 0.52;

  const hw = (x: number, y: number): [number, number] => [
    cx + ((x - 512) / 1024) * scale,
    cy + ((y - 400) / 1024) * scale,
  ];

  // ─── Stroke 1: 氵 water radical — single circular flowing gesture ───
  // Rounded S-curve sweep, looping between dot positions
  const shuiRadical: [number, number][] = [
    [230,770],                    // entry at top
    [270,740],[290,700],          // arc right
    [280,660],[230,620],          // loop back left
    [180,570],[150,520],          // round into second position
    [160,480],[200,450],          // curve right
    [210,400],[190,340],          // arc back left, descending
    [160,260],[150,180],          // sweeping round descent
    [160,110],[190,60],           // curve at bottom
    [220,80],[260,150],           // circular upturn
    [280,250],[300,370],          // rising arc exit
  ];

  // ─── Stroke 2: 番 top — looping cursive arcs ───
  // Circular sweeping entry, loops through dot positions
  const fanTop: [number, number][] = [
    [730,800],[710,800],          // entry from top
    [660,810],[580,780],          // sweeping leftward arc
    [500,740],[440,720],          // round curve down
    [420,700],[400,670],          // loop into dot area
    [410,630],[450,600],          // circular upturn through dot
    [490,590],[530,610],          // arc right
    [590,650],[650,690],          // loop up toward second dot
    [710,720],[730,710],          // round into second position
    [740,680],[720,650],          // arc down
    [680,620],[640,610],          // exit with curve
  ];

  // ─── Stroke 3: 横 + vertical + falling — one circular flowing gesture ───
  // Round sweeping horizontal, loops into vertical, arcs through falling strokes
  const middleSection: [number, number][] = [
    [340,515],[400,510],          // horizontal entry
    [520,530],[660,560],          // sweeping arc across
    [780,570],[840,555],          // horizontal crest
    [820,560],[750,575],          // round reversal
    [650,620],[580,680],          // arcing up into vertical start
    [560,720],[550,690],          // loop at top
    [560,620],[565,520],          // flowing vertical descent
    [560,420],[555,360],          // continue curving down
    [545,400],[520,460],          // round curve back up
    [490,490],[440,440],          // arcing into left-falling
    [400,380],[360,340],          // sweeping 撇 curve
    [330,310],[340,320],          // soft round exit
    [380,350],[440,400],          // circular return
    [510,460],[570,510],          // arc into right-falling
    [630,500],[710,450],          // sweeping right arc
    [800,400],[900,380],          // broad 捺 curve
    [950,375],[965,375],          // exit
  ];

  // ─── Stroke 4: 田 box — circular continuous motion ───
  // Rounded corners, flowing loops at direction changes
  const tianBox: [number, number][] = [
    [370,280],[385,265],          // entry top-left
    [400,240],[415,160],          // curve down left wall
    [425,80],[432,10],            // continue down
    [435,-5],[435,20],            // soft round bottom
    [435,100],[440,200],          // circular upturn
    [445,265],[470,275],          // arc into top
    [530,280],[620,290],          // sweep across top
    [710,300],[750,300],          // continue right
    [775,290],[785,270],          // round top-right corner
    [790,240],[785,180],          // curve down right wall
    [778,110],[765,40],           // continue descending
    [750,0],[740,-30],            // round bottom-right
    [735,-10],[720,60],           // circular upturn
    [700,130],[660,160],          // arc into inner horizontal
    [600,170],[530,160],          // sweep across inner
    [480,150],[470,152],          // reach left
    [485,160],[530,190],          // loop into inner vertical
    [555,220],[568,240],          // arc at top
    [575,210],[578,150],          // vertical descent
    [575,100],[570,60],           // continue down
    [562,40],[540,25],            // round exit
    [510,15],[480,20],            // arc into bottom horizontal
    [470,25],[510,35],            // sweep entry
    [570,45],[640,50],            // across bottom
    [690,48],[700,44],            // exit
  ];

  const groups = [shuiRadical, fanTop, middleSection, tianBox];
  const durations = [0.50, 0.55, 0.80, 0.85]; // total ~2.7s + gaps
  const gaps = [0.04, 0.03, 0.03, 0];

  return groups.map((pts, i) => ({
    points: catmullRom(pts.map(([x, y]) => hw(x, y)), pts.length * 5),
    duration: durations[i],
    gap: gaps[i],
  }));
}

/* ───────────────────────────────────────────────────────
   Scene — FBO ping-pong, mouse tracking, render loop
   ─────────────────────────────────────────────────────── */

interface PaintSceneProps {
  onReady?: () => void;
  introActive?: boolean;
  onIntroDone?: () => void;
}

function PaintScene({ onReady, introActive, onIntroDone }: PaintSceneProps) {
  const { gl, size } = useThree();

  // Signal ready once canvas is mounted
  const readyFired = useRef(false);
  useEffect(() => {
    if (!readyFired.current) {
      readyFired.current = true;
      onReady?.();
    }
  }, [onReady]);

  // Ping-pong render targets
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

  const stampMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: stampVert,
        fragmentShader: stampFrag,
        uniforms: {
          uPrev: { value: null },
          uMouse: { value: new THREE.Vector2(-1, -1) },
          uPrevMouse: { value: new THREE.Vector2(-1, -1) },
          uTime: { value: 0 },
          uDecay: { value: 0.996 },
          uRes: { value: new THREE.Vector2(1, 1) },
          uActive: { value: 0 },
          uDrift: { value: 0 },
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

  // Resize render targets
  useEffect(() => {
    const w = Math.floor(size.width);
    const h = Math.floor(size.height);
    targets[0].setSize(w, h);
    targets[1].setSize(w, h);
    stampMat.uniforms.uRes.value.set(w, h);
  }, [size, targets, stampMat]);

  // Intro animation state
  const introStrokes = useMemo(() => generateIntroPaths(), []);
  // Precompute cumulative start times for each stroke (per-stroke gaps)
  const strokeTimeline = useMemo(() => {
    const timeline: { start: number; end: number }[] = [];
    let t = 0;
    for (let i = 0; i < introStrokes.length; i++) {
      const s = introStrokes[i];
      timeline.push({ start: t, end: t + s.duration });
      t += s.duration + (s.gap ?? 0.06);
    }
    return { entries: timeline, totalDuration: t };
  }, [introStrokes]);

  const introState = useRef({
    currentStroke: -1,
    startTime: -1,
    pathStarted: false,
    done: false,
  });
  const introActiveRef = useRef(introActive);
  introActiveRef.current = introActive;
  const onIntroDoneRef = useRef(onIntroDone);
  onIntroDoneRef.current = onIntroDone;
  const introTarget = useRef(new THREE.Vector2(0.5, 0.5));

  const dispRef = useRef<THREE.ShaderMaterial>(null);

  // Physics-based brush easing — models real brush-on-paper dynamics
  // Brush has mass, paper has friction, arm has natural swing arc
  function brushEase(t: number): number {
    // Ink contact phase — wet brush meets paper, friction + ink absorption
    // creates drag. Cubic ease-in models static friction breaking.
    if (t < 0.12) {
      const n = t / 0.12;
      return n * n * n * 0.12;
    }
    // Momentum build — arm accelerates, brush overcomes paper friction
    // Smooth transition from drag to flow (quadratic acceleration)
    if (t < 0.3) {
      const n = (t - 0.12) / 0.18;
      return 0.12 + n * n * 0.18;
    }
    // Inertial cruise — brush carried by arm momentum
    // Smootherstep (Perlin): zero acceleration at both boundaries,
    // models natural arm swing where force is constant
    if (t < 0.8) {
      const n = (t - 0.3) / 0.5;
      const s = n * n * n * (n * (n * 6 - 15) + 10); // smootherstep
      return 0.30 + s * 0.50;
    }
    // Deceleration — arm extends, brush lifts naturally
    // Quadratic ease-out models friction + gravity slowing the stroke
    const n = (t - 0.8) / 0.2;
    return 0.80 + (1 - (1 - n) * (1 - n)) * 0.20;
  }

  useFrame(({ clock }) => {
    const u = stampMat.uniforms;
    const elapsed = clock.elapsedTime;

    // Intro animation — draw 潘 character stroke by stroke
    if (introActiveRef.current && !introState.current.done) {
      const st = introState.current;
      if (st.startTime < 0) st.startTime = elapsed;

      const introElapsed = elapsed - st.startTime;

      if (introElapsed > strokeTimeline.totalDuration) {
        st.done = true;
        u.uActive.value = 0;
        onIntroDoneRef.current?.();
      } else {
        // Find which stroke we're on
        let strokeIdx = -1;
        let strokeProgress = 0;
        let isDrawing = false;

        for (let i = 0; i < strokeTimeline.entries.length; i++) {
          const { start, end } = strokeTimeline.entries[i];
          if (introElapsed >= start && introElapsed <= end) {
            strokeIdx = i;
            strokeProgress = (introElapsed - start) / (end - start);
            isDrawing = true;
            break;
          }
          // In a gap
          if (introElapsed < start) break;
        }

        if (!isDrawing) {
          u.uActive.value = 0;
        } else {
          if (strokeIdx !== st.currentStroke) {
            st.currentStroke = strokeIdx;
            st.pathStarted = false;
          }

          const stroke = introStrokes[strokeIdx];
          const eased = brushEase(Math.min(strokeProgress, 1));
          const pts = stroke.points;
          const rawIdx = eased * (pts.length - 1);
          const lo = Math.floor(rawIdx);
          const hi = Math.min(lo + 1, pts.length - 1);
          const frac = rawIdx - lo;

          const tx = pts[lo].x + (pts[hi].x - pts[lo].x) * frac;
          const ty = pts[lo].y + (pts[hi].y - pts[lo].y) * frac;
          introTarget.current.set(tx, ty);

          if (!st.pathStarted) {
            mouseSmooth.current.set(tx, ty);
            mousePrev.current.set(tx, ty);
            st.pathStarted = true;
            u.uActive.value = 0;
          } else {
            mousePrev.current.copy(mouseSmooth.current);
            mouseSmooth.current.lerp(introTarget.current, 0.45);
            u.uActive.value = 1;
          }
        }
      }
    } else {
      // Normal mouse mode
      mousePrev.current.copy(mouseSmooth.current);
      if (hasMoved.current) {
        mouseSmooth.current.lerp(mouseRaw.current, 0.12);
      }
      u.uActive.value = hasMoved.current ? 1 : 0;
      // Smoothly ramp drift on after intro completes
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

/* ───────────────────────────────────────────────────────
   Exported component
   ─────────────────────────────────────────────────────── */

interface BrushstrokeReliefProps {
  onReady?: () => void;
  introActive?: boolean;
  onIntroDone?: () => void;
}

export default function BrushstrokeRelief({
  onReady,
  introActive,
  onIntroDone,
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
          introActive={introActive}
          onIntroDone={onIntroDone}
        />
      </Canvas>
    </div>
  );
}
