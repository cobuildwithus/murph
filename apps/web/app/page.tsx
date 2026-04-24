import type { Metadata } from "next";

import { HostedPhoneCountryCodeBoundary } from "@/src/components/hosted-onboarding/hosted-phone-country-code-boundary";
import { AssistantSection } from "@/src/components/homepage/assistant-section";
import { FaqSection } from "@/src/components/homepage/faq-section";
import { HeroSection } from "@/src/components/homepage/hero-section";
import { HowItWorksSection } from "@/src/components/homepage/how-it-works-section";
import { LocalRunSection } from "@/src/components/homepage/local-run-section";
import { SignupCtaSection } from "@/src/components/homepage/signup-cta-section";
import { SiteFooter } from "@/src/components/homepage/site-footer";
import type { HomepageSignupCta } from "@/src/components/homepage/types";
import { formatHostedLandingPricingLongSummary } from "@/src/lib/hosted-onboarding/billing-plans";
import { resolveHostedInstallScriptUrl } from "@/src/lib/hosted-onboarding/landing";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

import { StickyNav } from "./sticky-nav";

export const metadata: Metadata = {
  title: "Murph — Discover what actually makes you healthier",
  description:
    "Your personal health assistant. Pick a protocol, bring the context you have, and see what actually changed.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Murph — Discover what actually makes you healthier",
    description:
      "Your personal health assistant. Pick a protocol, run it as a proper experiment, and compare the result against your baseline.",
    siteName: "Murph",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Murph — Discover what actually makes you healthier",
    description:
      "Your personal health assistant. Pick a protocol, run it as a proper experiment, and review what changed with or without a wearable.",
  },
};

export default async function HomePage() {
  const { authenticated } = await getHostedPageAuthSnapshot();
  const installCommandUrl =
    resolveHostedInstallScriptUrl() ?? "https://www.withmurph.ai/install.sh";
  const launchPricingSummary = formatHostedLandingPricingLongSummary();
  const signupCta: HomepageSignupCta = authenticated
    ? {
        body: "Manage billing, vault sync, and connected sources from one place.",
        eyebrow: "Your account",
        metaItems: ["Subscription and billing", "Connected sources"],
        note: null,
        signupLabel: "Open settings",
        title: "You’re already set up.",
      }
    : {
        body: null,
        eyebrow: "Sign up",
        metaItems: [
          `${launchPricingSummary}`,
          "Chat, uploads, and optional connected sources",
        ],
        note: null,
        signupLabel: "Get started",
        title: "Discover what actually makes you healthier.",
      };

  return (
    <HostedPhoneCountryCodeBoundary>
      <style>{`#global-footer { display: none; }`}</style>
      <main className="min-h-screen bg-[#f5f0e8] antialiased">
        <StickyNav authenticated={authenticated} />
        <HeroSection authenticated={authenticated} />
        <HowItWorksSection />
        <AssistantSection />
        <FaqSection />
        <SignupCtaSection authenticated={authenticated} signupCta={signupCta} />
        <LocalRunSection installCommandUrl={installCommandUrl} />
        <SiteFooter authenticated={authenticated} />
      </main>
    </HostedPhoneCountryCodeBoundary>
  );
}
