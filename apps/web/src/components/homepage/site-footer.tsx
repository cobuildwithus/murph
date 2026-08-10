import Link from "next/link";

import { MURPH_SUPPORT_EMAIL } from "@/src/components/support/contact-support-action";
import {
  getAvailableHostedPublicReferralRewards,
} from "@/src/lib/hosted-growth/referral-program";

import { SiteFooterVitals } from "./site-footer-vitals";

function GitHubIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

const footerLinks = {
  murph: [
    { label: "Clubs", href: "/clubs", external: false },
    { label: "Referrals", href: "/refer", external: false },
    { label: "Changelog", href: "/changelog", external: false },
    {
      label: "iOS app",
      href: "https://apps.apple.com/us/app/murph-ai/id6786145859",
      external: true,
    },
    {
      label: "Status",
      href: "https://status.withmurph.ai",
      external: true,
    },
    { label: "Design", href: "/design", external: false },
    { label: "Security", href: "/security", external: false },
    {
      label: "Support",
      href: `mailto:${MURPH_SUPPORT_EMAIL}`,
      external: false,
    },
    {
      label: "GitHub",
      href: "https://github.com/cobuildwithus/murph",
      external: true,
    },
  ],
  legal: [
    { label: "Terms of Use", href: "/legal/terms" },
    { label: "Privacy Policy", href: "/legal/privacy" },
    { label: "Consumer Health Data", href: "/consumer-health-data-privacy-policy" },
    { label: "Subprocessors", href: "/subprocessors" },
  ],
};

export function SiteFooter({
  id = "site-footer",
  referralsAvailable = getAvailableHostedPublicReferralRewards().length > 0,
}: {
  id?: string;
  referralsAvailable?: boolean;
}) {
  const productLinks = referralsAvailable
    ? footerLinks.murph
    : footerLinks.murph.filter(({ href }) => href !== "/refer");

  return (
    <footer id={id} className="border-t border-[rgba(196,168,130,0.25)] bg-[#f5f0e8] px-6 sm:px-10 lg:px-16">
      <div className="mx-auto max-w-[1080px]">
        {/* Logo + link columns */}
        <div className="flex flex-col gap-10 py-10 sm:flex-row sm:justify-between">
          <div className="flex flex-col items-start gap-8">
            <Link href="/" aria-label="Murph home">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.svg" alt="Murph" width={125} height={28} className="h-7 w-auto" />
            </Link>
            <SiteFooterVitals />
          </div>

          <div className="grid grid-cols-2 gap-x-20 gap-y-8 sm:gap-x-28">
            <div className="flex flex-col gap-3">
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-[#736a58]">
                Murph
              </span>
              <nav
                className="grid gap-2 sm:grid-flow-col sm:grid-rows-5 sm:gap-x-12 md:grid-rows-4"
                aria-label="Product links"
              >
                {productLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    {...(link.external
                      ? { target: "_blank", rel: "noreferrer" }
                      : {})}
                    className="inline-flex w-fit py-1 text-[0.875rem] text-[#2d3436] transition-colors hover:text-[#736a58]"
                  >
                    {link.label}
                  </a>
                ))}
              </nav>
            </div>

            <div className="flex flex-col gap-3">
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.11em] text-[#736a58]">
                Legal
              </span>
              <nav className="flex flex-col gap-2" aria-label="Legal links">
                {footerLinks.legal.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="inline-flex w-fit py-1 text-[0.875rem] text-[#2d3436] transition-colors hover:text-[#736a58]"
                  >
                    {link.label}
                  </a>
                ))}
              </nav>
            </div>
          </div>
        </div>

        {/* Medical disclaimer */}
        <p className="border-t border-[rgba(196,168,130,0.25)] py-4 text-[0.75rem] leading-relaxed text-[#736a58]">
          Murph provides educational health information and tools to help you
          understand your data and have better conversations with your clinician.
          It is not intended to diagnose, treat, or prevent diseases or other
          conditions and is not a substitute for professional medical advice. If
          you are or may be pregnant, nursing, have a history of an eating
          disorder, or have another medical condition, please talk to your doctor
          before using Murph.
        </p>

        {/* Bottom bar */}
        <div className="flex flex-col gap-3 border-t border-[rgba(196,168,130,0.25)] py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[0.8125rem] text-[#736a58]">
            Murph &copy; 2025&ndash;2026
          </p>
          <div className="flex items-center gap-5">
            <a
              href="https://x.com/withmurphai"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 min-w-10 items-center justify-center text-[#2d3436]/70 transition-colors hover:text-[#2d3436]"
              aria-label="Murph on X"
            >
              <XIcon />
            </a>
            <a
              href="https://github.com/cobuildwithus/murph"
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-10 min-w-10 items-center justify-center text-[#2d3436]/70 transition-colors hover:text-[#2d3436]"
              aria-label="Murph on GitHub"
            >
              <GitHubIcon />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
