import Link from "next/link";
import Image from "next/image";

import {
  ComparisonDirectory,
  type ComparisonDirectoryItem,
} from "@/src/components/comparisons/comparison-directory";
import { ComparisonLogo } from "@/src/components/comparisons/comparison-logo";
import {
  formatComparisonDate,
  type ComparisonEntry,
} from "@/src/lib/comparisons/types";

const HERO_LOGOS = [
  { name: "WHOOP", slug: "whoop" },
  { name: "Oura Ring", slug: "oura-ring" },
  { name: "Function Health", slug: "function-health" },
  { name: "Fitbod", slug: "fitbod" },
  { name: "MyFitnessPal", slug: "myfitnesspal" },
  { name: "Headspace", slug: "headspace" },
  { name: "BodyBuddy", slug: "bodybuddy" },
  { name: "CommonHealth", slug: "commonhealth" },
] as const;

function ComparisonLogoMap() {
  return (
    <div
      aria-label="Murph compared with health tools across wearables, labs, fitness, nutrition, and coaching"
      className="relative mx-auto w-full max-w-[460px]"
      role="img"
    >
      <div aria-hidden="true" className="absolute inset-[12%] rounded-full border border-[#c4a882]/15" />
      <div aria-hidden="true" className="absolute inset-[26%] rounded-full border border-[#c4a882]/25" />
      <div className="relative grid aspect-[1.12] grid-cols-3 grid-rows-3 place-items-center gap-3 sm:gap-4">
        {HERO_LOGOS.slice(0, 4).map((logo, index) => (
          <ComparisonLogo
            className={`z-10 size-[78px] rounded-2xl border border-[#c4a882]/22 bg-[#f5f0e8] p-4 text-[#2d3436] sm:size-[92px] ${
              index === 0 ? "-rotate-3" : index === 2 ? "rotate-3" : ""
            }`}
            decorative
            imageClassName="max-h-11"
            key={logo.slug}
            name={logo.name}
            slug={logo.slug}
          />
        ))}
        <span className="z-20 flex size-[102px] items-center justify-center rounded-[1.6rem] border border-[#c4a882]/45 bg-[#efe7d9] p-6 sm:size-[122px] sm:p-7">
          <Image
            alt="Murph"
            className="h-auto w-full"
            height={44}
            priority
            src="/logo-mark.svg"
            width={65}
          />
        </span>
        {HERO_LOGOS.slice(4).map((logo, index) => (
          <ComparisonLogo
            className={`z-10 size-[78px] rounded-2xl border border-[#c4a882]/22 bg-[#f5f0e8] p-4 text-[#2d3436] sm:size-[92px] ${
              index === 1 ? "-rotate-3" : index === 3 ? "rotate-3" : ""
            }`}
            decorative
            imageClassName="max-h-11"
            key={logo.slug}
            name={logo.name}
            slug={logo.slug}
          />
        ))}
      </div>
    </div>
  );
}

export function ComparisonIndex({ comparisons }: { comparisons: readonly ComparisonEntry[] }) {
  const lastVerified = comparisons.reduce(
    (latest, comparison) =>
      comparison.lastVerified > latest ? comparison.lastVerified : latest,
    comparisons[0]?.lastVerified ?? "2026-08-30",
  );
  const directoryItems: ComparisonDirectoryItem[] = comparisons.map(
    ({ aliases, category, headline, name, slug }) => ({
      aliases,
      category,
      headline,
      name,
      slug,
    }),
  );

  return (
    <main className="bg-[#f5f0e8] text-[#2d3436]">
      <header className="bg-[#2a2520] px-5 pb-14 pt-28 text-[#f5f0e8] sm:px-8 sm:pb-18 sm:pt-32 lg:px-12 lg:pb-20 lg:pt-36">
        <div className="mx-auto max-w-[1080px]">
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.8fr)] lg:gap-16">
            <div>
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#c4a882]">
                {comparisons.length} source-backed guides
              </p>
              <h1 className="mt-5 max-w-[12ch] text-balance font-serif text-[clamp(3rem,7vw,5.5rem)] font-semibold leading-[0.9] tracking-[-0.045em]">
                Your health is bigger than one app.
              </h1>
              <p className="mt-7 max-w-[49ch] text-pretty text-[0.98rem] leading-7 text-[#f5f0e8]/72 sm:text-[1.05rem]">
                See what each tool does best, and where Murph fits alongside it.
              </p>
            </div>
            <ComparisonLogoMap />
          </div>
          <p className="mt-10 border-t border-[#c4a882]/35 pt-5 text-[0.74rem] leading-5 text-[#f5f0e8]/55">
            {comparisons.length} comparison guides
            {" · "}Official-source desk research
            {" · "}Reviewed <time dateTime={lastVerified}>{formatComparisonDate(lastVerified)}</time>
            {" · "}No affiliate links
          </p>
        </div>
      </header>

      <div className="px-5 py-14 sm:px-8 sm:py-18 lg:px-12 lg:py-22">
        <div className="mx-auto grid min-w-0 max-w-[1080px] grid-cols-[minmax(0,1fr)] gap-18">
          <ComparisonDirectory comparisons={directoryItems} />

          <section className="grid gap-6 border-t border-[#c4a882]/35 pt-12 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-16">
            <h2 className="font-serif text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.025em]">
              No universal winner
            </h2>
            <p className="max-w-[66ch] text-[0.98rem] leading-7 text-[#4d4533]">
              Wearables measure. Clinicians diagnose and treat. A focused app may do one job better than Murph does. Murph ties those pieces together and helps you act on them, and these guides say plainly where each product stops.
            </p>
          </section>

          <section className="grid gap-6 border-t border-[#c4a882]/35 pt-10 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-16" id="methodology">
            <h2 className="font-serif text-[clamp(1.6rem,3vw,2.25rem)] font-semibold leading-[1.05] tracking-[-0.025em]">
              How these guides are made
            </h2>
            <div className="grid max-w-[66ch] gap-4 text-[0.92rem] leading-7 text-[#4d4533]">
              <p>
                Product facts come from each company's own product, support, pricing, legal, or app store pages. When we infer something, we say so. We do not claim hands-on testing we did not do.
              </p>
              <p>
                Products change, so every guide shows its review date and sources. Claims about Murph follow our{" "}
                <Link className="underline decoration-[#c4a882] underline-offset-4 hover:text-[#5a6e32]" href="/about">
                  public product description
                </Link>
                {" "}and{" "}
                <Link className="underline decoration-[#c4a882] underline-offset-4 hover:text-[#5a6e32]" href="/legal/health-ai-safety-disclosure">
                  health AI safety disclosure
                </Link>
                . If a cited product changes, please{" "}
                <Link className="underline decoration-[#c4a882] underline-offset-4 hover:text-[#5a6e32]" href="/contact">
                  send a correction
                </Link>
                .
              </p>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
