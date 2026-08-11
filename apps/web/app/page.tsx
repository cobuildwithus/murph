import type { Metadata } from "next";
import { headers } from "next/headers";

import { AsksGridSection } from "@/src/components/homepage/asks-section";
import { AssistantSection } from "@/src/components/homepage/assistant-section";
import { EnvironmentSection } from "@/src/components/homepage/environment-section";
import { ErrandsSection } from "@/src/components/homepage/errands-section";
import { FaqSection } from "@/src/components/homepage/faq-section";
import {
  HeroClocksIn,
  type HeroMessengerChannel,
} from "@/src/components/homepage/hero-clocks-in";
import { HowItWorksSection } from "@/src/components/homepage/how-it-works-section";
import { LandingBrowserVaultWarm } from "@/src/components/homepage/landing-browser-vault-warm";
import { IntegrationsSection } from "@/src/components/homepage/integrations-section";
import { LocalRunSection } from "@/src/components/homepage/local-run-section";
import { MealPhotosSection } from "@/src/components/homepage/meal-photos-section";
import { MurphCardHandoffGate } from "@/src/components/homepage/murph-card-handoff-dialog";
import { NutritionSection } from "@/src/components/homepage/nutrition-section";
import { pickRandomMurphHeadshotSrc } from "@/src/components/homepage/murph-headshot-avatar";
import { PersonasSection } from "@/src/components/homepage/personas-section";
import { ReferralSection } from "@/src/components/homepage/referral-section";
import { SecurityTeaserSection } from "@/src/components/homepage/security-teaser-section";
import { SiteFooter } from "@/src/components/homepage/site-footer";
import { SignupCtaSection } from "@/src/components/homepage/signup-cta-section";
import { TechnicalCapabilitiesSection } from "@/src/components/homepage/technical-capabilities-section";
import { TogetherSection } from "@/src/components/homepage/together-section";
import { TrustSection } from "@/src/components/homepage/trust-section";
import type { HomepageSignupCta } from "@/src/components/homepage/types";
import { HomepageAuthRuntimeProvider } from "@/src/components/hosted-onboarding/homepage-auth-runtime-provider";
import { fetchHeroContactInfo } from "@/src/lib/hero-contact-info";
import { isHostedCustomInferenceEnabled } from "@/src/lib/hosted-inference/feature";
import { isHostedVeniceAssistantEnabled } from "@/src/lib/hosted-onboarding/assistant-model-preference";
import { resolveHostedInstallScriptUrl } from "@/src/lib/hosted-onboarding/landing";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { getMurphGithubStarCount } from "@/src/lib/github-stars";
import {
  getAvailableHostedPublicReferralRewards,
} from "@/src/lib/hosted-growth/referral-program";
import {
  createMurphPageMetadata,
  MURPH_DEFAULT_METADATA_DESCRIPTION,
  MURPH_DEFAULT_METADATA_TITLE,
  MURPH_DEFAULT_OPEN_GRAPH_DESCRIPTION,
} from "@/src/lib/site-metadata";

import { StickyNav } from "./sticky-nav";

export const metadata: Metadata = createMurphPageMetadata({
  title: MURPH_DEFAULT_METADATA_TITLE,
  description: MURPH_DEFAULT_METADATA_DESCRIPTION,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    description: MURPH_DEFAULT_OPEN_GRAPH_DESCRIPTION,
    type: "website",
  },
  twitter: {
    description: MURPH_DEFAULT_OPEN_GRAPH_DESCRIPTION,
  },
});

// Per-country default for the hero "Message Murph" CTA logo. Picks ONE of the
// channels Murph supports today (iMessage, Telegram); the button still opens
// the signup modal — the logo is a regional cue, not a routing choice.
//
// iMessage is the default because it falls back to SMS, which works in every
// market. Telegram only overrides where Telegram is the verified #1 messenger
// by MAU/reach (beating WhatsApp, Messenger, Viber, and local apps). Sources:
// DataReportal Digital 2026, Similarweb 2025, Central Asia Barometer 2025,
// Sagaci 2025, Kursiv 2025, Carnegie 2026.
//
// Deliberately excluded (often-cited but not actually Telegram-#1 by MAU):
//   AM, KZ, KG — WhatsApp leads; Telegram is #2 (Central Asia Barometer 2025)
//   KH         — WhatsApp 69% > Telegram 61% reach (Kursiv 2025)
//   AZ, GE, TM — WhatsApp/IMO leads, not Telegram
//   BG, RS, GR — Viber #1
const TELEGRAM_DEFAULT_COUNTRIES: ReadonlySet<string> = new Set([
  "BY",
  "ET",
  "IR",
  "MD",
  "RU",
  "TJ",
  "UA",
  "UZ",
]);

function resolveHeroMessengerChannel(country: string): HeroMessengerChannel {
  return TELEGRAM_DEFAULT_COUNTRIES.has(country.toUpperCase())
    ? "telegram"
    : "imessage";
}

export default async function HomePage() {
  const [
    { authenticated },
    githubStarCount,
    heroContactInfo,
    headerList,
  ] = await Promise.all([
    getHostedPageAuthSnapshot(),
    getMurphGithubStarCount(),
    fetchHeroContactInfo(),
    headers(),
  ]);
  const country = headerList.get("x-vercel-ip-country") ?? "";
  const messengerChannel = resolveHeroMessengerChannel(country);
  const murphHeadshotSrc = pickRandomMurphHeadshotSrc();
  const referralRewards = getAvailableHostedPublicReferralRewards();
  const installCommandUrl =
    resolveHostedInstallScriptUrl() ?? "https://www.withmurph.ai/install.sh";
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
        metaItems: ["Free starter usage", "Open source"],
        note:
          "Starter usage does not expire. No card required; choose a plan when you need more.",
        signupLabel: "Get started",
        title: "Whatever your goal, you don’t have to hit it alone.",
      };

  return (
    <HomepageAuthRuntimeProvider authenticated={authenticated}>
      <MurphCardHandoffGate />
      <main className="min-h-screen bg-[#f5f0e8] antialiased">
        {authenticated ? <LandingBrowserVaultWarm /> : null}
        <StickyNav
          authenticated={authenticated}
          githubStarCount={githubStarCount}
          preloadAuthPanel
        />
        <HeroClocksIn
          authenticated={authenticated}
          contactInfo={heroContactInfo}
          messengerChannel={messengerChannel}
          murphHeadshotSrc={murphHeadshotSrc}
        />
        <TogetherSection />
        <AsksGridSection />
        <TrustSection />
        <MealPhotosSection />
        <NutritionSection />
        <EnvironmentSection />
        <PersonasSection murphHeadshotSrc={murphHeadshotSrc} />
        <ErrandsSection />
        <IntegrationsSection authenticated={authenticated} />
        <AssistantSection murphHeadshotSrc={murphHeadshotSrc} />
        <HowItWorksSection />
        <TechnicalCapabilitiesSection
          customInferenceAvailable={isHostedCustomInferenceEnabled()}
          veniceAvailable={isHostedVeniceAssistantEnabled()}
        />
        <SecurityTeaserSection />
        <FaqSection veniceAvailable={isHostedVeniceAssistantEnabled()} />
        {referralRewards.length > 0
          ? <ReferralSection rewards={referralRewards} />
          : null}
        <SignupCtaSection authenticated={authenticated} signupCta={signupCta} />
        <LocalRunSection installCommandUrl={installCommandUrl} />
      </main>
      <SiteFooter />
    </HomepageAuthRuntimeProvider>
  );
}
