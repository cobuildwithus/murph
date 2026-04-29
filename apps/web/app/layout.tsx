import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import Script from "next/script";

import { HostedPhoneCountryCodeProvider } from "@/src/components/hosted-onboarding/hosted-phone-country-code-provider";
import { Providers } from "./providers";
import { resolveHostedPublicBaseUrl } from "@/src/lib/hosted-web/public-url";
import {
  createMurphPageMetadata,
  MURPH_DEFAULT_METADATA_DESCRIPTION,
  MURPH_DEFAULT_METADATA_TITLE,
} from "@/src/lib/site-metadata";
import {
  requireHostedPrivyClientAppId,
  resolveHostedPrivyClientId,
} from "@/src/lib/hosted-onboarding/landing";

import "./globals.css";
import { cn } from "@/src/lib/utils";
import { dmMono, dmSans, fraunces } from "./font-assets";

const GITHUB_REPO_URL = "https://github.com/cobuildwithus/murph";
const SUPPORT_EMAIL = "support@withmurph.ai";
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
  const privyAppId = requireHostedPrivyClientAppId();
  const privyClientId = resolveHostedPrivyClientId();

  return (
    <html lang="en" className={cn(fraunces.variable, dmSans.variable, dmMono.variable)}>
      <body className="bg-background text-foreground font-sans antialiased">
        <HostedPhoneCountryCodeProvider countryCode={null}>
          <Providers privyAppId={privyAppId} privyClientId={privyClientId}>
            <div className="flex min-h-screen flex-col">
              <div className="flex-1">{input.children}</div>
              <footer id="global-footer" className="border-t border-stone-200 bg-cream-dark/60">
                <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-5 text-sm text-stone-500 md:px-12 lg:flex-row lg:items-center lg:justify-between lg:px-16">
                  <p className="max-w-2xl leading-relaxed">
                    Murph is open source and licensed under Apache 2.0.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <a
                      href="/consumer-health-data-privacy-policy"
                      className="max-w-full text-[12px] leading-snug font-semibold text-stone-700 underline underline-offset-4 transition-colors hover:text-stone-900"
                    >
                      Consumer Health Data Privacy Policy
                    </a>
                    <a
                      href="/legal/privacy"
                      className="inline-flex items-center text-[11px] font-medium uppercase tracking-[0.16em] text-stone-600 transition-colors hover:text-stone-800"
                    >
                      Privacy Policy
                    </a>
                    <a
                      href="/legal/terms"
                      className="inline-flex items-center text-[11px] font-medium uppercase tracking-[0.16em] text-stone-600 transition-colors hover:text-stone-800"
                    >
                      Terms
                    </a>
                    <a
                      href="/subprocessors"
                      className="inline-flex items-center text-[11px] font-medium uppercase tracking-[0.16em] text-stone-600 transition-colors hover:text-stone-800"
                    >
                      Subprocessors
                    </a>
                    <a
                      href={`mailto:${SUPPORT_EMAIL}`}
                      className="inline-flex items-center text-[11px] font-medium uppercase tracking-[0.16em] text-stone-600 transition-colors hover:text-stone-800"
                    >
                      Contact support
                    </a>
                    <a
                      href={GITHUB_REPO_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-olive transition-colors hover:text-stone-900"
                    >
                      View the code on GitHub
                    </a>
                  </div>
                </div>
              </footer>
            </div>
          </Providers>
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
