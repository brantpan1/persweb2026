"use client";

import { AnimatePresence } from "framer-motion";
import InkTransition from "@/components/InkTransition";
import { usePathname } from "next/navigation";

export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <AnimatePresence mode="wait">
      <InkTransition key={pathname}>{children}</InkTransition>
    </AnimatePresence>
  );
}
