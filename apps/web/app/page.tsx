import type { Metadata } from "next";

import { CapabilitiesGrid } from "@/src/components/homepage/capabilities-grid";
import { ConversationsSection } from "@/src/components/homepage/conversations-section";
import { CtaSection } from "@/src/components/homepage/cta-section";
import { FaqSection } from "@/src/components/homepage/faq-section";
import { HeroSection } from "@/src/components/homepage/hero-section";
import { IntegrationsBar } from "@/src/components/homepage/integrations-bar";
import { NavHeader } from "@/src/components/homepage/nav-header";
import { PrivacySection } from "@/src/components/homepage/privacy-section";
import { QuickStartSection } from "@/src/components/homepage/quick-start-section";
import { TrustStrip } from "@/src/components/homepage/trust-strip";
import {
  resolveHostedInstallScriptUrl,
} from "@/src/lib/hosted-onboarding/landing";

export const metadata: Metadata = {
  title: "Murph — Health assistant that fits your real life",
  description:
    "Track meals, sync wearables, spot patterns, and get answers about your health via Telegram, Linq, or email.",
};

export default function HomePage() {
  const installCommandUrl =
    resolveHostedInstallScriptUrl() ?? "https://YOUR_DOMAIN/install.sh";

  return (
    <main className="min-h-screen">
      <NavHeader />
      <HeroSection />
      <IntegrationsBar />
      <QuickStartSection installCommandUrl={installCommandUrl} />
      <CapabilitiesGrid />
      <PrivacySection />
      <ConversationsSection />
      <FaqSection />
      <CtaSection />
      <TrustStrip />
    </main>
  );
}
