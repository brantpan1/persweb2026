# Ink Brush Page Transition Design

## Overview

Replace the current geometric curtain-wipe page transition with organic brush stroke wipes using real brush texture PNGs as CSS masks, animated with GSAP.

## Problem

The current transition uses two solid `div` overlays (`page-slide`, `page-slide-2`) that scale down vertically. The noise/pattern approach creates visible repeating patterns rather than genuinely organic ink behavior.

## Solution

Use pre-made brush stroke PNGs (from the Brush Strokes Pack) as `mask-image` on full-viewport overlay divs. GSAP animates these masked layers sweeping left-to-right in a staggered sequence, then fading out to reveal the new page.

## Technical Approach

**CSS mask-image + GSAP.** Each brush stroke is a `div` with solid `var(--fg)` background, masked by a brush PNG. GSAP handles translateX animation for the sweep and opacity for the reveal. This leverages GPU-composited transforms and the existing GSAP dependency.

## Brush Assets

Selected brushes from the pack: **1, 2, 7, 8, 9, 10** (6 variations, chosen by visual review for horizontal sweep suitability). Stored at `public/brushes/{n}.png`. Per transition, 5 are randomly selected from this pool. The remaining brushes (3, 4, 5, 6) stay in the directory but are not used — they can be added later if more variety is needed.

## Preloading

Brush PNGs must be loaded before the first transition fires. Add `<link rel="preload" as="image">` tags in `app/layout.tsx` for all 6 brush PNGs to ensure they are cached on initial page load.

## Component Structure

`PageTransition` renders:
- Content wrapper (`div`, starts `opacity: 0`)
- 5 brush stroke overlay layers (full viewport, `position: fixed`, `z-index: 1000`, `pointer-events: none`)

A solid background layer (`.brush-bg`, same `var(--fg)` background, no mask, `z-index: 999`) sits behind all brush strokes to guarantee full coverage — brush edges have natural gaps, and the solid layer ensures no content bleeds through during the cover phase. It fades in before strokes arrive and fades out with them.

Each `.brush-stroke` layer:
- `background: var(--fg)`
- `mask-image: url(/brushes/{n}.png)` — randomly assigned per mount
- `mask-size: cover`, `mask-repeat: no-repeat`
- Starts at `translateX(-120%)` (extra 20% accounts for mask edges not reaching div boundaries)
- Needs `-webkit-mask-*` prefixes for Safari

## Animation Context

This component runs inside Next.js `template.tsx`, which remounts on every navigation. The animation is **reveal-only**: when the new page mounts, the brush overlays are already covering the viewport and then animate to reveal the content. Phase 1 (cover) happens instantly at mount time — the strokes sweep into position over what is effectively a blank page. Phase 2 (reveal) is the visible transition the user sees.

## Animation Sequence

### Phase 1 — Cover (~0.8s)
- Each stroke animates `translateX` from `-120%` to `0%` (left-to-right sweep)
- Staggered by ~0.12s each (strokes cascade in quick succession)
- Easing: `power3.inOut`
- Content fades out simultaneously
- Overlapping strokes with different brush shapes create full viewport coverage

### Phase 2 — Reveal (~0.5s)
- Brief hold (~0.1s) after strokes settle
- All 5 strokes fade `opacity: 1 → 0` together
- Easing: `power2.out` (soft dissolve)
- Content fades in simultaneously

Total duration: ~1.2s

### Randomization per transition
- Randomly pick 5 from the pool of 6 brushes
- Randomize `mask-position` slightly (`center`, `top`, `bottom`)
- Slight random `translateY` variation (±5%) for organic feel

## File Changes

### `components/PageTransition.tsx`
Rewrite component:
- Remove `slide1Ref` / `slide2Ref` refs
- Add array of 5 brush stroke refs
- On mount: randomly select brushes, assign mask-images, build GSAP timeline
- Timeline: staggered translateX cover → hold → opacity fade reveal

### `app/globals.css`
- Remove `.page-slide` and `.page-slide-2` classes
- Add `.brush-stroke` class with fixed positioning, mask properties, and webkit prefixes
- `.page-content` unchanged

### `public/brushes/`
Already in place. PNGs 1, 2, 7, 8, 9, 10.

### `app/layout.tsx`
- Add `<link rel="preload" as="image">` tags for the 6 brush PNGs

## Accessibility

Respect `prefers-reduced-motion: reduce`. When active, skip the brush stroke animation entirely and use a simple crossfade (opacity 0 → 1 over ~0.3s). Check via `window.matchMedia('(prefers-reduced-motion: reduce)')` before building the GSAP timeline.

## No Changes To

- `app/template.tsx` — component API unchanged
- `package.json` — no new dependencies
