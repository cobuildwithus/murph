import type { Metadata } from "next";

import { HOSTED_PATTERN_ENGINE_AUDIT_PREFIX } from "@murphai/hosted-execution/runtime-control";

import { requireHostedOpsPageAccess } from "@/src/lib/hosted-ops/access";
import { getHostedDashboardPageAuthSnapshot } from "@/src/lib/hosted-onboarding/page-auth";
import { getPrisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Pattern audits | Murph Ops",
};

export default async function PatternAuditsPage() {
  await getHostedDashboardPageAuthSnapshot();
  await requireHostedOpsPageAccess();
  const audits = await getPrisma().hostedProductFeedback.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true, id: true, summary: true },
    take: 100,
    where: {
      summary: { startsWith: HOSTED_PATTERN_ENGINE_AUDIT_PREFIX },
    },
  });

  return (
    <main className="space-y-8">
      <header>
        <p>Ops notebook</p>
        <h1 className="text-3xl font-semibold">Pattern engine audits</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground">
          Sol adds an entry only when its independent weekly analysis finds a material,
          reproducible gap in the deterministic engine. Copy the prompt into Codex.
        </p>
      </header>

      {audits.length === 0 ? (
        <p>No Pattern engine suggestions are waiting.</p>
      ) : (
        <ol className="space-y-6">
          {audits.map((audit) => (
            <li key={audit.id} className="space-y-2">
              <time dateTime={audit.createdAt.toISOString()}>
                {audit.createdAt.toISOString().slice(0, 10)}
              </time>
              <pre className="whitespace-pre-wrap rounded-lg border p-4 text-sm">
                {stripAuditPrefix(audit.summary)}
              </pre>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function stripAuditPrefix(summary: string | null): string {
  if (!summary) return "";
  return summary.slice(HOSTED_PATTERN_ENGINE_AUDIT_PREFIX.length).trim();
}
