"use client";

import { useEffect, useState } from "react";

import { LandingAuthActions } from "./auth-controls";

export function StickyNav({ authenticated }: { authenticated: boolean }) {
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
          ? "bg-[#1A1F16]/90 backdrop-blur-xl"
          : ""
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-dark.svg"
        alt="Murph"
        className="h-6"
      />
      <div className="flex items-center gap-4 sm:gap-6">
        {[
          { href: "#how", label: "How it works" },
          { href: "#pricing", label: "Pricing" },
          { href: "#faq", label: "FAQ" },
        ].map(({ href, label }) => (
          <a
            key={href}
            href={href}
            className="hidden text-sm text-white/75 transition-colors hover:text-white sm:block"
          >
            {label}
          </a>
        ))}
        <LandingAuthActions
          authenticated={authenticated}
          context="nav"
          signupLabel="Sign up"
        />
      </div>
    </nav>
  );
}
