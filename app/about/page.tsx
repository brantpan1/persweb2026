"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import Navigation from "@/components/Navigation";
import TextReveal from "@/components/TextReveal";

export default function About() {
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

  return (
    <main className="page about-page">
      <Navigation />

      <section className="page-header">
        <span className="label">
          <TextReveal delay={0.3} duration={0.6}>
            About
          </TextReveal>
        </span>
        <h1 className="heading-1">
          <TextReveal delay={0.5} duration={1}>
            Background
          </TextReveal>
        </h1>
      </section>

      <section className="about-content">
        <div className="about-grid">
          <div className="about-col">
            <p className="body">
              <TextReveal delay={0.7} duration={0.8}>
                I design and build websites that feel intentional.
              </TextReveal>
            </p>
            <p className="body">
              <TextReveal delay={0.9} duration={0.8}>
                Currently studying Computer Science and Design at Northeastern University.
              </TextReveal>
            </p>
          </div>
          <div className="about-col">
            <p className="body">
              <TextReveal delay={1.1} duration={0.8}>
                Previously at Priceline and MORSE, working on interfaces that bridge function and feeling.
              </TextReveal>
            </p>
          </div>
        </div>

        <div className="about-timeline">
          <div className="timeline-item">
            <span className="label">2022</span>
            <span className="body-small">Started at Northeastern</span>
          </div>
          <div className="timeline-divider"></div>
          <div className="timeline-item">
            <span className="label">2024</span>
            <span className="body-small">MORSE, Priceline</span>
          </div>
          <div className="timeline-divider"></div>
          <div className="timeline-item">
            <span className="label">Now</span>
            <span className="body-small">Freelance</span>
          </div>
        </div>
      </section>
    </main>
  );
}
