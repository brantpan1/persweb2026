"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Lenis from "lenis";
import Navigation from "@/components/Navigation";
import Text3D from "@/components/Text3D";
import BrushstrokeRelief from "@/components/BrushstrokeRelief";

/* ─── Phases ───
   intro     → brush strokes draw 潘 on screen (IS the loading animation)
   revealing → page content fades in
   done      → fully interactive
*/
type Phase = "intro" | "revealing" | "done";
const REVEAL_MS = 1000;

export default function Home() {
  const [phase, setPhase] = useState<Phase>("intro");

  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    });

    function raf(time: number) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }

    requestAnimationFrame(raf);
    return () => lenis.destroy();
  }, []);

  // Revealing → Done after CSS transition
  useEffect(() => {
    if (phase !== "revealing") return;
    const t = setTimeout(() => setPhase("done"), REVEAL_MS + 100);
    return () => clearTimeout(t);
  }, [phase]);

  const onCanvasReady = useCallback(() => {
    // Canvas ready — intro strokes are already drawing
  }, []);

  const onIntroDone = useCallback(() => {
    setPhase("revealing");
  }, []);

  const textLines = [
    { text: "Brant Pan", className: "display" },
    { text: "Creative Developer / Designer", className: "subtitle-large" },
    { text: "Boston, MA", className: "label" },
  ];

  const contentVisible = phase === "revealing" || phase === "done";

  return (
    <main className="page home-page home-centered">
      {/* Nav + text fade in after intro */}
      <div
        className="intro-content-wrapper"
        style={{
          opacity: contentVisible ? 1 : 0,
          transition: contentVisible ? `opacity ${REVEAL_MS}ms ease` : "none",
        }}
      >
        <Navigation />
      </div>

      <section className="hero hero-3d">
        {/* Brush strokes draw 潘 as the loading/intro animation */}
        <BrushstrokeRelief
          onReady={onCanvasReady}
          introActive={phase === "intro"}
          onIntroDone={onIntroDone}
        />

        {/* Text fades in after intro */}
        <div
          className="intro-content-wrapper"
          style={{
            opacity: contentVisible ? 1 : 0,
            transition: contentVisible ? `opacity ${REVEAL_MS}ms ease` : "none",
          }}
        >
          <Text3D lines={textLines} className="hero-text-3d" />
        </div>
      </section>
    </main>
  );
}
