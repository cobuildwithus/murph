import type { Metadata } from "next";

import { HostedPhoneCountryCodeBoundary } from "@/src/components/hosted-onboarding/hosted-phone-country-code-boundary";
import { AssistantSection } from "@/src/components/homepage/assistant-section";
import { FaqSection } from "@/src/components/homepage/faq-section";
import { HeroSection } from "@/src/components/homepage/hero-section";
import { HowItWorksSection } from "@/src/components/homepage/how-it-works-section";
import { LocalRunSection } from "@/src/components/homepage/local-run-section";
import { SecurityTeaserSection } from "@/src/components/homepage/security-teaser-section";
import { SignupCtaSection } from "@/src/components/homepage/signup-cta-section";
import { SiteFooter } from "@/src/components/homepage/site-footer";
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
    "Your personal health assistant. Connect your data, pick a protocol, see what actually makes you healthier.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    description:
      "Your personal health assistant. Pick a protocol, run it as a proper experiment, see what actually changed. Expert-backed, measured against your baseline.",
    type: "website",
  },
  twitter: {
    description:
      "Your personal health assistant. Pick a protocol, see what actually makes you healthier. Works with Oura, WHOOP, Garmin, and Strava.",
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
        eyebrow: "Your account",
        metaItems: ["Subscription and billing", "Wearable connections"],
        note: null,
        signupLabel: "Open settings",
        title: "You’re already set up.",
      }
    : {
        body: null,
        eyebrow: "Sign up",
        metaItems: [
          `${launchPricingSummary}`,
          "Oura, WHOOP, Strava, and Garmin",
        ],
        note: null,
        signupLabel: "Signup",
        title: "Discover what actually makes you healthier.",
      };

  return (
    <HostedPhoneCountryCodeBoundary>
      <style>{`#global-footer { display: none; }`}</style>
      <main className="min-h-screen bg-[#f5f0e8] antialiased">
        <StickyNav
          authenticated={authenticated}
          githubStarCount={githubStarCount}
          splitUnauthenticatedAuth
        />
        <HeroSection authenticated={authenticated} />
        <HowItWorksSection />
        <AssistantSection />
        <SecurityTeaserSection />
        <FaqSection />
        <SignupCtaSection authenticated={authenticated} signupCta={signupCta} />
        <LocalRunSection installCommandUrl={installCommandUrl} />
        <SiteFooter authenticated={authenticated} />
      </main>
    </HostedPhoneCountryCodeBoundary>
  );
}
