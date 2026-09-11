import "server-only";
import type { PrismaClient } from "@prisma/client";
import { runWithFreshHostedDomainRootUnwrapCache } from "../hosted-crypto/domain-root-unwrap-cache";
import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import { importHostedAuthMember } from "./import";
import { HostedAuthMigrationConflictError, prepareHostedAuthImport } from "./migration-source";

type Outcome = "ready" | "imported" | "already_owned" | "unbound" | "conflict" | "suspended" | "unavailable";

// A small keyset page bounds provider latency, rows and unwraps. There is no
// second progress registry: authenticated user records are the handoff owner.
// An interrupted apply can be retried, including after a lost HTTP response.
export async function importHostedAuthBatch(input: {
  prisma: PrismaClient;
  mode: "dry-run" | "apply";
  after?: string;
}) {
  const members = await input.prisma.hostedMember.findMany({
    where: { ...(input.after ? { id: { gt: input.after } } : {}), identity: { privyUserLookupKey: { not: null } } },
    select: { id: true }, orderBy: { id: "asc" }, take: 6,
  });
  const results: { memberId: string; outcome: Outcome }[] = [];
  for (const member of members.slice(0, 5)) {
    const outcome = await runWithFreshHostedDomainRootUnwrapCache(async (): Promise<Outcome> => {
      try {
        if (input.mode === "apply") return await importHostedAuthMember({ prisma: input.prisma, memberId: member.id });
        const prepared = await prepareHostedAuthImport({ prisma: input.prisma, memberId: member.id });
        return prepared.kind === "prepared" ? "ready" : prepared.kind;
      } catch (error) {
        if (error instanceof HostedAuthMigrationConflictError) return "conflict";
        if (isHostedOnboardingError(error) && error.code === "HOSTED_MEMBER_SUSPENDED") return "suspended";
        // No provider messages, contacts, tokens or encrypted records cross the
        // operator response boundary. Unavailable is never a terminal success.
        return "unavailable";
      }
    });
    results.push({ memberId: member.id, outcome });
  }
  return {
    mode: input.mode, results,
    next: members.length > 5 ? members[4].id : null,
    unresolved: results.filter(({ outcome }) => !["ready", "imported", "already_owned"].includes(outcome)).length,
  };
}
