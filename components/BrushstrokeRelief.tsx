"use client";

import { useRef, useMemo, useEffect } from "react";
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

  // Organic drift — morph the accumulated ink slowly
  vec2 morph = vec2(
    fbm(uv * 3.0 + uTime * 0.05) - 0.5,
    fbm(uv * 3.0 + uTime * 0.05 + 43.0) - 0.5
  ) * 0.0018;

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
    float r = (0.02 + spd * 0.035) * (0.8 + wobble * 0.4);

    // Irregular brush boundary — distort the distance field
    float boundaryNoise = fbm(vec2(atan(rd.y, rd.x) * 3.0 + t * 10.0, length(rd) * 50.0));
    float d = length(rd) + (boundaryNoise - 0.5) * r * 0.35;

    // Soft falloff
    float stroke = exp(-d * d / (r * r * 0.4));
    stroke *= smoothstep(r * 1.6, r * 0.35, d);

    // Multi-scale bristle texture via FBM
    vec2 bristleCoord = vec2(rd.x * 18.0, rd.y * 280.0);
    float bristle = fbm(bristleCoord + vec2(uTime * 0.04, ang * 0.5));

    // Bristle gaps stronger at edges, solid core
    float edgeDist = abs(rd.y) / max(r, 0.001);
    float edgeMask = smoothstep(0.2, 0.8, edgeDist);
    bristle = mix(1.0, smoothstep(0.18, 0.55, bristle), edgeMask * 0.85);

    // Flying white (飞白) — dry-brush at speed
    float dryness = smoothstep(0.01, 0.05, spd);
    float dryNoise = fbm(uv * 80.0 + vec2(ang, uTime * 0.03));
    bristle = mix(bristle, bristle * smoothstep(0.1, 0.6, dryNoise), dryness * 0.55);

    // Paper grain interaction — ink sinks into paper texture
    stroke *= grainMask;

    stroke *= bristle;
    deposit = max(deposit, stroke);

    // Ink pools at stroke edges (like real ink concentration at boundaries)
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

  // Accumulate ink + edge pooling
  float inkAmount = 0.14 * (0.5 + spd * 3.5);
  h = min(h + deposit * inkAmount + edgePool * 0.06, 1.0);
  gl_FragColor = vec4(h, 0.0, 0.0, 1.0);
}`;

/* ───────────────────────────────────────────────────────
   Display pass — renders the height map as dark ink
   with subtle relief texture, like ink calligraphy
   on paper with visible brushstroke depth.
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

  // Ink edge concentration — gradient magnitude shows stroke boundaries
  float grad = length(vec2(hR - hL, hU - hD)) * 20.0;
  float edgeDarken = smoothstep(0.0, 1.0, grad) * 0.15;

  // Dark ink — thicker is deeper black, with edge pooling
  float inkDensity = smoothstep(0.0, 0.05, h);
  float shade = mix(0.16, 0.01, smoothstep(0.0, 0.45, h));
  shade -= edgeDarken;
  shade = max(shade, 0.0);

  // Paper fiber texture — subtle grain visible through thin ink
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
   Scene — FBO ping-pong, mouse tracking, render loop
   ─────────────────────────────────────────────────────── */

function PaintScene() {
  const { gl, size } = useThree();

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

  // Offscreen scene for the stamp pass
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
        },
      }),
    []
  );

  // Add fullscreen quad to offscreen scene
  useEffect(() => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), stampMat);
    offScene.add(mesh);
    return () => {
      offScene.remove(mesh);
      mesh.geometry.dispose();
    };
  }, [offScene, stampMat]);

  // Cleanup
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

  const dispRef = useRef<THREE.ShaderMaterial>(null);

  useFrame(({ clock }) => {
    // Smooth mouse with lerp
    mousePrev.current.copy(mouseSmooth.current);
    if (hasMoved.current) {
      mouseSmooth.current.lerp(mouseRaw.current, 0.12);
    }

    const wr = targets[pingPong.current];
    const rd = targets[1 - pingPong.current];

    // Update stamp uniforms
    const u = stampMat.uniforms;
    u.uPrev.value = rd.texture;
    u.uMouse.value.copy(mouseSmooth.current);
    u.uPrevMouse.value.copy(mousePrev.current);
    u.uTime.value = clock.elapsedTime;
    u.uActive.value = hasMoved.current ? 1 : 0;

    // Render stamp pass to FBO
    gl.setRenderTarget(wr);
    gl.render(offScene, offCam);
    gl.setRenderTarget(null);

    // Feed the display quad
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

export default function BrushstrokeRelief() {
  return (
    <div className="brushstroke-canvas">
      <Canvas
        gl={{ alpha: true, antialias: false }}
        camera={{ position: [0, 0, 1] }}
        style={{ background: "transparent" }}
      >
        <PaintScene />
      </Canvas>
    </div>
  );
}
