import type { ReactNode } from "react";

import { SiteFooter } from "@/src/components/homepage/site-footer";
import { getMurphGithubStarCount } from "@/src/lib/github-stars";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import { StickyNav } from "../sticky-nav";

export default async function GoalsLayout({ children }: { children: ReactNode }) {
  const [{ authenticated }, githubStarCount] = await Promise.all([
    getHostedPageAuthSnapshot(),
    getMurphGithubStarCount(),
  ]);

  return (
    <>
      <a
        href="#goal-content"
        className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-background shadow-lg transition-transform focus:translate-y-0 focus:outline-none focus:ring-3 focus:ring-ring focus:ring-offset-2"
      >
        Skip to content
      </a>
      <StickyNav
        authenticated={authenticated}
        githubStarCount={githubStarCount}
      />
      <main
        id="goal-content"
        tabIndex={-1}
        className="min-h-dvh bg-[#f5f0e8] antialiased"
      >
        <div className="mx-auto w-full max-w-[1200px] px-5 pb-20 pt-28 sm:px-10 sm:pt-32 lg:px-16 lg:pb-28 lg:pt-40">
          {children}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
