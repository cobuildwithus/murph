import type { Metadata } from "next";
import { Fraunces, DM_Sans, DM_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { Providers } from "./providers";
import { resolveHostedPublicBaseUrl } from "@/src/lib/hosted-web/public-url";
import {
  requireHostedPrivyClientAppId,
  resolveHostedPrivyClientId,
} from "@/src/lib/hosted-onboarding/landing";

import "./globals.css";
import { cn } from "@/src/lib/utils";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["400", "600"],
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400"],
});

const GITHUB_REPO_URL = "https://github.com/cobuildwithus/murph";
const SUPPORT_EMAIL = "support@withmurph.ai";

const metadataBase = resolveMetadataBase();

export const metadata: Metadata = metadataBase
  ? {
      metadataBase,
    }
  : {};

export default function RootLayout(input: { children: React.ReactNode }) {
  const privyAppId = requireHostedPrivyClientAppId();
  const privyClientId = resolveHostedPrivyClientId();

  return (
    <html lang="en" className={cn(fraunces.variable, dmSans.variable, dmMono.variable)}>
      <body className="bg-background text-foreground font-sans antialiased">
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
        <Analytics />
        <SpeedInsights />
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
