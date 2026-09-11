import * as z from "@murphai/contracts/zod-runtime";
import { getPrisma } from "@/src/lib/prisma";
import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import { importHostedAuthBatch } from "@/src/lib/better-auth/import-batch";
import { assertHostedBetterAuthIssuanceEnabled } from "@/src/lib/better-auth/config";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readOptionalJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const maxDuration = 60;
const bodySchema = z.object({ mode: z.enum(["dry-run", "apply"]).default("dry-run"), after: z.string().min(1).max(256).optional() }).strict();

export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, { requireMutationOrigin: true });
  const body = bodySchema.safeParse(await readOptionalJsonObject(request, { limitBytes: 1024 }));
  if (!body.success) throw hostedOnboardingError({ code: "AUTH_REQUEST_INVALID", httpStatus: 400, message: "Choose dry-run or apply and an optional member cursor." });
  if (body.data.mode === "apply") assertHostedBetterAuthIssuanceEnabled();
  return jsonOk(await importHostedAuthBatch({ ...body.data, prisma: getPrisma() }));
});
