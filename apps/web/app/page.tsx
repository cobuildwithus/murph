import type { Metadata } from "next";
import { headers } from "next/headers";

import { AsksGridSection } from "@/src/components/homepage/asks-section";
import { AssistantSection } from "@/src/components/homepage/assistant-section";
import { FaqSection } from "@/src/components/homepage/faq-section";
import {
  HeroClocksIn,
  type HeroMessengerChannel,
} from "@/src/components/homepage/hero-clocks-in";
import { HowItWorksSection } from "@/src/components/homepage/how-it-works-section";
import { IntegrationsSection } from "@/src/components/homepage/integrations-section";
import { LocalRunSection } from "@/src/components/homepage/local-run-section";
import { pickRandomMurphHeadshotSrc } from "@/src/components/homepage/murph-headshot-avatar";
import { PersonasSection } from "@/src/components/homepage/personas-section";
import { SecurityTeaserSection } from "@/src/components/homepage/security-teaser-section";
import { SiteFooter } from "@/src/components/homepage/site-footer";
import { SignupCtaSection } from "@/src/components/homepage/signup-cta-section";
import { TrustSection } from "@/src/components/homepage/trust-section";
import type { HomepageSignupCta } from "@/src/components/homepage/types";
import { fetchHeroContactInfo } from "@/src/lib/hero-contact-info";
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
//
// When we ship WhatsApp support, swap to the future mapping:
//   WHATSAPP: most of Europe, LatAm, India, MENA, Africa, SEA, plus GB/IE/NZ/HK/SG/JP
//   IMESSAGE: AU, CA, US (only)
//   TELEGRAM: unchanged (BY, ET, IR, MD, RU, TJ, UA, UZ)
//   DEFAULT: whatsapp
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
        />
        <HeroClocksIn
          authenticated={authenticated}
          contactInfo={heroContactInfo}
          messengerChannel={messengerChannel}
          murphHeadshotSrc={murphHeadshotSrc}
        />
        <AsksGridSection />
        <TrustSection />
        <PersonasSection murphHeadshotSrc={murphHeadshotSrc} />
        <IntegrationsSection authenticated={authenticated} />
        <HowItWorksSection />
        <AssistantSection murphHeadshotSrc={murphHeadshotSrc} />
        <SecurityTeaserSection />
        <FaqSection />
        <SignupCtaSection authenticated={authenticated} signupCta={signupCta} />
        <LocalRunSection installCommandUrl={installCommandUrl} />
      </main>
      <SiteFooter />
    </>
  );
}
