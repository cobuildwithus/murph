import type { Metadata } from "next";
import Script from "next/script";

import { AuthProvider } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import { VercelTelemetry } from "@/src/components/observability/vercel-telemetry";
import { PhoneCountryCodeProvider } from "@/src/components/hosted-onboarding/phone-country-code-provider";
import { resolveHostedPublicBaseUrl } from "@/src/lib/hosted-web/public-url";
import { getHostedSidebarAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import {
  createMurphPageMetadata,
  MURPH_DEFAULT_METADATA_DESCRIPTION,
  MURPH_DEFAULT_METADATA_TITLE,
  MURPH_DEFAULT_OPEN_GRAPH_DESCRIPTION,
} from "@/src/lib/site-metadata";

import "./globals.css";
import { cn } from "@/src/lib/utils";
import { dmMono, dmSans, fraunces } from "./font-assets";

const DEFAULT_METADATA_BASE_URL = "https://www.withmurph.ai";

const metadataBase = resolveMetadataBase() ?? new URL(DEFAULT_METADATA_BASE_URL);
const defaultMetadata = createMurphPageMetadata({
  description: MURPH_DEFAULT_METADATA_DESCRIPTION,
  openGraph: {
    description: MURPH_DEFAULT_OPEN_GRAPH_DESCRIPTION,
    type: "website",
  },
  title: MURPH_DEFAULT_METADATA_TITLE,
  twitter: {
    description: MURPH_DEFAULT_OPEN_GRAPH_DESCRIPTION,
  },
});

export const metadata: Metadata = {
  ...defaultMetadata,
  metadataBase,
};

export default async function RootLayout(input: { children: React.ReactNode }) {
  const { authenticated } = await getHostedSidebarAuthSnapshot();

  return (
    <html lang="en" className={cn(fraunces.variable, dmSans.variable, dmMono.variable)}>
      <body className="bg-background text-foreground font-sans antialiased">
        <AuthProvider authenticated={authenticated}>
          <PhoneCountryCodeProvider>
            {input.children}
          </PhoneCountryCodeProvider>
        </AuthProvider>
        <VercelTelemetry />
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
