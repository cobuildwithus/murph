import { timingSafeEqual } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import { createHostedMemberReplyAliasRoute } from "@/src/lib/hosted-onboarding/hosted-email-reply-alias";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { upsertHostedMemberReplyAliasLookupKeyTx } from "@/src/lib/hosted-onboarding/hosted-member-routing-store";
import { getPrisma } from "@/src/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BACKFILL_SECRET_ENV = "HOSTED_EMAIL_REPLY_ALIAS_BACKFILL_SECRET";

const unsuspendedVerifiedEmailMemberWhere = {
  suspendedAt: null,
  emailAuthorization: {
    is: {
      verifiedEmailVerifiedAt: {
        not: null,
      },
    },
  },
} satisfies Prisma.HostedMemberWhereInput;

const missingReplyAliasWhere = {
  ...unsuspendedVerifiedEmailMemberWhere,
  OR: [
    {
      routing: {
        is: null,
      },
    },
    {
      routing: {
        is: {
          replyAliasLookupKey: null,
        },
      },
    },
  ],
} satisfies Prisma.HostedMemberWhereInput;

const existingReplyAliasWhere = {
  ...unsuspendedVerifiedEmailMemberWhere,
  routing: {
    is: {
      replyAliasLookupKey: {
        not: null,
      },
    },
  },
} satisfies Prisma.HostedMemberWhereInput;

interface HostedEmailReplyAliasBackfillRoute {
  memberId: string;
  replyAliasLookupKey: string;
}

export const POST = withJsonError(async (request: Request) => {
  requireHostedEmailReplyAliasBackfillAuthorization(request);
  const body = await readOptionalJsonObject(request);
  const apply = readApplyFlag(body);
  const prisma = getPrisma();
  const result = await backfillHostedEmailReplyAliases({
    apply,
    prisma,
  });

  return jsonOk({
    ok: true,
    ...result,
  });
});

async function backfillHostedEmailReplyAliases(input: {
  apply: boolean;
  prisma: PrismaClient;
}) {
  const before = await readHostedEmailReplyAliasBackfillCounts(input.prisma);
  const candidates = await input.prisma.hostedMember.findMany({
    orderBy: {
      createdAt: "asc",
    },
    select: {
      id: true,
    },
    where: missingReplyAliasWhere,
  });

  const generatedRoutes: HostedEmailReplyAliasBackfillRoute[] = [];
  const generatedLookupKeys = new Set<string>();

  for (const candidate of candidates) {
    const replyAlias = await createHostedMemberReplyAliasRoute({
      memberId: candidate.id,
    });
    if (!replyAlias) {
      throw hostedOnboardingError({
        code: "HOSTED_EMAIL_REPLY_ALIAS_BACKFILL_CONFIG_REQUIRED",
        httpStatus: 500,
        message: "Hosted email reply-alias backfill requires hosted email alias configuration.",
      });
    }

    if (generatedLookupKeys.has(replyAlias.replyAliasLookupKey)) {
      throw hostedOnboardingError({
        code: "HOSTED_EMAIL_REPLY_ALIAS_BACKFILL_ALIAS_COLLISION",
        httpStatus: 500,
        message: "Hosted email reply-alias backfill generated a duplicate lookup key.",
      });
    }

    generatedLookupKeys.add(replyAlias.replyAliasLookupKey);
    generatedRoutes.push({
      memberId: candidate.id,
      replyAliasLookupKey: replyAlias.replyAliasLookupKey,
    });
  }

  if (input.apply && generatedRoutes.length > 0) {
    await input.prisma.$transaction(async (tx) => {
      for (const route of generatedRoutes) {
        await upsertHostedMemberReplyAliasLookupKeyTx({
          memberId: route.memberId,
          prisma: tx,
          replyAliasLookupKey: route.replyAliasLookupKey,
        });
      }
    });
  }

  const after = await readHostedEmailReplyAliasBackfillCounts(input.prisma);

  return {
    apply: input.apply,
    backfilledReplyAliasCount: input.apply ? generatedRoutes.length : 0,
    existingReplyAliasCountBefore: before.existingReplyAliasCount,
    generatedReplyAliasCount: generatedRoutes.length,
    missingReplyAliasCountAfter: after.missingReplyAliasCount,
    missingReplyAliasCountBefore: before.missingReplyAliasCount,
    unsuspendedVerifiedEmailMemberCount: before.unsuspendedVerifiedEmailMemberCount,
  };
}

async function readHostedEmailReplyAliasBackfillCounts(prisma: PrismaClient) {
  const [
    unsuspendedVerifiedEmailMemberCount,
    existingReplyAliasCount,
    missingReplyAliasCount,
  ] = await Promise.all([
    prisma.hostedMember.count({
      where: unsuspendedVerifiedEmailMemberWhere,
    }),
    prisma.hostedMember.count({
      where: existingReplyAliasWhere,
    }),
    prisma.hostedMember.count({
      where: missingReplyAliasWhere,
    }),
  ]);

  return {
    existingReplyAliasCount,
    missingReplyAliasCount,
    unsuspendedVerifiedEmailMemberCount,
  };
}

function requireHostedEmailReplyAliasBackfillAuthorization(request: Request): void {
  const configuredSecret = normalizeOptionalString(process.env[BACKFILL_SECRET_ENV]);
  if (!configuredSecret) {
    throw hostedOnboardingError({
      code: "HOSTED_EMAIL_REPLY_ALIAS_BACKFILL_SECRET_REQUIRED",
      httpStatus: 500,
      message: `${BACKFILL_SECRET_ENV} must be configured for hosted email reply-alias backfills.`,
    });
  }

  const providedSecret = readBearerAuthorizationToken(request.headers.get("authorization"));
  if (!providedSecret || !timingSafeEquals(configuredSecret, providedSecret)) {
    throw hostedOnboardingError({
      code: "HOSTED_EMAIL_REPLY_ALIAS_BACKFILL_UNAUTHORIZED",
      httpStatus: 401,
      message: "Unauthorized hosted email reply-alias backfill request.",
    });
  }
}

function readApplyFlag(body: Record<string, unknown>): boolean {
  const value = body.apply;
  if (value === undefined || value === false || value === "false") {
    return false;
  }
  if (value === true || value === "true") {
    return true;
  }

  throw hostedOnboardingError({
    code: "HOSTED_EMAIL_REPLY_ALIAS_BACKFILL_APPLY_INVALID",
    httpStatus: 400,
    message: "Hosted email reply-alias backfill apply must be a boolean.",
  });
}

function readBearerAuthorizationToken(value: string | null): string | null {
  const normalized = normalizeOptionalString(value);
  if (!normalized || !normalized.startsWith("Bearer ")) {
    return null;
  }

  return normalizeOptionalString(normalized.slice("Bearer ".length));
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function timingSafeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
