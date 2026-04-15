"use client";

import { useEffect, useState } from "react";

export function StickyNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 100);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 transition-all duration-300 sm:px-10 lg:px-16 ${
        scrolled
          ? "bg-[#f5f0e8]/80 backdrop-blur-xl shadow-[0_1px_0_rgba(196,168,130,0.15)]"
          : "bg-transparent"
      }`}
    >
      <div className="flex items-center gap-2.5">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-full border transition-colors duration-300 ${
            scrolled
              ? "border-[#2d3436]/10 bg-[#2d3436]/5"
              : "border-white/12 bg-white/5 backdrop-blur-sm"
          }`}
        >
          <span
            className={`font-serif text-[13px] font-semibold transition-colors duration-300 ${
              scrolled ? "text-[#2d3436]" : "text-white/90"
            }`}
          >
            M
          </span>
        </div>
        <span
          className={`font-mono text-[10px] font-medium uppercase tracking-[0.18em] transition-colors duration-300 ${
            scrolled ? "text-[#2d3436]/60" : "text-white/70"
          }`}
        >
          Murph
        </span>
      </div>
      <div className="flex items-center gap-6">
        {[
          { href: "#how", label: "How it works" },
          { href: "#pricing", label: "Pricing" },
          { href: "#faq", label: "FAQ" },
        ].map(({ href, label }) => (
          <a
            key={href}
            href={href}
            className={`hidden text-sm transition-colors sm:block ${
              scrolled
                ? "text-[#2d3436]/70 hover:text-[#2d3436]"
                : "text-white/75 hover:text-white"
            }`}
          >
            {label}
          </a>
        ))}
        <a
          href="/sign-in"
          className={`rounded-lg border px-4 py-1.5 text-sm font-medium transition-colors ${
            scrolled
              ? "border-[#2d3436]/15 text-[#2d3436]/80 hover:border-[#2d3436]/30 hover:bg-[#2d3436]/5"
              : "border-white/25 text-white/85 hover:border-white/40 hover:bg-white/5"
          }`}
        >
          Sign in
        </a>
      </div>
    </nav>
  );
}
