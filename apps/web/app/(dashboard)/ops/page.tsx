import type { Metadata } from "next";
import Link from "next/link";

import { requireHostedOpsPageAccess } from "@/src/lib/hosted-ops/access";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
  },
  title: "Ops - Murph",
};

const OPS_TOOLS = [
  {
    description:
      "Inspect per-member and group-container inbound message volume, AI usage, and safely reset current included usage.",
    href: "/ops/usage",
    label: "Usage",
  },
  {
    description: "Review hosted growth, starter activation, paid conversion, and daily revenue snapshots.",
    href: "/ops/growth",
    label: "Growth",
  },
  {
    description: "Wake checkpointed hosted workspaces and run runtime support diagnostics.",
    href: "/ops/runtime-maintenance",
    label: "Runtime maintenance",
  },
  {
    description: "Inspect hosted runtime latency measurements.",
    href: "/ops/runtime-latency",
    label: "Runtime latency",
  },
  {
    description:
      "Preview recipients and send one plain-text email to an explicit list of member IDs.",
    href: "/ops/email",
    label: "Member email",
  },
] as const;

export default async function HostedOpsPage() {
  await getHostedDashboardPageAuthSnapshot();
  await requireHostedOpsPageAccess();

  return (
    <div className="flex flex-col gap-8">
      <header className="border-b border-border/70 pb-6">
        <div className="max-w-3xl">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-chart-5">
            Ops notebook
          </span>
          <h1 className="mt-2 font-serif text-3xl font-semibold leading-tight tracking-tight text-foreground md:text-4xl">
            Ops
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Internal controls for hosted growth, billing, and runtime operations.
          </p>
        </div>
      </header>

      <section
        aria-labelledby="ops-tools-title"
        className="grid gap-3 md:grid-cols-2"
      >
        <h2 className="sr-only" id="ops-tools-title">Ops tools</h2>
        {OPS_TOOLS.map((tool) => (
          <Link
            className="group rounded-xl border border-border/70 bg-card/90 p-5 transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            href={tool.href}
            key={tool.href}
          >
            <div className="font-serif text-lg font-semibold tracking-tight text-foreground">
              {tool.label}
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {tool.description}
            </p>
          </Link>
        ))}
      </section>
    </div>
  );
}
