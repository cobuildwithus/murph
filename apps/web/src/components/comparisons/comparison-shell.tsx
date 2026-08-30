import Link from "next/link";

import { SiteFooter } from "@/src/components/homepage/site-footer";

export function ComparisonSiteHeader() {
  return (
    <header className="border-b border-[#c4a882]/30 bg-[#f5f0e8] px-5 sm:px-8 lg:px-12">
      <div className="mx-auto flex min-h-20 max-w-[1080px] items-center justify-between gap-6">
        <Link aria-label="Murph home" className="inline-flex items-center" href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="Murph" className="h-6 w-auto" height={24} src="/logo.svg" width={107} />
        </Link>
        <nav aria-label="Public navigation" className="flex items-center gap-5 sm:gap-7">
          <Link
            className="hidden text-sm text-[#4d4533] transition-colors hover:text-[#2d3436] sm:inline"
            href="/compare"
          >
            Comparisons
          </Link>
          <Link
            className="hidden text-sm text-[#4d4533] transition-colors hover:text-[#2d3436] md:inline"
            href="/about"
          >
            About
          </Link>
          <Link
            className="inline-flex min-h-10 items-center rounded-xl bg-[#5a6e32] px-4 text-sm font-semibold text-[#f5f0e8] transition-colors hover:bg-[#485928]"
            href="/#pricing"
          >
            Meet Murph
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function ComparisonPageShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ComparisonSiteHeader />
      {children}
      <SiteFooter />
    </>
  );
}

