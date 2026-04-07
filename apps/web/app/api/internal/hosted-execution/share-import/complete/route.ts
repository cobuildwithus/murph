import { deleteHostedSharePackFromHostedExecution } from "@/src/lib/hosted-execution/control";
import { requireHostedWebInternalSignedRequest } from "@/src/lib/hosted-execution/internal";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";
import {
  finalizeHostedShareAcceptance,
  findHostedShareLinkById,
  normalizeOptionalString,
} from "@/src/lib/hosted-share/shared";

export const POST = withJsonError(async (request: Request) => {
  const memberId = await requireHostedWebInternalSignedRequest(request);
  const body = await readJsonObject(request);
  const eventId = normalizeRequiredString(body.eventId, "eventId");
  const shareId = normalizeRequiredString(body.shareId, "shareId");
  const prisma = getPrisma();
  const shareRecord = await findHostedShareLinkById(shareId, prisma);

  if (!shareRecord) {
    throw hostedOnboardingError({
      code: "HOSTED_SHARE_NOT_FOUND",
      message: `Hosted share ${shareId} was not found.`,
      httpStatus: 404,
    });
  }

  await finalizeHostedShareAcceptance({
    eventId,
    memberId,
    prisma,
    shareId,
  });

  try {
    await deleteHostedSharePackFromHostedExecution({
      ownerUserId: shareRecord.senderMemberId,
      shareId,
    });
  } catch (error) {
    console.error(
      `Hosted share ${shareId} finalized but its Cloudflare pack could not be deleted.`,
      error instanceof Error ? error.message : String(error),
    );
  }

  return jsonOk({
    eventId,
    finalized: true,
    shareId,
  });
});

function normalizeRequiredString(value: unknown, field: string): string {
  const normalized = normalizeOptionalString(typeof value === "string" ? value : null);

  if (!normalized) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_INVALID_CALLBACK",
      message: `${field} is required for hosted execution business outcome callbacks.`,
      httpStatus: 400,
    });
  }

  return normalized;
}
