import type { Metadata } from "next";
import { Outfit, Geist } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";

import { Providers } from "./providers";
import { resolveHostedPublicBaseUrl } from "@/src/lib/hosted-web/public-url";
import { resolveHostedPrivyClientId } from "@/src/lib/hosted-onboarding/landing";
import { requireHostedPrivyPhoneAuthConfig } from "@/src/lib/hosted-onboarding/privy";

import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

const GITHUB_REPO_URL = "https://github.com/cobuildwithus/murph";

const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
});

const metadataBase = resolveMetadataBase();

export const metadata: Metadata = metadataBase
  ? {
      metadataBase,
    }
  : {};

export default function RootLayout(input: { children: React.ReactNode }) {
  const { appId: privyAppId } = requireHostedPrivyPhoneAuthConfig();
  const privyClientId = resolveHostedPrivyClientId();

  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body className={outfit.className}>
        <Providers privyAppId={privyAppId} privyClientId={privyClientId}>
          <div className="flex min-h-screen flex-col">
            <div className="flex-1">{input.children}</div>
            <footer className="border-t border-stone-200 bg-cream-dark/60">
              <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-5 text-sm text-stone-500 md:px-12 lg:flex-row lg:items-center lg:justify-between lg:px-16">
                <p className="max-w-2xl leading-relaxed">
                  Murph is open source and licensed under Apache 2.0.
                </p>
                <a
                  href={GITHUB_REPO_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-olive transition-colors hover:text-stone-900"
                >
                  View the code on GitHub
                </a>
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
