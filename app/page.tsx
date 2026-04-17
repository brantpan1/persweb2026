"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import Navigation from "@/components/Navigation";
import Text3D from "@/components/Text3D";
import { useTransition } from "@/components/TransitionProvider";

export default function Home() {
  const { titlesVisible } = useTransition();

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

  const textLines = [
    { text: "Brant Pan", className: "display" },
    { text: "Creative Developer / Designer", className: "subtitle-large" },
    { text: "Boston, MA", className: "label" },
  ];

  return (
    <main className="page home-page home-centered">
      <div
        className={`intro-content-wrapper ${titlesVisible ? "is-revealed" : ""}`}
      >
        <Navigation />
      </div>

      <section className="hero hero-3d">
        <div
          className={`intro-content-wrapper ${titlesVisible ? "is-revealed" : ""}`}
        >
          <Text3D lines={textLines} className="hero-text-3d" />
        </div>
      </section>
    </main>
  );
}
