import Link from "next/link";

import { LandingAuthDialogButton } from "@/app/auth-controls";
import { StickyNav } from "@/app/sticky-nav";
import { SiteFooter } from "@/src/components/homepage/site-footer";
import { getMurphGithubStarCount } from "@/src/lib/github-stars";
import { HOSTED_APP_HOME_PATH } from "@/src/lib/hosted-onboarding/app-routes";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

function ComparisonClosingCta({ authenticated }: { authenticated: boolean }) {
  const buttonClassName =
    "group inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#5a6e32] px-6 text-sm font-semibold text-[#f5f0e8] transition-colors hover:bg-[#485928] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5a6e32]";

  return (
    <section className="border-t border-[#c4a882]/35 bg-[#efe7d9] px-5 py-12 text-[#2d3436] sm:px-8 sm:py-14 lg:px-12">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-7 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-[620px]">
          <p className="text-[0.76rem] font-semibold uppercase tracking-[0.14em] text-[#5a6e32]">
            Ready when you are
          </p>
          <h2 className="mt-3 text-balance font-serif text-[clamp(1.8rem,4vw,3rem)] font-semibold leading-[1.02] tracking-[-0.03em]">
            Try Murph with your own questions.
          </h2>
          <p className="mt-4 text-[0.92rem] leading-7 text-[#665d4c]">
            A private conversation in the messaging app you already use. Free to start, no card needed.
          </p>
        </div>
        {authenticated ? (
          <Link
            className={buttonClassName}
            href={HOSTED_APP_HOME_PATH}
          >
            Open Murph <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <LandingAuthDialogButton
            buttonClassName={buttonClassName}
            buttonLabel="Meet Murph"
            requireLaunchConsentOnCompletion
            showArrow
          />
        )}
      </div>
    </section>
  );
}

export async function ComparisonPageShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const [{ authenticated }, githubStarCount] = await Promise.all([
    getHostedPageAuthSnapshot(),
    getMurphGithubStarCount(),
  ]);

  return (
    <>
      <StickyNav
        authenticated={authenticated}
        darkTop
        githubStarCount={githubStarCount}
      />
      {children}
      <ComparisonClosingCta authenticated={authenticated} />
      <SiteFooter />
    </>
  );
}
