"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import Navigation from "@/components/Navigation";

const projects = [
  { name: "GovChat", type: "Web + Motion", year: "2024" },
  { name: "Spesland", type: "Web + UX", year: "2024" },
  { name: "MFA Proposal", type: "Experience Design", year: "2023" },
];

export default function Work() {
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
    <main className="page work-page">
      <Navigation />

      <header className="page-header">
        <div className="page-header-meta">
          <span className="running-head">Work — Index</span>
          <span className="running-head">
            {String(projects.length).padStart(2, "0")} Projects · 2023—2026
          </span>
        </div>
        <h1 className="page-header-title">Selected Work</h1>
      </header>

      <section className="work-table">
        <div className="work-table-head">
          <span>№</span>
          <span>Name</span>
          <span>Type</span>
          <span className="col-year-head">Year</span>
        </div>
        {projects.map((project, i) => (
          <a
            key={project.name}
            href="#"
            className="work-table-row is-link"
          >
            <span className="col-num">{String(i + 1).padStart(2, "0")}</span>
            <span className="col-name">{project.name}</span>
            <span className="col-type">{project.type}</span>
            <span className="col-year">{project.year}</span>
          </a>
        ))}
      </section>
    </main>
  );
}
