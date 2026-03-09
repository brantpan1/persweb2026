"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import Navigation from "@/components/Navigation";
import TextReveal from "@/components/TextReveal";

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

      <section className="page-header">
        <span className="label">
          <TextReveal delay={0.3} duration={0.6}>
            Selected Work
          </TextReveal>
        </span>
        <h1 className="heading-1">
          <TextReveal delay={0.5} duration={1}>
            Projects
          </TextReveal>
        </h1>
      </section>

      <section className="work-list">
        {projects.map((project, i) => (
          <a key={project.name} href="#" className="work-item">
            <div className="work-item-left">
              <span className="work-index body-small">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h2 className="heading-2">
                <TextReveal delay={0.6 + i * 0.1} duration={0.8}>
                  {project.name}
                </TextReveal>
              </h2>
            </div>
            <div className="work-item-right">
              <span className="body-small">{project.type}</span>
              <span className="body-small">{project.year}</span>
            </div>
          </a>
        ))}
      </section>
    </main>
  );
}
