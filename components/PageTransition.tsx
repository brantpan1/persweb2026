"use client";

import { useRef, useEffect, ReactNode } from "react";
import gsap from "gsap";
import { BRUSH_IDS } from "@/lib/constants";

const STROKE_COUNT = 5;
const MASK_POSITIONS = ["center", "top", "bottom"] as const;

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function buildMask(brushId: number, revealPercent: number) {
  // Composite mask: brush PNG provides shape, gradient provides progressive reveal.
  // The gradient goes from opaque (revealed) to transparent (hidden), sweeping left to right.
  // mask-composite: intersect means only where BOTH masks are opaque does the element show.
  const gradient = `linear-gradient(to right, black ${revealPercent}%, transparent ${revealPercent + 15}%)`;
  const brush = `url(/brushes/${brushId}.png)`;
  return {
    maskImage: `${gradient}, ${brush}`,
    WebkitMaskImage: `${gradient}, ${brush}`,
    maskComposite: "intersect" as const,
    WebkitMaskComposite: "source-in" as const,
  };
}

interface PageTransitionProps {
  children: ReactNode;
}

export default function PageTransition({ children }: PageTransitionProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const strokeRefs = useRef<(HTMLDivElement | null)[]>([]);
  const revealValues = useRef<{ value: number }[]>(
    Array.from({ length: STROKE_COUNT }, () => ({ value: 0 }))
  );

  const brushConfigRef = useRef<{ id: number; maskPosition: string; yOffset: number }[] | null>(null);
  if (!brushConfigRef.current) {
    brushConfigRef.current = pickRandom(BRUSH_IDS, STROKE_COUNT).map((id) => ({
      id,
      maskPosition: MASK_POSITIONS[Math.floor(Math.random() * MASK_POSITIONS.length)],
      yOffset: (Math.random() - 0.5) * 10,
    }));
  }
  const brushConfig = brushConfigRef.current;

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const tl = gsap.timeline();

    if (prefersReducedMotion) {
      tl.set(bgRef.current, { opacity: 0 });
      strokeRefs.current.forEach((el) => {
        if (el) tl.set(el, { opacity: 0 });
      });
      tl.fromTo(
        contentRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.3, ease: "power2.out" }
      );
    } else {
      // Phase 1: Draw each brush stroke progressively (left to right)
      revealValues.current.forEach((rv, i) => {
        const el = strokeRefs.current[i];
        if (!el) return;
        const config = brushConfig[i];

        rv.value = 0;
        tl.to(
          rv,
          {
            value: 110,
            duration: 1.4,
            ease: "power2.inOut",
            onUpdate: () => {
              const masks = buildMask(config.id, rv.value);
              el.style.maskImage = masks.maskImage;
              (el.style as CSSStyleDeclaration & { WebkitMaskImage: string }).WebkitMaskImage = masks.WebkitMaskImage;
            },
          },
          i * 0.25
        );
      });

      // Phase 2: Hold, then fade everything out to reveal content
      const fadeStart = STROKE_COUNT * 0.25 + 1.4 + 0.2;

      tl.to(bgRef.current, {
        opacity: 0,
        duration: 0.8,
        ease: "power2.out",
      }, fadeStart);

      strokeRefs.current.forEach((el) => {
        if (!el) return;
        tl.to(
          el,
          {
            opacity: 0,
            duration: 0.8,
            ease: "power2.out",
          },
          fadeStart
        );
      });

      tl.fromTo(
        contentRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.8, ease: "power2.out" },
        fadeStart
      );
    }

    return () => {
      tl.kill();
      if (contentRef.current) gsap.set(contentRef.current, { opacity: 1 });
    };
  }, []);

  return (
    <>
      <div ref={contentRef} className="page-content" style={{ opacity: 0 }}>
        {children}
      </div>
      <div ref={bgRef} className="brush-bg" />
      {brushConfig.map((config, i) => (
        <div
          key={i}
          ref={(el) => { strokeRefs.current[i] = el; }}
          className="brush-stroke"
          style={{
            ...buildMask(config.id, 0),
            maskPosition: config.maskPosition,
            WebkitMaskPosition: config.maskPosition,
            maskSize: "cover",
            WebkitMaskSize: "cover",
            transform: `translateY(${config.yOffset}%)`,
          }}
        />
      ))}
    </>
  );
}
