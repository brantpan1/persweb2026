"use client";

interface TextLineProps {
  text: string;
  className?: string;
}

function TextLine({ text, className = "" }: TextLineProps) {
  return <div className={`text-3d-line ${className}`}>{text}</div>;
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
