import type { Metadata } from "next";

import { AssistantSection } from "@/src/components/homepage/assistant-section";
import { ExperimentsSection } from "@/src/components/homepage/experiments-section";
import { FaqSection } from "@/src/components/homepage/faq-section";
import { HeroSection } from "@/src/components/homepage/hero-section";
import { HowItWorksSection } from "@/src/components/homepage/how-it-works-section";
import { LocalRunSection } from "@/src/components/homepage/local-run-section";
import { SignupCtaSection } from "@/src/components/homepage/signup-cta-section";
import { SiteFooter } from "@/src/components/homepage/site-footer";
import type { HomepageSignupCta } from "@/src/components/homepage/types";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { resolveHostedInstallScriptUrl } from "@/src/lib/hosted-onboarding/landing";

import { StickyNav } from "./sticky-nav";

export const metadata: Metadata = {
  title: "Murph — Turn wearable data into answers about your body",
  description:
    "Expert-backed health experiments measured by your wearable. Pick a protocol, follow it, see what changed. Works with Oura, Whoop, and Garmin.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Murph — Turn wearable data into answers about your body",
    description:
      "Expert-backed health experiments measured by your wearable. Pick a protocol, follow it, see what changed.",
    siteName: "Murph",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Murph — Wearable data, made useful.",
    description: "Expert-backed health experiments measured by your wearable.",
  },
};

export default async function HomePage() {
  const { authenticated } = await getHostedPageAuthSnapshot();
  const installCommandUrl =
    resolveHostedInstallScriptUrl() ?? "https://www.withmurph.ai/install.sh";
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
        metaItems: ["$5/month early access", "Oura and Whoop"],
        note: null,
        signupLabel: "Create your account",
        title: "Figure out what actually makes you healthier.",
      };

  return (
    <>
      <style>{`#global-footer { display: none; }`}</style>
      <main className="min-h-screen bg-[#f5f0e8] antialiased">
        <StickyNav authenticated={authenticated} />
        <HeroSection authenticated={authenticated} />
        <HowItWorksSection />
        <ExperimentsSection />
        <AssistantSection />
        <FaqSection />
        <SignupCtaSection authenticated={authenticated} signupCta={signupCta} />
        <LocalRunSection installCommandUrl={installCommandUrl} />
        <SiteFooter authenticated={authenticated} />
      </main>
    </>
  );
}
