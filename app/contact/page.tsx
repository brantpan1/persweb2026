"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import Navigation from "@/components/Navigation";
import TextReveal from "@/components/TextReveal";

export default function Contact() {
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
    <main className="page contact-page">
      <Navigation />

      <section className="page-header">
        <span className="label">
          <TextReveal delay={0.3} duration={0.6}>
            Contact
          </TextReveal>
        </span>
        <h1 className="heading-1">
          <TextReveal delay={0.5} duration={1}>
            Get in touch
          </TextReveal>
        </h1>
      </section>

      <section className="contact-content">
        <a href="mailto:brant.pan3@gmail.com" className="contact-email display-small">
          <TextReveal delay={0.8} duration={1}>
            brant.pan3@gmail.com
          </TextReveal>
        </a>

        <div className="contact-links">
          <a
            href="https://github.com/brantpan1"
            target="_blank"
            rel="noopener noreferrer"
            className="contact-link body"
          >
            Github
          </a>
        </div>

        <div className="contact-footer">
          <span className="label">Boston, MA</span>
        </div>
      </section>
    </main>
  );
}
