import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import Script from "next/script";

import { HostedPhoneCountryCodeProvider } from "@/src/components/hosted-onboarding/hosted-phone-country-code-provider";
import { SiteFooter } from "@/src/components/homepage/site-footer";
import { resolveHostedPublicBaseUrl } from "@/src/lib/hosted-web/public-url";
import {
  createMurphPageMetadata,
  MURPH_DEFAULT_METADATA_DESCRIPTION,
  MURPH_DEFAULT_METADATA_TITLE,
} from "@/src/lib/site-metadata";

import "./globals.css";
import { cn } from "@/src/lib/utils";
import { dmMono, dmSans, fraunces } from "./font-assets";

const DEFAULT_METADATA_BASE_URL = "https://www.withmurph.ai";

const metadataBase = resolveMetadataBase() ?? new URL(DEFAULT_METADATA_BASE_URL);
const defaultMetadata = createMurphPageMetadata({
  description: MURPH_DEFAULT_METADATA_DESCRIPTION,
  openGraph: {
    type: "website",
  },
  title: MURPH_DEFAULT_METADATA_TITLE,
  twitter: {
    description:
      "Your personal health assistant. Pick a protocol, see what actually makes you healthier.",
  },
});

export const metadata: Metadata = {
  ...defaultMetadata,
  metadataBase,
};

export default function RootLayout(input: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(fraunces.variable, dmSans.variable, dmMono.variable)}>
      <body className="bg-background text-foreground font-sans antialiased">
        <HostedPhoneCountryCodeProvider countryCode={null}>
          <div className="flex min-h-screen flex-col">
            <div className="flex-1">{input.children}</div>
            <SiteFooter />
          </div>
        </HostedPhoneCountryCodeProvider>
        <Analytics />
        <SpeedInsights />
        {process.env.NODE_ENV === "development" ? (
          <Script src="https://ui.sh/ui-picker.js" />
        ) : null}
      </body>
    </html>
  );
}

function resolveMetadataBase(): URL | null {
  const value = resolveHostedPublicBaseUrl(process.env);

  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}
