import type { ReactNode } from "react";

import { MurphSafeFooter } from "@/src/components/murph-safe/murph-safe-shell";
import { getMurphGithubStarCount } from "@/src/lib/github-stars";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import { StickyNav } from "../sticky-nav";

export default async function MurphSafeLayout(input: { children: ReactNode }) {
  const [{ authenticated }, githubStarCount] = await Promise.all([
    getHostedPageAuthSnapshot(),
    getMurphGithubStarCount(),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <StickyNav
        authenticated={authenticated}
        githubStarCount={githubStarCount}
        preloadAuthPanel
      />
      <div className="flex-1">{input.children}</div>
      <MurphSafeFooter />
    </div>
  );
}
