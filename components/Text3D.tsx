"use client";

import { useEffect, useRef, useState } from "react";

interface TextLineProps {
  text: string;
  className?: string;
}

function TextLine({ text, className = "" }: TextLineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [chars, setChars] = useState<HTMLSpanElement[]>([]);

  useEffect(() => {
    if (containerRef.current) {
      const charElements = containerRef.current.querySelectorAll(".char-3d");
      setChars(Array.from(charElements) as HTMLSpanElement[]);
    }
  }, [text]);

  useEffect(() => {
    if (chars.length === 0) return;

    const handleMouseMove = (e: MouseEvent) => {
      chars.forEach((char) => {
        const rect = char.getBoundingClientRect();
        const charCenterX = rect.left + rect.width / 2;
        const charCenterY = rect.top + rect.height / 2;

        const deltaX = e.clientX - charCenterX;
        const deltaY = e.clientY - charCenterY;

        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        const maxDistance = 1200;
        const intensity = Math.max(0, 1 - distance / maxDistance);

        const rotateY = (deltaX / maxDistance) * 120 * intensity;
        const rotateX = -(deltaY / maxDistance) * 120 * intensity;

        char.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
      });
    };

    const handleMouseLeave = () => {
      chars.forEach((char) => {
        char.style.transform = "perspective(1000px) rotateX(0deg) rotateY(0deg)";
      });
    };

    window.addEventListener("mousemove", handleMouseMove);
    document.body.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      document.body.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [chars]);

  return (
    <div ref={containerRef} className={`text-3d-line ${className}`}>
      {text.split("").map((char, i) => (
        <span
          key={i}
          className="char-3d"
          style={{
            display: "inline-block",
            transition: "transform 0.1s ease-out",
            transformStyle: "preserve-3d",
          }}
        >
          {char === " " ? "\u00A0" : char}
        </span>
      ))}
    </div>
  );
}

interface Text3DProps {
  lines: { text: string; className?: string }[];
  className?: string;
}

export default function Text3D({ lines, className = "" }: Text3DProps) {
  return (
    <div className={`text-3d-container ${className}`}>
      {lines.map((line, i) => (
        <TextLine key={i} text={line.text} className={line.className} />
      ))}
    </div>
  );
}
