"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import Navigation from "@/components/Navigation";

const timeline = [
  { year: "2022", event: "Started at Northeastern", context: "CS + Design" },
  { year: "2024", event: "MORSE", context: "Interface Design" },
  { year: "2024", event: "Priceline", context: "Frontend, Travel Search" },
  { year: "Now", event: "Independent", context: "Selected commissions" },
];

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

      <header className="page-header">
        <div className="page-header-meta">
          <span className="running-head">About</span>
          <span className="running-head">Brant Pan · Designer / Developer</span>
        </div>
        <h1 className="page-header-title">Background</h1>
      </header>

      <section className="about-bipartite">
        <aside className="about-meta">
          <div className="about-meta-row">
            <span className="label">Location</span>
            <span className="value">Boston, MA</span>
          </div>
          <div className="about-meta-row">
            <span className="label">Focus</span>
            <span className="value">Interface · Motion · Identity</span>
          </div>
          <div className="about-meta-row">
            <span className="label">Education</span>
            <span className="value">Northeastern University</span>
          </div>
          <div className="about-meta-row">
            <span className="label">Available</span>
            <span className="value">Selected commissions, 2026</span>
          </div>
        </aside>

        <div className="about-prose">
          <p>
            I design and build websites that feel intentional. The work
            sits between editorial typography and experimental motion —
            calligraphic where it can be, brutalist where it should be.
          </p>
          <p>
            Currently studying Computer Science and Design at Northeastern
            University. Previously at Priceline and MORSE, working on
            interfaces that bridge function and feeling.
          </p>
          <p>
            Outside the screen: Chinese brush calligraphy, long-form
            reading, and the slow craft of getting a single layout right.
          </p>
        </div>
      </section>

      <section className="about-timeline">
        <div className="about-timeline-head">
          <span>Year</span>
          <span>Event</span>
          <span>Context</span>
        </div>
        {timeline.map((row) => (
          <div key={`${row.year}-${row.event}`} className="about-timeline-row">
            <span className="col-year">{row.year}</span>
            <span>{row.event}</span>
            <span>{row.context}</span>
          </div>
        ))}
      </section>
    </main>
  );
}
