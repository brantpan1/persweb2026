"use client";

import { useRef, useEffect, useState, ReactNode } from "react";
import { usePresence } from "framer-motion";

/* ─────────────────────────────────────────────────────────
   WebGL chroma-key shader
   - Samples <video> as texture
   - Removes green (g − max(r, b)) → alpha
   - Object-fit: cover crop via UV scaling
   ───────────────────────────────────────────────────────── */

const VERT = /* glsl */ `
attribute vec2 aPos;
varying vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision mediump float;
varying vec2 vUV;
uniform sampler2D uTex;
uniform vec2 uVideoSize;
uniform vec2 uCanvasSize;

void main() {
  float ca = uCanvasSize.x / uCanvasSize.y;
  float va = uVideoSize.x / uVideoSize.y;
  vec2 uv = vUV;
  if (ca > va) {
    float s = va / ca;
    uv.y = (uv.y - 0.5) * s + 0.5;
  } else {
    float s = ca / va;
    uv.x = (uv.x - 0.5) * s + 0.5;
  }
  uv.y = 1.0 - uv.y;

  vec4 c = texture2D(uTex, uv);
  float g = c.g - max(c.r, c.b);
  float a = 1.0 - smoothstep(0.05, 0.25, g);
  gl_FragColor = vec4(c.rgb * a, a);
}
`;

function compile(gl: WebGLRenderingContext, src: string, type: number) {
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

function linkProgram(gl: WebGLRenderingContext) {
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
    return null;
  }
  return p;
}

/* ─── Timings ─── */
const EXIT_VIDEO_MS = 900;   // ink spreading
const BLACKOUT_MS = 220;     // solid black cover
const ENTER_MS = 500;        // fade from black into new page

export default function InkTransition({ children }: { children: ReactNode }) {
  const [isPresent, safeToRemove] = usePresence();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [overlayAlpha, setOverlayAlpha] = useState(1);
  const safeRef = useRef(safeToRemove);
  safeRef.current = safeToRemove;

  /* ─── Enter: fade overlay 1 → 0 on mount ─── */
  useEffect(() => {
    const id = requestAnimationFrame(() => setOverlayAlpha(0));
    return () => cancelAnimationFrame(id);
  }, []);

  /* ─── Exit: play video, chroma-key to canvas, then fade to solid black ─── */
  useEffect(() => {
    if (isPresent) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) {
      safeRef.current?.();
      return;
    }

    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: true,
    });
    if (!gl) {
      setOverlayAlpha(1);
      const t = setTimeout(() => safeRef.current?.(), BLACKOUT_MS);
      return () => clearTimeout(t);
    }

    const prog = linkProgram(gl);
    if (!prog) {
      setOverlayAlpha(1);
      const t = setTimeout(() => safeRef.current?.(), BLACKOUT_MS);
      return () => clearTimeout(t);
    }

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

    const loc = {
      uTex: gl.getUniformLocation(prog, "uTex"),
      uVideoSize: gl.getUniformLocation(prog, "uVideoSize"),
      uCanvasSize: gl.getUniformLocation(prog, "uCanvasSize"),
    };

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.useProgram(prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const resize = () => {
      const dpr = Math.min(devicePixelRatio, 2);
      const w = (window.innerWidth * dpr) | 0;
      const h = (window.innerHeight * dpr) | 0;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };
    resize();
    window.addEventListener("resize", resize);

    let raf = 0;
    let blackoutStart = 0;
    const startTime = performance.now();

    const draw = () => {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          video,
        );
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform1i(loc.uTex, 0);
        gl.uniform2f(loc.uVideoSize, video.videoWidth, video.videoHeight);
        gl.uniform2f(loc.uCanvasSize, canvas.width, canvas.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }

      const elapsed = performance.now() - startTime;
      if (elapsed > EXIT_VIDEO_MS && blackoutStart === 0) {
        blackoutStart = performance.now();
        setOverlayAlpha(1);
      }
      if (blackoutStart && performance.now() - blackoutStart > BLACKOUT_MS) {
        safeRef.current?.();
        return;
      }
      raf = requestAnimationFrame(draw);
    };

    video.currentTime = 0;
    video.play().catch(() => {});
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      gl.deleteBuffer(buf);
      gl.deleteTexture(tex);
      gl.deleteProgram(prog);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [isPresent]);

  return (
    <>
      {children}

      {!isPresent && (
        <>
          <video
            ref={videoRef}
            src="/ink-transition.mp4"
            muted
            playsInline
            preload="auto"
            aria-hidden
            style={{ display: "none" }}
          />
          <canvas
            ref={canvasRef}
            className="ink-transition-canvas"
            aria-hidden="true"
          />
        </>
      )}

      <div
        className="ink-transition-overlay"
        aria-hidden="true"
        style={{
          opacity: overlayAlpha,
          transition: `opacity ${isPresent ? ENTER_MS : BLACKOUT_MS}ms ease`,
        }}
      />
    </>
  );
}
