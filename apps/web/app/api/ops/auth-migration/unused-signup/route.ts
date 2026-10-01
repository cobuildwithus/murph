import * as z from "@murphai/contracts/zod-runtime";
import { getPrisma } from "@/src/lib/prisma";
import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { deleteHostedAccountData } from "@/src/lib/hosted-privacy/account-data-service";

export const maxDuration = 300;
const bodySchema = z.object({
  memberId: z.string().regex(/^[A-Za-z0-9_.:-]{1,256}$/u),
  createdAt: z.iso.datetime(),
  confirmation: z.literal("DELETE UNUSED SIGNUP"),
}).strict();

// Temporary migration operation. No candidate discovery, batch deletion or
// session impersonation; remove with the importer after cleanup converges.
export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, { requireMutationOrigin: true });
  const body = bodySchema.safeParse(await readJsonObject(request, { limitBytes: 1024 }));
  if (!body.success) throw hostedOnboardingError({ code: "AUTH_REQUEST_INVALID", httpStatus: 400,
    message: "Select one account, its exact creation time, and confirm unused-signup deletion." });
  const result = await deleteHostedAccountData({
    memberId: body.data.memberId, unusedSignupCreatedAt: new Date(body.data.createdAt),
    prisma: getPrisma(), request, exitFeedback: null,
  });
  return jsonOk({ deleted: true, cleanupPending: result.cleanupPending });
});
