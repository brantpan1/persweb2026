"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import BrushstrokeRelief from "@/components/BrushstrokeRelief";

const TRANSLATIONS: Record<string, string> = {
  "/": "家",
  "/work": "作",
  "/about": "我",
  "/contact": "信",
};

type TransitionPhase = "idle" | "exiting" | "entering";

interface TransitionContextValue {
  phase: TransitionPhase;
  navigate: (href: string) => void;
  drawCharacter: (char: string) => Promise<void>;
  brushReady: boolean;
  /** Whether HTML text content (page titles, home text) should be visible.
   *  False during the entire intro/transition drawing sequence; true once
   *  the brush morph completes and the ink is decaying away. */
  titlesVisible: boolean;
}

const TransitionContext = createContext<TransitionContextValue>({
  phase: "idle",
  navigate: () => {},
  drawCharacter: async () => {},
  brushReady: false,
  titlesVisible: false,
});

export function useTransition() {
  return useContext(TransitionContext);
}

const FADE_MS = 600;

export function TransitionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [phase, setPhase] = useState<TransitionPhase>("idle");
  const [drawChar, setDrawChar] = useState<string | null>(null);
  const [brushReady, setBrushReady] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [titlesVisible, setTitlesVisible] = useState(false);
  const [maskKey, setMaskKey] = useState<string>(pathname);

  const drawResolveRef = useRef<(() => void) | null>(null);
  const navigatingRef = useRef(false);
  const introStartedRef = useRef(false);

  const drawCharacter = useCallback((char: string) => {
    return new Promise<void>((resolve) => {
      if (drawResolveRef.current) {
        resolve();
        return;
      }
      drawResolveRef.current = resolve;
      setDrawChar(char);
    });
  }, []);

  const handleDrawComplete = useCallback(() => {
    const r = drawResolveRef.current;
    drawResolveRef.current = null;
    setDrawChar(null);
    r?.();
  }, []);

  // Intro flow — runs once. On home page, plays 潘 + morph then reveals text.
  // On other pages, reveals text immediately (no intro).
  useEffect(() => {
    if (introStartedRef.current) return;
    if (pathname !== "/") {
      introStartedRef.current = true;
      setMaskKey(pathname);
      setTitlesVisible(true);
      return;
    }
    if (!brushReady) return;
    introStartedRef.current = true;
    setMaskKey("/");
    (async () => {
      await drawCharacter("潘");
      await drawCharacter("__intro_morph__");
      setTitlesVisible(true);
    })();
  }, [brushReady, pathname, drawCharacter]);

  const navigate = useCallback(
    async (href: string) => {
      if (href === pathname || navigatingRef.current) return;
      const ch = TRANSLATIONS[href] ?? "";
      if (!ch) {
        router.push(href);
        return;
      }
      navigatingRef.current = true;

      try {
        // Wait if canvas is busy
        let waited = 0;
        while (drawResolveRef.current && waited < 300) {
          await new Promise<void>((r) =>
            requestAnimationFrame(() => r()),
          );
          waited++;
        }

        // Hide ALL HTML content for the entire transition. Only the brush
        // is visible during drawing.
        setTitlesVisible(false);

        // Phase 1: brush starts drawing destination character on top.
        setPhase("exiting");
        setPageVisible(false);
        const drawPromise = drawCharacter(ch);
        // Brief wait so the hide-content CSS settles before route swap.
        await new Promise((r) => setTimeout(r, FADE_MS));

        // Phase 2: swap routes. New page mounts (also hidden by class).
        router.push(href);
        // Wait for the new page tree to commit so DOM query finds the
        // new page's title element.
        await new Promise((r) => setTimeout(r, 80));

        // Phase 3: regenerate text mask using the NEW page's actual title
        // position from the DOM. Mask must be correct before morph runs.
        setMaskKey(href);
        await new Promise<void>((r) =>
          requestAnimationFrame(() => r()),
        );

        setPhase("entering");
        setPageVisible(true);
        await drawPromise;

        // Phase 4: brush morphs into the destination title (mask is correct).
        const morphChar =
          href === "/" ? "__intro_morph__" : "__page_morph__";
        await drawCharacter(morphChar);

        // All drawing done — HTML content fades in.
        setTitlesVisible(true);
      } finally {
        navigatingRef.current = false;
        setPhase("idle");
      }
    },
    [pathname, router, drawCharacter],
  );

  return (
    <TransitionContext.Provider
      value={{ phase, navigate, drawCharacter, brushReady, titlesVisible }}
    >
      <div
        className={`page-fade-wrapper ${
          titlesVisible ? "" : "brush-forming-title"
        }`}
        style={{
          opacity: pageVisible ? 1 : 0,
          transition: `opacity ${FADE_MS}ms cubic-bezier(0.6, 0, 0.2, 1)`,
        }}
      >
        {children}
      </div>
      <BrushstrokeRelief
        onReady={() => setBrushReady(true)}
        drawChar={drawChar}
        onDrawComplete={handleDrawComplete}
        textMaskKey={maskKey}
      />
    </TransitionContext.Provider>
  );
}
