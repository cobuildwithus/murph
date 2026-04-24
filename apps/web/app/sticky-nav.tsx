"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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
      <Link
        href="/"
        aria-label="Murph home"
        className="inline-flex items-center"
        onClick={(event) => {
          if (window.location.pathname === "/") {
            event.preventDefault();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-dark.svg"
          alt="Murph"
          className="h-6"
        />
      </Link>
      <div className="flex items-center gap-4 sm:gap-6">
        {[
          { href: "/#how", label: "How it works" },
          { href: "/#pricing", label: "Pricing" },
          { href: "/#faq", label: "FAQ" },
          { href: "/security", label: "Security" },
        ].map(({ href, label }) => (
          <a
            key={href}
            href={href}
            className="hidden text-sm text-white/75 transition-colors hover:text-white md:block"
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
