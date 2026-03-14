import type { Metadata } from "next";
import "./globals.css";
import { BRUSH_IDS } from "@/lib/constants";

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
