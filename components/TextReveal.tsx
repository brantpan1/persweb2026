"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";

interface TextRevealProps {
  children: string;
  className?: string;
  delay?: number;
  duration?: number;
  stagger?: number;
  as?: "h1" | "h2" | "h3" | "p" | "span";
}

export default function TextReveal({
  children,
  className = "",
  delay = 0,
  duration = 1,
  stagger = 0.03,
  as: Component = "span",
}: TextRevealProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chars = container.querySelectorAll(".char");

    gsap.set(chars, { yPercent: 100 });

    gsap.to(chars, {
      yPercent: 0,
      duration,
      stagger,
      delay,
      ease: "power3.out",
    });
  }, [delay, duration, stagger]);

  const words = children.split(" ");

  return (
    <Component className={className}>
      <span ref={containerRef} className="text-reveal-container">
        {words.map((word, wordIndex) => (
          <span key={wordIndex} className="word">
            {word.split("").map((char, charIndex) => (
              <span key={charIndex} className="char-mask">
                <span className="char">{char}</span>
              </span>
            ))}
            {wordIndex < words.length - 1 && (
              <span className="char-mask">
                <span className="char">&nbsp;</span>
              </span>
            )}
          </span>
        ))}
      </span>
    </Component>
  );
}
