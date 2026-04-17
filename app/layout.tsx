import type { Metadata } from "next";
import { Inter, Libre_Baskerville } from "next/font/google";
import { TransitionProvider } from "@/components/TransitionProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const baskerville = Libre_Baskerville({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-baskerville",
  display: "swap",
});

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
    <html
      lang="en"
      className={`${inter.variable} ${baskerville.variable}`}
    >
      <body>
        <TransitionProvider>{children}</TransitionProvider>
      </body>
    </html>
  );
}
