import type { Metadata } from "next";
import { Outfit, Geist } from "next/font/google";

import { resolveHostedPublicBaseUrl } from "@/src/lib/hosted-web/public-url";

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
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body className={outfit.className}>
        <div className="flex min-h-screen flex-col">
          <div className="flex-1">{input.children}</div>
          <footer className="border-t border-stone-200 bg-cream-dark/60">
            <div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-5 text-sm text-stone-500 md:px-12 lg:flex-row lg:items-center lg:justify-between lg:px-16">
              <p className="max-w-2xl leading-relaxed">
                Murph is open source and licensed under GPL 3.0.
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
