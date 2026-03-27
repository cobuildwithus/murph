import type { Metadata } from "next";
import { Outfit } from "next/font/google";

import "./globals.css";

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
  return (
    <html lang="en">
      <body className={outfit.className}>{input.children}</body>
    </html>
  );
}

function resolveMetadataBase(): URL | null {
  const value = process.env.HOSTED_ONBOARDING_PUBLIC_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL;

  if (!value) {
    return null;
  }

  try {
    return new URL(value);
  } catch {
    return null;
  }
}
