"use client";

import { useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";

import { LandingAuthActions, LandingAuthDialog } from "./auth-controls";
import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@/src/components/ui/drawer";
import { formatStarCount } from "@/src/lib/github-stars";

const GITHUB_REPO_URL = "https://github.com/cobuildwithus/murph";

const NAV_LINKS: ReadonlyArray<{
  href: string;
  label: string;
}> = [
  { href: "/#how", label: "How it works" },
  { href: "/clubs", label: "Clubs" },
  { href: "/#faq", label: "FAQ" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/blog", label: "Blog" },
  { href: "/security", label: "Security" },
];

// Large tap rows matching the /home sidebar's mobile nav sizing.
const MOBILE_MENU_ROW =
  "rounded-lg px-5 py-6 text-xl font-medium text-[#2d3436] transition-colors hover:bg-[#c4a882]/10 active:bg-[#c4a882]/15";

export function StickyNav({
  authenticated,
  darkTop = false,
  githubStarCount = null,
  preloadAuthPanel = false,
  splitUnauthenticatedAuth = true,
}: {
  authenticated: boolean;
  /**
   * Set when the page's hero sits directly under the nav on a dark surface, so
   * the unscrolled nav uses light text and the dark-background logo instead of
   * the default light-hero (dark text) treatment.
   */
  darkTop?: boolean;
  githubStarCount?: number | null;
  preloadAuthPanel?: boolean;
  splitUnauthenticatedAuth?: boolean;
}) {
  const auth = useAuth();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  // While the drawer is open vaul pins the body on iOS and restores the
  // pre-open scroll position on close, which swallows a same-page hash jump
  // fired from inside it. Close first, then jump once the 500ms close
  // animation and scroll restore have finished.
  const handleMenuLinkClick = (
    event: MouseEvent<HTMLAnchorElement>,
    href: string,
  ) => {
    setMenuOpen(false);
    if (!href.startsWith("/#") || window.location.pathname !== "/") return;
    event.preventDefault();
    const hash = href.slice(2);
    window.setTimeout(() => {
      window.location.hash = hash;
    }, 600);
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 100);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // The nav sits on a dark surface either once scrolled (dark backdrop appears)
  // or when the page declares its top hero is dark. Text, logo, and auth
  // controls key off this; only the nav's own background keys off `scrolled`.
  const onDark = scrolled || darkTop;

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
          src={onDark ? "/logo-dark.svg" : "/logo.svg"}
          alt="Murph"
          width={107}
          height={24}
          className="h-6 w-auto"
        />
      </Link>
      <div className="flex items-center gap-4 sm:gap-6">
        {NAV_LINKS.map(({ href, label }) => (
          <a
            key={href}
            href={href}
            className={`hidden text-sm transition-colors lg:block ${
              onDark
                ? "text-white/75 hover:text-white"
                : "text-[#2d3436]/80 hover:text-[#2d3436]"
            }`}
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
          className={`hidden items-center gap-1.5 text-sm transition-colors lg:inline-flex ${
            onDark
              ? "text-white/75 hover:text-white"
              : "text-[#2d3436]/80 hover:text-[#2d3436]"
          }`}
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
          {...(onDark ? { onDarkSurface: true } : {})}
          {...(preloadAuthPanel ? { preloadAuthPanel: true } : {})}
          splitUnauthenticated={splitUnauthenticatedAuth}
        />
        <Drawer open={menuOpen} onOpenChange={setMenuOpen}>
          <DrawerTrigger
            aria-label="Open menu"
            className={`inline-flex size-9 items-center justify-center rounded-lg transition-colors lg:hidden ${
              onDark
                ? "text-white/85 hover:bg-white/10"
                : "text-[#2d3436]/85 hover:bg-[#2d3436]/[0.06]"
            }`}
          >
            <Menu className="size-5" aria-hidden="true" />
          </DrawerTrigger>
          <DrawerContent
            aria-describedby={undefined}
            className="border-[#c4a882]/25 bg-[#f5f0e8]"
          >
            <DrawerTitle className="sr-only">Menu</DrawerTitle>
            <nav className="flex flex-col px-3 pb-10 pt-2">
              {NAV_LINKS.map(({ href, label }) => (
                <a
                  key={href}
                  href={href}
                  className={MOBILE_MENU_ROW}
                  onClick={(event) => handleMenuLinkClick(event, href)}
                >
                  {label}
                </a>
              ))}
              <a
                href={GITHUB_REPO_URL}
                target="_blank"
                rel="noreferrer"
                className={MOBILE_MENU_ROW}
                onClick={() => setMenuOpen(false)}
              >
                GitHub
              </a>
              {!authenticated && splitUnauthenticatedAuth ? (
                <>
                  <div
                    aria-hidden="true"
                    className="mx-5 my-2 h-px bg-[#c4a882]/25"
                  />
                  <button
                    type="button"
                    className={`${MOBILE_MENU_ROW} text-left`}
                    onClick={() => {
                      setMenuOpen(false);
                      if (auth.shared) {
                        auth.openAuthDialog();
                      } else {
                        setLoginOpen(true);
                      }
                    }}
                  >
                    Log in
                  </button>
                </>
              ) : null}
            </nav>
          </DrawerContent>
        </Drawer>
      </div>
      {!auth.shared && !authenticated && splitUnauthenticatedAuth ? (
        <LandingAuthDialog open={loginOpen} onOpenChange={setLoginOpen} />
      ) : null}
    </nav>
  );
}
