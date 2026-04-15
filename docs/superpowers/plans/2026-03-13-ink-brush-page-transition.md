# Ink Brush Page Transition Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the geometric curtain-wipe page transition with organic brush stroke wipes using CSS mask-image and GSAP.

**Architecture:** 5 full-viewport divs masked by brush stroke PNGs sweep left-to-right in staggered sequence, backed by a solid coverage layer. A GSAP timeline orchestrates the cover and fade-out reveal. The component API is unchanged — `template.tsx` still wraps children in `<PageTransition>`.

**Tech Stack:** React 19, GSAP, CSS mask-image, Next.js 16 App Router

**Spec:** `docs/superpowers/specs/2026-03-13-ink-brush-page-transition-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `app/globals.css` | Modify (lines 272-294) | Remove `.page-slide`/`.page-slide-2`, add `.brush-stroke`/`.brush-bg` |
| `components/PageTransition.tsx` | Rewrite | Render brush layers, GSAP timeline, randomization, reduced-motion |
| `app/layout.tsx` | Modify | Add preload links for brush PNGs |

---

## Chunk 1: CSS and Preloading

### Task 1: Update CSS — remove old transition styles, add new ones

**Files:**
- Modify: `app/globals.css:272-294`

- [ ] **Step 1: Remove old `.page-slide` and `.page-slide-2` styles**

Replace lines 272-294 in `app/globals.css`:

```css
/* ==================== */
/* PAGE TRANSITIONS     */
/* ==================== */

.page-content {
  min-height: 100vh;
}

.page-slide {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100vh;
  background: var(--fg);
  z-index: 1000;
  pointer-events: none;
}

.page-slide-2 {
  background: var(--gray);
  z-index: 999;
}
```

With:

```css
/* ==================== */
/* PAGE TRANSITIONS     */
/* ==================== */

.page-content {
  min-height: 100vh;
}

.brush-bg {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100vh;
  background: var(--fg);
  z-index: 999;
  pointer-events: none;
}

.brush-stroke {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100vh;
  background: var(--fg);
  z-index: 1000;
  pointer-events: none;
  mask-size: cover;
  mask-repeat: no-repeat;
  mask-position: center;
  -webkit-mask-size: cover;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: center;
}
```

- [ ] **Step 2: Verify CSS parses correctly**

Run: `pnpm build`
Expected: Build succeeds with no CSS errors.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "style: replace page-slide with brush-stroke transition classes"
```

### Task 2: Add brush PNG preload links to layout

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Add preload links in the `<head>`**

Update `app/layout.tsx` to:

```tsx
import type { Metadata } from "next";
import "./globals.css";

const BRUSH_IDS = [1, 2, 7, 8, 9, 10];

export const metadata: Metadata = {
  title: "Tianshi Pan",
  description: "Creative Developer & Designer",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {BRUSH_IDS.map((id) => (
          <link
            key={id}
            rel="preload"
            as="image"
            href={`/brushes/${id}.png`}
          />
        ))}
      </head>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: Build succeeds. Preload links appear in page source.

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "perf: preload brush stroke PNGs for page transitions"
```

---

## Chunk 2: Rewrite PageTransition Component

### Task 3: Rewrite PageTransition with brush stroke layers and GSAP timeline

**Files:**
- Rewrite: `components/PageTransition.tsx`

- [ ] **Step 1: Write the new PageTransition component**

Replace entire contents of `components/PageTransition.tsx` with:

```tsx
"use client";

import { useRef, useEffect, useMemo, ReactNode } from "react";
import gsap from "gsap";

const BRUSH_IDS = [1, 2, 7, 8, 9, 10];
const STROKE_COUNT = 5;
const MASK_POSITIONS = ["center", "top", "bottom"] as const;

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

interface PageTransitionProps {
  children: ReactNode;
}

export default function PageTransition({ children }: PageTransitionProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const strokeRefs = useRef<(HTMLDivElement | null)[]>([]);

  const brushConfig = useMemo(() => {
    const selected = pickRandom(BRUSH_IDS, STROKE_COUNT);
    return selected.map((id) => ({
      id,
      maskPosition: MASK_POSITIONS[Math.floor(Math.random() * MASK_POSITIONS.length)],
      yOffset: (Math.random() - 0.5) * 10, // ±5%
    }));
  }, []);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const tl = gsap.timeline();

    if (prefersReducedMotion) {
      // Simple crossfade for reduced motion
      gsap.set(bgRef.current, { opacity: 0 });
      strokeRefs.current.forEach((el) => {
        if (el) gsap.set(el, { opacity: 0 });
      });
      tl.fromTo(
        contentRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.3, ease: "power2.out" }
      );
    } else {
      // Phase 1: Brush strokes sweep in to cover (left to right)
      strokeRefs.current.forEach((el, i) => {
        if (!el) return;
        tl.fromTo(
          el,
          { x: "-120%" },
          {
            x: "0%",
            duration: 0.8,
            ease: "power3.inOut",
          },
          i * 0.12
        );
      });

      // Phase 2: Hold briefly, then fade everything out to reveal content
      const fadeStart = STROKE_COUNT * 0.12 + 0.8 + 0.1; // after last stroke settles + hold

      // Fade out background layer
      tl.to(bgRef.current, {
        opacity: 0,
        duration: 0.5,
        ease: "power2.out",
      }, fadeStart);

      // Fade out all brush strokes together
      strokeRefs.current.forEach((el) => {
        if (!el) return;
        tl.to(
          el,
          {
            opacity: 0,
            duration: 0.5,
            ease: "power2.out",
          },
          fadeStart
        );
      });

      // Fade in content
      tl.fromTo(
        contentRef.current,
        { opacity: 0 },
        { opacity: 1, duration: 0.5, ease: "power2.out" },
        fadeStart
      );
    }

    return () => {
      tl.kill();
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
            maskImage: `url(/brushes/${config.id}.png)`,
            WebkitMaskImage: `url(/brushes/${config.id}.png)`,
            maskPosition: config.maskPosition,
            WebkitMaskPosition: config.maskPosition,
            transform: `translateX(-120%) translateY(${config.yOffset}%)`,
          }}
        />
      ))}
    </>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: Build succeeds with no TypeScript errors.

- [ ] **Step 3: Visual test in dev mode**

Run: `pnpm dev`

1. Open http://localhost:3000
2. Navigate between pages (Home, Work, About, Contact)
3. Verify: brush strokes sweep in from left, cover screen, then fade out to reveal new page
4. Verify: each transition uses different random brush combinations
5. Verify: no content bleeds through during cover phase (solid bg layer works)

- [ ] **Step 4: Test reduced motion**

In browser DevTools, enable "Prefers reduced motion" (Rendering tab).
Navigate between pages.
Expected: Simple crossfade, no brush stroke animation.

- [ ] **Step 5: Commit**

```bash
git add components/PageTransition.tsx
git commit -m "feat: organic ink brush stroke page transitions

Replace geometric curtain wipe with randomized brush stroke masks
that sweep left-to-right and fade to reveal content."
```
