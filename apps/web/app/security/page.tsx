import type { Metadata } from "next";

import { SiteFooter } from "@/src/components/homepage/site-footer";
import { getMurphGithubStarCount } from "@/src/lib/github-stars";
import { resolveHostedInstallScriptUrl } from "@/src/lib/hosted-onboarding/landing";
import { getHostedPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { createMurphPageMetadata } from "@/src/lib/site-metadata";

import { StickyNav } from "../sticky-nav";

const SECURITY_METADATA_DESCRIPTION =
  "How Murph protects hosted and local health data. Hosted architecture, encryption, auth, and the local self-hosted lane.";
const HOSTED_INSTALL_SCRIPT_URL_FALLBACK = "https://www.withmurph.ai/install.sh";
const SECURITY_OPEN_GRAPH_IMAGE = {
  alt: "Murph Security. How Murph protects health data.",
  height: 630,
  type: "image/png",
  url: "/security/opengraph-image",
  width: 1200,
} as const;

export const metadata: Metadata = createMurphPageMetadata({
  title: "Security · Murph",
  description: SECURITY_METADATA_DESCRIPTION,
  alternates: {
    canonical: "/security",
  },
  openGraph: {
    images: [SECURITY_OPEN_GRAPH_IMAGE],
    type: "article",
  },
  twitter: {
    description:
      "How Murph protects hosted and local health data.",
    images: [SECURITY_OPEN_GRAPH_IMAGE],
  },
});

export default async function SecurityPage() {
  const [{ authenticated }, githubStarCount] = await Promise.all([
    getHostedPageAuthSnapshot(),
    getMurphGithubStarCount(),
  ]);
  const installCommandUrl =
    resolveHostedInstallScriptUrl() ?? HOSTED_INSTALL_SCRIPT_URL_FALLBACK;

  return (
    <>
      <main className="isolate min-h-dvh bg-[#f5f0e8] antialiased">
        <StickyNav authenticated={authenticated} darkTop githubStarCount={githubStarCount} />
        <HeroSection />
        <PromisesSection />
        <HostedOverviewSection />
        <EncryptionSection />
        <LocalSection installCommandUrl={installCommandUrl} />
      </main>
      <SiteFooter />
    </>
  );
}

function HeroSection() {
  return (
    <section aria-labelledby="security-hero-title" className="bg-[#2a2520] px-6 pt-28 pb-20 sm:px-10 sm:pt-32 lg:px-16 lg:pt-40 lg:pb-28">
      <div className="mx-auto grid max-w-[1200px] items-center gap-x-16 gap-y-12 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <div className="flex items-center gap-4">
            <span aria-hidden="true" className="h-px w-12 bg-[#c4a882]/60" />
            <p className="font-mono text-[10px] font-medium tracking-[0.18em] text-[#c4a882] uppercase">
              Security
            </p>
          </div>
          <h1 className="mt-8 max-w-[18ch] font-serif text-[clamp(2.5rem,6vw,4.5rem)] font-semibold leading-[1] tracking-[-0.035em] text-balance text-[#f5f0e8]" id="security-hero-title">
            How Murph{" "}
            <span className="italic text-[#c4a882]">protects</span> your
            health data.
          </h1>
          <p className="mt-8 max-w-[50ch] text-[1rem] leading-[1.7] text-pretty text-[#f5f0e8]/65 sm:text-[1.0625rem]">
            Murph runs on our servers so you don&apos;t have to install
            anything. Your data is encrypted at rest. When you ask Murph
            to do something, a short-lived worker decrypts what it needs,
            does the job, writes the result back encrypted, and shuts down.
          </p>
          <p className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[10px] tracking-[0.14em] text-[#f5f0e8]/55 uppercase">
            <span>Open source</span>
            <span aria-hidden="true">&middot;</span>
            <span>Apache 2.0</span>
            <span aria-hidden="true">&middot;</span>
            <a
              className="-my-3 inline-block py-3 underline decoration-[#c4a882]/60 decoration-1 underline-offset-[3px] transition-colors focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c4a882] hover:text-[#f5f0e8] hover:decoration-[#c4a882]"
              href="https://github.com/cobuildwithus/murph"
              rel="noopener noreferrer"
              target="_blank"
            >
              Inspect the code
            </a>
          </p>
        </div>
        <HeroVaultGlyph className="mx-auto w-full max-w-[380px] text-[#c4a882]" />
      </div>
    </section>
  );
}

const PROMISES: readonly { body: React.ReactNode; Glyph: typeof PromiseNoSellGlyph; title: string }[] = [
  {
    body: "Advertisers, insurers, and data brokers get the same answer: no. You pay us, so we work for you, not them.",
    Glyph: PromiseNoSellGlyph,
    title: "We don't sell your data.",
  },
  {
    body: "Your data is encrypted at rest. When you ask Murph to do something, a short-lived worker decrypts what it needs, does the job, writes the result back encrypted, and shuts down.",
    Glyph: PromiseEphemeralKeyGlyph,
    title: "We limit readable processing.",
  },
  {
    body: "Export the whole thing as plain files whenever you want. You can ask us to delete hosted copies, subject to the limited retention described in the privacy policy for legal, security, backup, dispute, and service needs.",
    Glyph: PromiseExportDeleteGlyph,
    title: "Take it out or delete it, any time.",
  },
  {
    body: (<>Murph&#39;s product and runtime code is public. <a className="underline underline-offset-4 decoration-[#c4a882]/60 transition-colors hover:text-[#2d3436]" href="https://github.com/cobuildwithus/murph" rel="noopener noreferrer" target="_blank">Read it yourself</a>, or hand it to a developer you trust.</>),
    Glyph: PromiseOpenSourceGlyph,
    title: "Open source. See for yourself.",
  },
];

function PromisesSection() {
  return (
    <section aria-labelledby="security-promises-title" className="bg-[#ebdfc6] px-6 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-28">
      <div className="mx-auto max-w-[1080px]">
        <div className="flex items-center gap-4">
          <span aria-hidden="true" className="h-px w-12 bg-[#3a4a1e]/70" />
          <p className="font-mono text-[10px] font-medium tracking-[0.18em] text-[#3a4a1e] uppercase">
            What we promise
          </p>
        </div>
        <h2 className="mt-6 max-w-[22ch] font-serif text-[clamp(1.75rem,4vw,3rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-balance text-[#2d3436]" id="security-promises-title">
          Here&apos;s what you can count on.
        </h2>
        <p className="mt-6 max-w-[58ch] text-[1rem] leading-[1.7] text-pretty text-[#4d4533]">
          Security matters only if we don&apos;t sell what we protect. Four
          things we stand by, in plain words.
        </p>

        <dl className="mt-16 grid gap-x-14 gap-y-12 md:grid-cols-2">
          {PROMISES.map((promise) => (
            <div key={promise.title}>
              <div className="flex items-center gap-4">
                <promise.Glyph className="h-10 w-10 shrink-0 text-[#2d3436]" tight />
                <dt className="font-serif text-[1.25rem] font-semibold leading-[1.25] tracking-[-0.015em] text-[#2d3436]">
                  {promise.title}
                </dt>
              </div>
              <dd className="mt-4 text-[0.9375rem] leading-[1.65] text-pretty text-[#4d4533]">
                {promise.body}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function CornerTicks() {
  return (
    <g stroke="currentColor" strokeOpacity="0.5" strokeWidth="0.8">
      <line x1="8" x2="14" y1="8" y2="8" />
      <line x1="8" x2="8" y1="8" y2="14" />
      <line x1="72" x2="66" y1="8" y2="8" />
      <line x1="72" x2="72" y1="8" y2="14" />
      <line x1="8" x2="14" y1="72" y2="72" />
      <line x1="8" x2="8" y1="72" y2="66" />
      <line x1="72" x2="66" y1="72" y2="72" />
      <line x1="72" x2="72" y1="72" y2="66" />
    </g>
  );
}

function PromiseNoSellGlyph({ className, tight }: { className?: string; tight?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox={tight ? "14 14 52 52" : "0 0 80 80"}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="40" cy="44" r="22" stroke="currentColor" strokeWidth="1" />
      <circle cx="40" cy="44" r="14" stroke="currentColor" strokeOpacity="0.4" strokeWidth="0.6" />
      <text
        className="font-serif"
        fill="currentColor"
        fontSize="18"
        fontWeight="600"
        textAnchor="middle"
        x="40"
        y="51"
      >
        $
      </text>
      <line
        stroke="currentColor"
        strokeWidth="1.6"
        x1="18"
        x2="62"
        y1="22"
        y2="66"
      />
      {!tight && <CornerTicks />}
    </svg>
  );
}

function PromiseEphemeralKeyGlyph({ className, tight }: { className?: string; tight?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox={tight ? "14 24 52 32" : "0 0 80 80"}
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="24" cy="40" r="10" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="24" cy="40" fill="currentColor" r="2.2" />
      <line stroke="currentColor" strokeWidth="1.4" x1="34" x2="50" y1="40" y2="40" />
      <line stroke="currentColor" strokeWidth="1.4" x1="42" x2="42" y1="40" y2="46" />
      <line stroke="currentColor" strokeWidth="1.4" x1="48" x2="48" y1="40" y2="46" />
      <line
        stroke="currentColor"
        strokeDasharray="3,3"
        strokeOpacity="0.6"
        strokeWidth="1"
        x1="52"
        x2="68"
        y1="40"
        y2="40"
      />
      <circle cx="72" cy="40" fill="currentColor" fillOpacity="0.3" r="1" />
      {!tight && <CornerTicks />}
    </svg>
  );
}

function PromiseExportDeleteGlyph({ className, tight }: { className?: string; tight?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox={tight ? "10 16 60 48" : "0 0 80 80"}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <marker id="promise-arrow" markerHeight="6" markerWidth="8" orient="auto" refX="7" refY="3">
          <polygon fill="currentColor" points="0 0, 8 3, 0 6" />
        </marker>
      </defs>
      <rect height="14" rx="2" stroke="currentColor" strokeWidth="1" width="18" x="12" y="20" />
      <line stroke="currentColor" strokeOpacity="0.5" strokeWidth="0.6" x1="16" x2="26" y1="25" y2="25" />
      <line stroke="currentColor" strokeOpacity="0.5" strokeWidth="0.6" x1="16" x2="26" y1="29" y2="29" />
      <line
        markerEnd="url(#promise-arrow)"
        stroke="currentColor"
        strokeWidth="1.2"
        x1="34"
        x2="62"
        y1="27"
        y2="27"
      />
      <line
        markerEnd="url(#promise-arrow)"
        stroke="currentColor"
        strokeWidth="1.2"
        x1="12"
        x2="40"
        y1="53"
        y2="53"
      />
      <rect height="14" rx="2" stroke="currentColor" strokeWidth="1" width="18" x="44" y="46" />
      <line stroke="currentColor" strokeWidth="1" x1="48" x2="58" y1="50" y2="56" />
      <line stroke="currentColor" strokeWidth="1" x1="58" x2="48" y1="50" y2="56" />
      {!tight && <CornerTicks />}
    </svg>
  );
}

function PromiseOpenSourceGlyph({ className, tight }: { className?: string; tight?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox={tight ? "14 18 52 44" : "0 0 80 80"}
      xmlns="http://www.w3.org/2000/svg"
    >
      <polyline
        points="30,24 18,40 30,56"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <polyline
        points="50,24 62,40 50,56"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
      <line
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
        x1="44"
        x2="36"
        y1="22"
        y2="58"
      />
      {!tight && <CornerTicks />}
    </svg>
  );
}

function HeroVaultGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 380 380"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g stroke="currentColor" strokeOpacity="0.5" strokeWidth="0.8">
        <line x1="40" x2="60" y1="40" y2="40" />
        <line x1="40" x2="40" y1="40" y2="60" />
        <line x1="340" x2="320" y1="40" y2="40" />
        <line x1="340" x2="340" y1="40" y2="60" />
        <line x1="40" x2="60" y1="340" y2="340" />
        <line x1="40" x2="40" y1="340" y2="320" />
        <line x1="340" x2="320" y1="340" y2="340" />
        <line x1="340" x2="340" y1="340" y2="320" />
      </g>

      <rect height="220" rx="10" stroke="currentColor" strokeWidth="1.2" width="220" x="80" y="80" />
      <rect height="200" rx="8" stroke="currentColor" strokeOpacity="0.35" strokeWidth="0.6" width="200" x="90" y="90" />

      <circle cx="190" cy="170" r="52" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="190" cy="170" r="44" stroke="currentColor" strokeOpacity="0.4" strokeWidth="0.6" />
      <circle cx="190" cy="170" fill="currentColor" r="5" />

      <g stroke="currentColor" strokeWidth="1">
        <line x1="190" x2="190" y1="110" y2="120" />
        <line x1="250" x2="240" y1="170" y2="170" />
        <line x1="190" x2="190" y1="230" y2="220" />
        <line x1="130" x2="140" y1="170" y2="170" />
      </g>
      <g stroke="currentColor" strokeOpacity="0.5" strokeWidth="0.8">
        <line x1="232" x2="226" y1="128" y2="134" />
        <line x1="232" x2="226" y1="212" y2="206" />
        <line x1="148" x2="154" y1="212" y2="206" />
        <line x1="148" x2="154" y1="128" y2="134" />
      </g>

      <line stroke="currentColor" strokeWidth="2" x1="110" x2="270" y1="260" y2="260" />
      <circle cx="110" cy="260" fill="currentColor" r="4" />
      <circle cx="270" cy="260" fill="currentColor" r="4" />

      <line stroke="currentColor" strokeOpacity="0.3" strokeWidth="0.6" x1="80" x2="300" y1="326" y2="326" />
      <text className="font-mono" fill="currentColor" fillOpacity="0.6" fontSize="9" letterSpacing="0.24em" textAnchor="middle" x="190" y="344">
        ENCRYPTED &middot; SHORT-LIVED
      </text>
    </svg>
  );
}

const HOSTED_LEGEND = [
  {
    body: "Your name, email, and login. We use keyed lookup fingerprints instead of raw email for account lookup, and sensitive account fields are encrypted so a database leak is much less useful without the keys.",
    kind: "box-paper",
    title: "Your account",
  },
  {
    body: "A short-lived worker that spins up for one task, then disappears when it's done.",
    kind: "box-sage",
    title: "The runner",
  },
  {
    body: "Your health records, encrypted at rest. A worker decrypts what it needs for a task, then writes the result back encrypted.",
    kind: "box-neutral",
    title: "Your files",
  },
  {
    body: "The task we send to the runner. Encrypted before it leaves our database.",
    kind: "arrow-accent",
    title: "Encrypted task",
  },
  {
    body: "Every message between these services is signed. Fakes get rejected before they touch your data.",
    kind: "arrow-muted",
    title: "Signed request",
  },
] as const;

type LegendKind = (typeof HOSTED_LEGEND)[number]["kind"];

const LEGEND_BOX_STYLES: Record<"box-paper" | "box-sage" | "box-neutral", { fill: string; stroke: string; strokeWidth: number }> = {
  "box-paper": { fill: "#fffcf6", stroke: "#9b8e77", strokeWidth: 1 },
  "box-sage": { fill: "rgba(90,110,50,0.08)", stroke: "#5a6e32", strokeWidth: 1.2 },
  "box-neutral": { fill: "rgba(45,52,54,0.04)", stroke: "#736a58", strokeWidth: 1 },
};

const LEGEND_ARROW_STYLES: Record<"arrow-accent" | "arrow-muted", { color: string; width: number }> = {
  "arrow-accent": { color: "#5a6e32", width: 1.4 },
  "arrow-muted": { color: "#736a58", width: 1 },
};

function LegendSwatch({ kind }: { kind: LegendKind }) {
  if (kind in LEGEND_BOX_STYLES) {
    const style = LEGEND_BOX_STYLES[kind as keyof typeof LEGEND_BOX_STYLES];
    return (
      <svg aria-hidden="true" className="shrink-0" height="18" viewBox="0 0 28 18" width="28">
        <rect fill={style.fill} height="14" rx="2" stroke={style.stroke} strokeWidth={style.strokeWidth} width="24" x="2" y="2" />
      </svg>
    );
  }
  const arrow = LEGEND_ARROW_STYLES[kind as keyof typeof LEGEND_ARROW_STYLES];
  return (
    <svg aria-hidden="true" className="shrink-0" height="18" viewBox="0 0 28 18" width="28">
      <line stroke={arrow.color} strokeWidth={arrow.width} x1="2" x2="18" y1="9" y2="9" />
      <polygon fill={arrow.color} points="18,5 24,9 18,13" />
    </svg>
  );
}

function HostedOverviewSection() {
  return (
    <section aria-labelledby="security-hosted-title" className="px-6 pt-12 pb-20 sm:px-10 sm:pt-16 sm:pb-24 lg:px-16 lg:pt-20 lg:pb-28" id="hosted">
      <div className="mx-auto max-w-[1080px]">
        <p className="font-mono text-[10px] font-medium tracking-[0.12em] text-[#5a6e32] uppercase">
          How it works
        </p>
        <h2 className="mt-6 max-w-[22ch] font-serif text-[clamp(1.75rem,4vw,3rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-balance text-[#2d3436]" id="security-hosted-title">
          Your data is encrypted and separated by purpose.
        </h2>
        <p className="mt-6 max-w-[58ch] font-serif text-[1rem] leading-[1.65] text-pretty text-[#4d4533] italic">
          Murph separates account records, encrypted data, and short-lived
          workspaces. Each piece handles what it needs for sign-in, billing,
          syncing, or running a task.
        </p>

        <div className="relative mt-10">
          <div className="md:hidden">
            <ArchitectureDiagramMobile />
          </div>
          <div
            aria-label="Scrollable architecture diagram"
            className="hidden overflow-x-auto md:block"
            role="region"
            tabIndex={0}
          >
            <ArchitectureDiagram />
          </div>
        </div>

        <div className="mt-12">
          <p className="font-mono text-[10px] font-medium tracking-[0.14em] text-[#5a6e32] uppercase">
            What&apos;s what in the diagram
          </p>
          <dl className="mt-5 divide-y divide-[#c4a882]/30 border-y border-[#c4a882]/30">
            {HOSTED_LEGEND.map((item) => (
              <div className="grid items-start gap-4 py-5 md:grid-cols-[220px_1fr] md:gap-10" key={item.title}>
                <div className="flex items-center gap-3">
                  <LegendSwatch kind={item.kind} />
                  <dt className="font-serif text-[1.0625rem] font-semibold text-[#2d3436]">
                    {item.title}
                  </dt>
                </div>
                <dd className="text-[0.9375rem] leading-[1.65] text-pretty text-[#635a48]">
                  {item.body}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

const ENCRYPTION_FIELDS = [
  {
    body: "Whatever Murph sends to the runner to do a task, plus the files and results it produces.",
    detail: "per-task key",
    label: "Task data",
  },
  {
    body: "Phone, email, wallet address, and the IDs we use to sign you in.",
    detail: "scoped keys",
    label: "Account & logins",
  },
  {
    body: "Stripe customer references and the tokens we use to sync your wearables.",
    detail: "scoped keys",
    label: "Billing & devices",
  },
  {
    body: "When your browser needs data to show you something, it gets a trimmed copy locked with a one-time key.",
    detail: "one-time key",
    label: "Browser copies",
  },
] as const;

const ENCRYPTION_META = [
  { label: "Method", value: "AES-256-GCM" },
  { label: "Keys", value: "Scoped · rotatable" },
  { label: "Storage", value: "Encrypted at rest" },
  { label: "Lookups", value: "Scrambled, not raw" },
] as const;

function EncryptionSection() {
  return (
    <section
      aria-labelledby="security-encryption-title"
      className="bg-[#efe7d8] px-6 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-28"
      id="encryption"
    >
      <div className="mx-auto max-w-[1080px]">
        <div className="grid gap-x-14 gap-y-10 lg:grid-cols-[1fr_1.3fr]">
          <div className="lg:sticky lg:top-20 lg:self-start">
            <p className="font-mono text-[10px] font-medium tracking-[0.12em] text-[#5a6e32] uppercase">
              Encryption
            </p>
            <h2 className="mt-5 max-w-[16ch] font-serif text-[clamp(1.75rem,4vw,2.75rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-balance text-[#2d3436]" id="security-encryption-title">
              What we encrypt.
            </h2>
            <p className="mt-5 max-w-[44ch] text-[0.9375rem] leading-[1.65] text-pretty text-[#635a48] sm:text-[1rem]">
              Your data is encrypted at rest. When you ask Murph to do
              something, a short-lived worker decrypts what it needs, does
              the job, and discards the workspace. The crypto card below
              is for technical readers.
            </p>
            <div className="mt-8 rounded-2xl border border-[#c4a882]/25 bg-[#fffcf6] p-5">
              <p className="font-mono text-[10px] font-medium tracking-[0.12em] text-[#5a6e32] uppercase">
                For the technical reader
              </p>
              <dl className="mt-4 space-y-3 font-mono text-[12px]">
                {ENCRYPTION_META.map((item) => (
                  <div
                    className="flex items-baseline justify-between gap-6"
                    key={item.label}
                  >
                    <dt className="text-[#736a58]">{item.label}</dt>
                    <dd className="text-[#2d3436]">{item.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          <ul className="space-y-3">
            {ENCRYPTION_FIELDS.map((field) => (
              <li
                className="rounded-xl border border-[#2d3436]/10 p-5"
                key={field.label}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <p className="font-mono text-[10px] font-medium tracking-[0.12em] text-[#5a6e32] uppercase">
                    {field.label}
                  </p>
                  <span className="font-mono text-[10px] tracking-[0.06em] text-[#736a58]">
                    {field.detail}
                  </span>
                </div>
                <p className="mt-3 text-[0.9375rem] leading-[1.55] text-pretty text-[#2d3436]">
                  {field.body}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

const LOCAL_SOURCE_REFS = [
  {
    href: "https://github.com/cobuildwithus/murph/blob/main/ARCHITECTURE.md",
    text: "ARCHITECTURE.md",
  },
  {
    href: "https://github.com/cobuildwithus/murph/blob/main/apps/web/src/lib/hosted-web/encryption.ts",
    text: "hosted-web/encryption.ts",
  },
  {
    href: "https://github.com/cobuildwithus/murph/blob/main/apps/web/src/lib/hosted-onboarding/contact-privacy-core.ts",
    text: "contact-privacy-core.ts",
  },
  {
    href: "https://github.com/cobuildwithus/murph/blob/main/apps/web/src/lib/hosted-execution/cloudflare-callback-auth.ts",
    text: "cloudflare-callback-auth.ts",
  },
] as const;

function LocalSection({ installCommandUrl }: { installCommandUrl: string }) {
  return (
    <section
      aria-labelledby="security-local-title"
      className="bg-[#2a2520] px-4 py-20 sm:px-6 sm:py-24 lg:px-10 lg:py-28"
      id="local"
    >
      <div className="mx-auto max-w-[1120px]">
        <div className="rounded-3xl bg-[#dfe4cf] px-6 py-14 sm:px-10 sm:py-20 lg:px-14">
          <p className="font-mono text-[10px] font-medium tracking-[0.14em] text-[#3a4a1e] uppercase">
            Local Murph &middot; for developers
          </p>
          <h2 className="mt-6 max-w-[24ch] font-serif text-[clamp(1.75rem,4vw,3rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-balance text-[#2d3436]" id="security-local-title">
            Or run the whole thing yourself.
          </h2>
          <p className="mt-6 max-w-[58ch] text-[1rem] leading-[1.7] text-pretty text-[#4d4533]">
            If you do not want your Murph vault on Murph-hosted servers, run
            Murph on your own machine. Local Murph keeps your vault as files
            on your disk, protected by your operating system and whatever disk
            encryption you use.
          </p>
          <div className="mt-14 grid gap-x-16 gap-y-10 lg:grid-cols-[1.1fr_1fr]">
            <div className="overflow-x-auto">
              <VaultTreeDiagram />
            </div>
            <LocalInfoList installCommandUrl={installCommandUrl} />
          </div>
        </div>
      </div>
    </section>
  );
}

function LocalInfoList({ installCommandUrl }: { installCommandUrl: string }) {
  return (
    <dl className="space-y-6 lg:pt-4">
      <div className="border-t border-[#2d3436]/15 pt-5">
        <dt className="font-mono text-[10px] font-medium tracking-[0.14em] text-[#3a4a1e] uppercase">
          Storage format
        </dt>
        <dd className="mt-2 text-[0.9375rem] leading-[1.55] text-[#2d3436]">
          Plain Markdown + JSONL under a single vault root. Human-readable,
          grep-able, git-friendly.
        </dd>
      </div>
      <div className="border-t border-[#2d3436]/15 pt-5">
        <dt className="font-mono text-[10px] font-medium tracking-[0.14em] text-[#3a4a1e] uppercase">
          Disk encryption
        </dt>
        <dd className="mt-2 text-[0.9375rem] leading-[1.55] text-[#2d3436]">
          Your filesystem&apos;s posture. FileVault, LUKS, BitLocker. We do
          not add another layer below your OS.
        </dd>
      </div>
      <div className="border-t border-[#2d3436]/15 pt-5">
        <dt className="font-mono text-[10px] font-medium tracking-[0.14em] text-[#3a4a1e] uppercase">
          Install
        </dt>
        <dd className="mt-2 font-mono text-[12px] leading-[1.5] text-[#2d3436]">
          <code className="break-all rounded bg-[#2d3436]/5 px-2 py-1">
            curl -fsSL {installCommandUrl} | bash
          </code>
        </dd>
      </div>
      <div className="border-t border-[#2d3436]/15 pt-5">
        <dt className="font-mono text-[10px] font-medium tracking-[0.14em] text-[#3a4a1e] uppercase">
          Source
        </dt>
        <dd className="mt-2 text-[0.9375rem] leading-[1.55] text-[#2d3436]">
          <a
            className="-my-3 inline-block py-3 underline decoration-[#c4a882]/60 decoration-1 underline-offset-[3px] transition-colors focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5a6e32] hover:text-[#5a6e32]"
            href="https://github.com/cobuildwithus/murph"
            rel="noopener noreferrer"
            target="_blank"
          >
            github.com/cobuildwithus/murph
          </a>
          <span className="ml-2 text-[#736a58]">&middot; Apache 2.0</span>
        </dd>
      </div>
      <div className="border-t border-[#2d3436]/15 pt-5">
        <dt className="font-mono text-[10px] font-medium tracking-[0.14em] text-[#3a4a1e] uppercase">
          Key files
        </dt>
        <dd className="mt-3">
          <ul className="font-mono text-[12px] leading-[1.5]">
            {LOCAL_SOURCE_REFS.map((ref) => (
              <li key={ref.text}>
                <a
                  className="inline-flex min-h-[44px] items-center text-[#2d3436] underline decoration-[#c4a882]/50 decoration-1 underline-offset-[3px] transition-colors focus-visible:rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5a6e32] hover:text-[#5a6e32] hover:decoration-[#5a6e32]/60"
                  href={ref.href}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {ref.text}
                </a>
              </li>
            ))}
          </ul>
        </dd>
      </div>
    </dl>
  );
}


const DIAGRAM_COLORS = {
  ink: "#2d3436",
  inkMuted: "#736a58",
  inkSoft: "#9b8e77",
  inkRule: "rgba(45,52,54,0.12)",
  accent: "#5a6e32",
  accentTint: "rgba(90,110,50,0.08)",
  paper: "#f5f0e8",
  paper2: "#fffcf6",
} as const;

function ArchitectureDiagram() {
  const { ink, inkMuted, inkSoft, inkRule, accent, accentTint, paper, paper2 } = DIAGRAM_COLORS;

  return (
    <svg
      aria-label="Data flows left to right: from you, into your hosted account, then as an encrypted task to a short-lived runner, which opens your encrypted files briefly to do its job and writes the result back."
      className="block w-full min-w-[720px]"
      role="img"
      viewBox="0 90 960 150"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <marker
          id="arr-mute-l"
          markerHeight="6"
          markerWidth="8"
          orient="auto"
          refX="7"
          refY="3"
        >
          <polygon fill={inkMuted} points="0 0, 8 3, 0 6" />
        </marker>
        <marker
          id="arr-acc-l"
          markerHeight="6"
          markerWidth="8"
          orient="auto"
          refX="7"
          refY="3"
        >
          <polygon fill={accent} points="0 0, 8 3, 0 6" />
        </marker>
      </defs>

      <line markerEnd="url(#arr-mute-l)" stroke={inkMuted} strokeWidth="1" x1="228" x2="284" y1="160" y2="160" />
      <line markerEnd="url(#arr-acc-l)" stroke={accent} strokeWidth="1.4" x1="452" x2="508" y1="160" y2="160" />
      <line markerEnd="url(#arr-mute-l)" stroke={inkMuted} strokeWidth="1" x1="676" x2="732" y1="160" y2="160" />

      <g>
        <rect fill="rgba(45,52,54,0.03)" height="120" rx="10" stroke={inkSoft} strokeWidth="1" width="160" x="64" y="100" />
        <text className="font-sans" fill={ink} fontSize="15" fontWeight="600" textAnchor="middle" x="144" y="158">
          You
        </text>
        <line stroke={inkRule} strokeWidth="0.8" x1="88" x2="200" y1="172" y2="172" />
        <text className="font-mono" fill={inkMuted} fontSize="10" textAnchor="middle" x="144" y="192">
          browser · cli
        </text>
      </g>

      <g>
        <rect fill={paper2} height="120" rx="10" stroke={inkSoft} strokeWidth="1" width="160" x="288" y="100" />
        <text className="font-mono" fill={inkMuted} fontSize="10" letterSpacing="0.12em" textAnchor="middle" x="368" y="128">
          DATABASE
        </text>
        <text className="font-sans" fill={ink} fontSize="15" fontWeight="600" textAnchor="middle" x="368" y="164">
          Your account
        </text>
        <line stroke={inkRule} strokeWidth="0.8" x1="312" x2="424" y1="178" y2="178" />
        <text className="font-mono" fill={inkMuted} fontSize="10" textAnchor="middle" x="368" y="198">
          encrypted · minimal
        </text>
      </g>

      <g>
        <rect fill={accentTint} height="120" rx="10" stroke={accent} strokeWidth="1.2" width="160" x="512" y="100" />
        <text className="font-mono" fill={accent} fontSize="10" letterSpacing="0.12em" textAnchor="middle" x="592" y="128">
          SHORT-LIVED WORKER
        </text>
        <text className="font-sans" fill={ink} fontSize="15" fontWeight="600" textAnchor="middle" x="592" y="164">
          The runner
        </text>
        <line stroke="rgba(90,110,50,0.30)" strokeWidth="0.8" x1="536" x2="648" y1="178" y2="178" />
        <text className="font-mono" fill={accent} fontSize="10" textAnchor="middle" x="592" y="198">
          Cloudflare &middot; short-lived
        </text>
      </g>

      <g>
        <rect fill="rgba(45,52,54,0.04)" height="120" rx="10" stroke={inkMuted} strokeWidth="1" width="160" x="736" y="100" />
        <text className="font-mono" fill={inkMuted} fontSize="10" letterSpacing="0.12em" textAnchor="middle" x="816" y="128">
          ENCRYPTED FILES
        </text>
        <text className="font-sans" fill={ink} fontSize="15" fontWeight="600" textAnchor="middle" x="816" y="164">
          Your files
        </text>
        <line stroke={inkRule} strokeWidth="0.8" x1="760" x2="872" y1="178" y2="178" />
        <text className="font-mono" fill={inkMuted} fontSize="10" textAnchor="middle" x="816" y="198">
          encrypted at rest
        </text>
      </g>

      <rect fill={paper} height="14" width="48" x="232" y="138" />
      <text className="font-mono" fill={inkMuted} fontSize="9" letterSpacing="0.1em" textAnchor="middle" x="256" y="149">
        SIGN IN
      </text>
      <rect fill={paper} height="14" width="42" x="459" y="138" />
      <text className="font-mono" fill={accent} fontSize="9" letterSpacing="0.1em" textAnchor="middle" x="480" y="149">
        TASK
      </text>
      <rect fill={paper} height="14" width="48" x="680" y="138" />
      <text className="font-mono" fill={inkMuted} fontSize="9" letterSpacing="0.1em" textAnchor="middle" x="704" y="149">
        RESULT
      </text>

    </svg>
  );
}


function ArchitectureDiagramMobile() {
  const { ink, inkMuted, inkSoft, inkRule, accent, accentTint, paper, paper2 } = DIAGRAM_COLORS;

  return (
    <svg
      aria-label="Data flows top to bottom: from you, into your hosted account, then as an encrypted task to a short-lived runner, which opens your encrypted files briefly to do its job and writes the result back."
      className="mx-auto block w-full max-w-[360px]"
      role="img"
      viewBox="0 0 320 670"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <marker
          id="arr-mute-v"
          markerHeight="6"
          markerWidth="8"
          orient="auto"
          refX="7"
          refY="3"
        >
          <polygon fill={inkMuted} points="0 0, 8 3, 0 6" />
        </marker>
        <marker
          id="arr-acc-v"
          markerHeight="6"
          markerWidth="8"
          orient="auto"
          refX="7"
          refY="3"
        >
          <polygon fill={accent} points="0 0, 8 3, 0 6" />
        </marker>
      </defs>

      <line markerEnd="url(#arr-mute-v)" stroke={inkMuted} strokeWidth="1" x1="160" x2="160" y1="148" y2="182" />
      <line markerEnd="url(#arr-acc-v)" stroke={accent} strokeWidth="1.4" x1="160" x2="160" y1="318" y2="352" />
      <line markerEnd="url(#arr-mute-v)" stroke={inkMuted} strokeWidth="1" x1="160" x2="160" y1="488" y2="522" />

      <g>
        <rect fill="rgba(45,52,54,0.03)" height="120" rx="10" stroke={inkSoft} strokeWidth="1" width="280" x="20" y="20" />
        <text className="font-sans" fill={ink} fontSize="15" fontWeight="600" textAnchor="middle" x="160" y="78">
          You
        </text>
        <line stroke={inkRule} strokeWidth="0.8" x1="44" x2="276" y1="92" y2="92" />
        <text className="font-mono" fill={inkMuted} fontSize="10" textAnchor="middle" x="160" y="112">
          browser · cli
        </text>
      </g>

      <g>
        <rect fill={paper2} height="120" rx="10" stroke={inkSoft} strokeWidth="1" width="280" x="20" y="190" />
        <text className="font-mono" fill={inkMuted} fontSize="10" letterSpacing="0.12em" textAnchor="middle" x="160" y="218">
          DATABASE
        </text>
        <text className="font-sans" fill={ink} fontSize="15" fontWeight="600" textAnchor="middle" x="160" y="254">
          Your account
        </text>
        <line stroke={inkRule} strokeWidth="0.8" x1="44" x2="276" y1="268" y2="268" />
        <text className="font-mono" fill={inkMuted} fontSize="10" textAnchor="middle" x="160" y="288">
          encrypted · minimal
        </text>
      </g>

      <g>
        <rect fill={accentTint} height="120" rx="10" stroke={accent} strokeWidth="1.2" width="280" x="20" y="360" />
        <text className="font-mono" fill={accent} fontSize="10" letterSpacing="0.12em" textAnchor="middle" x="160" y="388">
          SHORT-LIVED WORKER
        </text>
        <text className="font-sans" fill={ink} fontSize="15" fontWeight="600" textAnchor="middle" x="160" y="424">
          The runner
        </text>
        <line stroke="rgba(90,110,50,0.30)" strokeWidth="0.8" x1="44" x2="276" y1="438" y2="438" />
        <text className="font-mono" fill={accent} fontSize="10" textAnchor="middle" x="160" y="458">
          Cloudflare &middot; short-lived
        </text>
      </g>

      <g>
        <rect fill="rgba(45,52,54,0.04)" height="120" rx="10" stroke={inkMuted} strokeWidth="1" width="280" x="20" y="530" />
        <text className="font-mono" fill={inkMuted} fontSize="10" letterSpacing="0.12em" textAnchor="middle" x="160" y="558">
          ENCRYPTED FILES
        </text>
        <text className="font-sans" fill={ink} fontSize="15" fontWeight="600" textAnchor="middle" x="160" y="594">
          Your files
        </text>
        <line stroke={inkRule} strokeWidth="0.8" x1="44" x2="276" y1="608" y2="608" />
        <text className="font-mono" fill={inkMuted} fontSize="10" textAnchor="middle" x="160" y="628">
          encrypted at rest
        </text>
      </g>

      <rect fill={paper} height="14" width="48" x="136" y="158" />
      <text className="font-mono" fill={inkMuted} fontSize="9" letterSpacing="0.1em" textAnchor="middle" x="160" y="169">
        SIGN IN
      </text>
      <rect fill={paper} height="14" width="42" x="139" y="328" />
      <text className="font-mono" fill={accent} fontSize="9" letterSpacing="0.1em" textAnchor="middle" x="160" y="339">
        TASK
      </text>
      <rect fill={paper} height="14" width="48" x="136" y="498" />
      <text className="font-mono" fill={inkMuted} fontSize="9" letterSpacing="0.1em" textAnchor="middle" x="160" y="509">
        RESULT
      </text>
    </svg>
  );
}


const VAULT_TREE = [
  { label: "~/", level: 0, sub: "home" },
  { label: ".murph/", level: 1, sub: "vault root" },
  { label: "health/", level: 2, sub: "biomarkers · labs · body" },
  { label: "experiments/", level: 2, sub: "protocols · runs · outcomes" },
  { label: "journal/", level: 2, sub: "free-text · timestamped" },
  { label: "sources/", level: 2, sub: "cited research · sideloaded docs" },
  { label: "wearables/", level: 2, sub: "oura · whoop · garmin · strava" },
  { label: "config", level: 1, sub: "toml · opinions" },
] as const;

const VAULT_TREE_ROW_H = 36;
const VAULT_TREE_BASE_X = 40;
const VAULT_TREE_INDENT = 32;

function VaultTreeDiagram() {
  const { ink, inkMuted, accent } = DIAGRAM_COLORS;
  const tree = VAULT_TREE;
  const rowH = VAULT_TREE_ROW_H;
  const baseX = VAULT_TREE_BASE_X;
  const indentStep = VAULT_TREE_INDENT;

  return (
    <svg
      aria-label="The local vault root is a directory under your home folder containing plain Markdown and JSONL files grouped by domain: health records, experiment logs, journal, cited research, and raw wearable imports."
      className="block w-full min-w-[400px]"
      role="img"
      viewBox={`0 0 560 ${40 + tree.length * rowH + 40}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <text
        className="font-mono"
        fill={inkMuted}
        fontSize="9"
        letterSpacing="0.14em"
        x={baseX}
        y="20"
      >
        VAULT ROOT
      </text>

      {tree.map((item, i) => {
        const y = 40 + i * rowH;
        const x = baseX + item.level * indentStep;
        const lineColor = i === 0 ? accent : "rgba(45,52,54,0.18)";
        const labelColor = i === 0 ? accent : ink;
        return (
          <g key={item.label}>
            {item.level > 0 ? (
              <>
                <line
                  stroke="rgba(45,52,54,0.25)"
                  strokeWidth="0.8"
                  x1={x - indentStep + 8}
                  x2={x - indentStep + 8}
                  y1={y - rowH + 8}
                  y2={y + 12}
                />
                <line
                  stroke="rgba(45,52,54,0.25)"
                  strokeWidth="0.8"
                  x1={x - indentStep + 8}
                  x2={x - 4}
                  y1={y + 12}
                  y2={y + 12}
                />
              </>
            ) : null}
            <rect
              fill="transparent"
              height="24"
              rx="4"
              stroke={lineColor}
              strokeWidth={i === 0 ? "1" : "0.8"}
              width="150"
              x={x}
              y={y}
            />
            <text
              className="font-mono"
              fill={labelColor}
              fontSize="12"
              fontWeight={i === 0 ? "600" : "500"}
              x={x + 10}
              y={y + 16}
            >
              {item.label}
            </text>
            <text
              className="font-mono"
              fill={inkMuted}
              fontSize="10"
              x={x + 170}
              y={y + 16}
            >
              {item.sub}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
