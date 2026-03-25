import type { Metadata } from "next";

const metadataBase = resolveMetadataBase();

export const metadata: Metadata = metadataBase
  ? {
      metadataBase,
    }
  : {};

export default function RootLayout(input: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{input.children}</body>
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
