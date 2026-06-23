"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { LandingAuthActions } from "./auth-controls";
import { formatStarCount } from "@/src/lib/github-stars";

const GITHUB_REPO_URL = "https://github.com/cobuildwithus/murph";

export function StickyNav({
  authenticated,
  githubStarCount = null,
  preloadAuthPanel = false,
  splitUnauthenticatedAuth = true,
}: {
  authenticated: boolean;
  githubStarCount?: number | null;
  preloadAuthPanel?: boolean;
  splitUnauthenticatedAuth?: boolean;
}) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 100);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-5 py-4 transition-[background-color,backdrop-filter] duration-300 sm:px-10 lg:px-16 ${
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
          width={107}
          height={24}
          className="h-6 w-auto"
        />
      </Link>
      <div className="flex items-center gap-4 sm:gap-6">
        {[
          { href: "/#how", label: "How it works" },
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
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noreferrer"
          aria-label={
            githubStarCount !== null
              ? `Star Murph on GitHub (${githubStarCount} stars)`
              : "Star Murph on GitHub"
          }
          className="hidden items-center gap-1.5 text-sm text-white/75 transition-colors hover:text-white sm:inline-flex"
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className="size-4 fill-current"
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          {githubStarCount !== null ? (
            <span>{formatStarCount(githubStarCount)}</span>
          ) : null}
        </a>
        <LandingAuthActions
          authLabel="Dashboard"
          authenticated={authenticated}
          context="nav"
          {...(preloadAuthPanel ? { preloadAuthPanel: true } : {})}
          splitUnauthenticated={splitUnauthenticatedAuth}
        />
      </div>
    </nav>
  );
}
