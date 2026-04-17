"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { useTransition } from "@/components/TransitionProvider";

export default function Navigation() {
  const pathname = usePathname();
  const { navigate } = useTransition();
  const [time, setTime] = useState("");

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const links = [
    { href: "/", label: "Home" },
    { href: "/work", label: "Work" },
    { href: "/about", label: "About" },
    { href: "/contact", label: "Contact" },
  ];

  return (
    <header className="nav-header">
      <div className="nav-time">{time}</div>
      <nav className="nav-links">
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            onClick={(e) => {
              e.preventDefault();
              navigate(link.href);
            }}
            className={`nav-link ${pathname === link.href ? "active" : ""}`}
          >
            {link.label}
          </a>
        ))}
      </nav>
    </header>
  );
}
