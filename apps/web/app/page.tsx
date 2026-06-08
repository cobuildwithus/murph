import type { Metadata } from "next";

import { AssistantSection } from "@/src/components/homepage/assistant-section";
import { FaqSection } from "@/src/components/homepage/faq-section";
import { HeroSection } from "@/src/components/homepage/hero-section";
import { HowItWorksSection } from "@/src/components/homepage/how-it-works-section";
import { LocalRunSection } from "@/src/components/homepage/local-run-section";
import { SecurityTeaserSection } from "@/src/components/homepage/security-teaser-section";
import { SiteFooter } from "@/src/components/homepage/site-footer";
import { SignupCtaSection } from "@/src/components/homepage/signup-cta-section";
import type { HomepageSignupCta } from "@/src/components/homepage/types";
import { formatHostedLandingPricingLongSummary } from "@/src/lib/hosted-onboarding/billing-plans";
import { resolveHostedInstallScriptUrl } from "@/src/lib/hosted-onboarding/landing";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { getMurphGithubStarCount } from "@/src/lib/github-stars";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { StickyNav } from "./sticky-nav";

export const metadata: Metadata = createMurphPageMetadata({
  title: "Murph — Discover what actually makes you healthier",
  description:
    "Your personal health assistant. Sync your biomarkers, pick a protocol, see what actually makes you healthier.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    description:
      "Your personal health assistant. Text Murph over iMessage, connect any wearable. Pick a protocol and see what actually makes you healthier.",
    type: "website",
  },
  twitter: {
    description:
      "Your personal health assistant. Text Murph over iMessage, connect any wearable. Pick a protocol and see what actually makes you healthier.",
  },
});

export default async function HomePage() {
  const [{ authenticated }, githubStarCount] = await Promise.all([
    getHostedPageAuthSnapshot(),
    getMurphGithubStarCount(),
  ]);
  const installCommandUrl =
    resolveHostedInstallScriptUrl() ?? "https://www.withmurph.ai/install.sh";
  const launchPricingSummary = formatHostedLandingPricingLongSummary();
  const signupCta: HomepageSignupCta = authenticated
    ? {
        body: "Manage billing and connected wearables from one place.",
        eyebrow: "Welcome back",
        metaItems: ["Subscription and billing", "Wearable connections"],
        note: null,
        signupLabel: "Go to dashboard",
        title: "You’re already set up.",
      }
    : {
        body: null,
        eyebrow: "Sign up",
        metaItems: [
          `${launchPricingSummary}`,
          "Open source",
        ],
        note: null,
        signupLabel: "Get started",
        title: "Discover what actually makes you healthier.",
      };

  return (
    <>
      <main className="min-h-screen bg-[#f5f0e8] antialiased">
        <StickyNav
          authenticated={authenticated}
          githubStarCount={githubStarCount}
          preloadAuthPanel
          splitUnauthenticatedAuth
        />
        <HeroSection authenticated={authenticated} />
        <HowItWorksSection />
        <AssistantSection />
        <SecurityTeaserSection />
        <FaqSection />
        <SignupCtaSection authenticated={authenticated} signupCta={signupCta} />
        <LocalRunSection installCommandUrl={installCommandUrl} />
      </main>
      <SiteFooter />
    </>
  );
}
