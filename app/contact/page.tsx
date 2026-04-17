"use client";

import { useEffect } from "react";
import Lenis from "lenis";
import Navigation from "@/components/Navigation";

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

      <header className="page-header">
        <div className="page-header-meta">
          <span className="running-head">Contact</span>
          <span className="running-head">Boston, MA · Available 2026</span>
        </div>
        <h1 className="page-header-title">Hello</h1>
      </header>

      <section className="contact-rows">
        <a
          href="mailto:brant.pan3@gmail.com"
          className="contact-row is-primary"
        >
          <span className="label">Email</span>
          <span className="value">brant.pan3@gmail.com</span>
        </a>

        <a
          href="https://github.com/brantpan1"
          target="_blank"
          rel="noopener noreferrer"
          className="contact-row"
        >
          <span className="label">Build</span>
          <span className="value external-link">Github · brantpan1</span>
        </a>

        <a
          href="https://www.linkedin.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="contact-row"
        >
          <span className="label">Connect</span>
          <span className="value external-link">LinkedIn</span>
        </a>

        <div className="contact-row">
          <span className="label">Read</span>
          <span className="value">Currently: Tschichold, Vignelli, Crouwel</span>
        </div>
      </section>
    </main>
  );
}
