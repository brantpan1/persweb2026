"use client";

import { useRef, useEffect, useState, ReactNode } from "react";
import { usePresence } from "framer-motion";

/* ─────────────────────────────────────────────────────────
   Module-level mouse tracking
   Continuous mousemove stores normalized position.
   When exit starts, captured into transitionOrigin.
   Both exit and enter share the same origin.
   ───────────────────────────────────────────────────────── */

let mouseX = 0.5;
let mouseY = 0.5;
let transitionOrigin = { x: 0.5, y: 0.5 };
let listenerAttached = false;

function ensureMouseListener() {
  if (listenerAttached || typeof window === "undefined") return;
  listenerAttached = true;
  window.addEventListener("mousemove", (e) => {
    mouseX = e.clientX / window.innerWidth;
    mouseY = e.clientY / window.innerHeight;
  });
}

/* ─── Easing ─── */
const easeOutQuart = (t: number) => 1 - (1 - t) ** 4;
const easeInQuart = (t: number) => t ** 4;

/* ─────────────────────────────────────────────────────────
   Shaders — domain-warped FBM distance field with
   brushstroke relief texture
   ───────────────────────────────────────────────────────── */

const VERT = /* glsl */ `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
#extension GL_OES_standard_derivatives : enable
precision highp float;

uniform float uProgress;
uniform vec2  uOrigin;
uniform vec2  uResolution;

/* ── noise primitives ── */

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.0 + vec2(100.0);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float aspect = uResolution.x / uResolution.y;

  /* ── Two-layer domain warp for organic tendrils ── */
  vec2 q = vec2(
    fbm(uv * 3.0),
    fbm(uv * 3.0 + vec2(5.2, 1.3))
  );
  vec2 r = vec2(
    fbm(uv * 3.0 + q * 4.0 + vec2(1.7, 9.2)),
    fbm(uv * 3.0 + q * 4.0 + vec2(8.3, 2.8))
  );

  /* Warp UV before distance calculation */
  vec2 warpedUV = uv + (r - 0.5) * 0.18;
  vec2 delta = warpedUV - uOrigin;
  delta.x *= aspect;
  float dist = length(delta);

  /* ── Multi-scale boundary noise ── */
  float nL = (fbm(uv * 2.5  + vec2(3.14, 1.59)) - 0.5) * 0.35;
  float nM = (fbm(uv * 6.0  + vec2(7.7,  2.1 )) - 0.5) * 0.15;
  float nS = (fbm(uv * 14.0 + vec2(1.23, 8.4 )) - 0.5) * 0.06;

  /* Distance threshold driven by progress */
  float threshold = uProgress * 1.8;
  float edge = dist - threshold + nL + nM + nS;
  float ink = smoothstep(0.012, -0.012, edge);

  if (ink < 0.001) discard;

  /* ── Brushstroke relief: anisotropic FBM bump ── */
  float bump = fbm(uv * vec2(35.0, 12.0) + vec2(7.0, 3.0)) * ink;

  /* Screen-space normals via dFdx/dFdy */
  vec3 N = normalize(vec3(-dFdx(bump) * 300.0, -dFdy(bump) * 300.0, 1.0));

  /* Diffuse + specular (matching BrushstrokeRelief light direction) */
  vec3 L = normalize(vec3(0.4, 0.6, 1.0));
  float diff = dot(N, L) * 0.5 + 0.5;
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(N, H), 0.0), 25.0) * 0.5;

  float shade = 0.02 + 0.10 * diff + spec;

  gl_FragColor = vec4(vec3(shade), ink);
}
`;

/* ─── WebGL helpers ─── */

function compile(
  gl: WebGLRenderingContext,
  src: string,
  type: number,
): WebGLShader | null {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function linkProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const vs = compile(gl, VERT, gl.VERTEX_SHADER);
  const fs = compile(gl, FRAG, gl.FRAGMENT_SHADER);
  if (!vs || !fs) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(p));
    gl.deleteProgram(p);
    return null;
  }
  return p;
}

/* ─────────────────────────────────────────────────────────
   Component
   ───────────────────────────────────────────────────────── */

interface PageTransitionProps {
  children: ReactNode;
}

interface GLState {
  gl: WebGLRenderingContext | null;
  prog: WebGLProgram | null;
  buf: WebGLBuffer | null;
  loc: Record<string, WebGLUniformLocation | null>;
  raf: number;
  progress: number;
  start: number;
  phase: "reveal" | "idle" | "flood";
  ox: number;
  oy: number;
  glFailed: boolean;
}

export default function PageTransition({ children }: PageTransitionProps) {
  const [isPresent, safeToRemove] = usePresence();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const safeRef = useRef(safeToRemove);
  safeRef.current = safeToRemove;

  const [contentVisible, setContentVisible] = useState(false);

  const st = useRef<GLState>({
    gl: null,
    prog: null,
    buf: null,
    loc: {},
    raf: 0,
    progress: 1,
    start: 0,
    phase: "reveal",
    ox: transitionOrigin.x,
    oy: transitionOrigin.y,
    glFailed: false,
  });

  /* ─── Render loop (only runs during transitions) ─── */

  function tick() {
    const s = st.current;
    cancelAnimationFrame(s.raf);

    const loop = () => {
      const { gl, loc, phase } = s;
      if (!gl || phase === "idle") return;

      const elapsed = performance.now() - s.start;
      const duration = phase === "reveal" ? 1200 : 1400;
      const t = Math.min(elapsed / duration, 1);

      if (phase === "reveal") {
        s.progress = 1 - easeInQuart(t);
        if (t >= 1) {
          s.phase = "idle";
          s.progress = 0;
          gl.clear(gl.COLOR_BUFFER_BIT);
          return;
        }
      } else {
        s.progress = easeOutQuart(t);
        if (t >= 1) {
          s.phase = "idle";
          s.progress = 1;
          safeRef.current?.();
          return;
        }
      }

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform1f(loc.uProgress, s.progress);
      gl.uniform2f(loc.uOrigin, s.ox, 1 - s.oy);
      gl.uniform2f(
        loc.uResolution,
        gl.drawingBufferWidth,
        gl.drawingBufferHeight,
      );
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      s.raf = requestAnimationFrame(loop);
    };

    s.raf = requestAnimationFrame(loop);
  }

  /* ─── Mouse listener ─── */
  useEffect(() => {
    ensureMouseListener();
  }, []);

  /* ─── Content fade-in (delayed so ink clears first) ─── */
  useEffect(() => {
    if (st.current.glFailed) {
      setContentVisible(true);
      return;
    }
    const id = setTimeout(() => setContentVisible(true), 300);
    return () => clearTimeout(id);
  }, []);

  /* ─── Content fade-out on exit ─── */
  useEffect(() => {
    if (!isPresent) setContentVisible(false);
  }, [isPresent]);

  /* ─── WebGL init / teardown ─── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
    });

    if (!gl) {
      st.current.glFailed = true;
      st.current.phase = "idle";
      setContentVisible(true);
      return;
    }

    gl.getExtension("OES_standard_derivatives");

    const prog = linkProgram(gl);
    if (!prog) {
      st.current.glFailed = true;
      st.current.phase = "idle";
      setContentVisible(true);
      return;
    }

    /* Fullscreen quad */
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    /* Uniforms */
    const loc = {
      uProgress: gl.getUniformLocation(prog, "uProgress"),
      uOrigin: gl.getUniformLocation(prog, "uOrigin"),
      uResolution: gl.getUniformLocation(prog, "uResolution"),
    };

    gl.useProgram(prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const s = st.current;
    s.gl = gl;
    s.prog = prog;
    s.buf = buf;
    s.loc = loc;

    /* DPR-capped resize via ResizeObserver */
    const resize = () => {
      const dpr = Math.min(devicePixelRatio, 2);
      const w = (canvas.clientWidth * dpr) | 0;
      const h = (canvas.clientHeight * dpr) | 0;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    /* Start reveal animation */
    s.phase = "reveal";
    s.progress = 1;
    s.start = performance.now();
    s.ox = transitionOrigin.x;
    s.oy = transitionOrigin.y;
    tick();

    return () => {
      ro.disconnect();
      cancelAnimationFrame(s.raf);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      s.gl = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── Exit trigger: capture origin → start flood ─── */
  useEffect(() => {
    if (isPresent) return;
    const s = st.current;

    if (s.glFailed) {
      safeRef.current?.();
      return;
    }

    /* Capture mouse position as transition origin */
    transitionOrigin.x = mouseX;
    transitionOrigin.y = mouseY;
    s.ox = mouseX;
    s.oy = mouseY;

    s.phase = "flood";
    s.progress = 0;
    s.start = performance.now();
    tick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPresent]);

  return (
    <>
      <div
        className="page-content"
        style={{
          opacity: contentVisible ? 1 : 0,
          transition: "opacity 0.4s ease",
        }}
      >
        {children}
      </div>
      <canvas
        ref={canvasRef}
        className="ink-transition-canvas"
        aria-hidden="true"
      />
    </>
  );
}
