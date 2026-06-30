import { requireHostedCloudflareCallbackRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import { readHostedRuntimeCryptoContextForWorker } from "@/src/lib/hosted-crypto/domain-root-store";
import { hasHostedMemberEffectiveActiveAccessForMember } from "@/src/lib/hosted-onboarding/family-plan";
import { jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

const HOSTED_RUNTIME_CRYPTO_CONTEXT_CALLBACK_BODY_LIMIT_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_RUNTIME_CRYPTO_CONTEXT_CALLBACK_BODY_LIMIT_BYTES,
  });
  const prisma = getPrisma();
  const member = await prisma.hostedMember.findUnique({
    select: { billingStatus: true, id: true, suspendedAt: true },
    where: { id: userId },
  });
  if (!member || !await hasHostedMemberEffectiveActiveAccessForMember({
    member,
    prisma,
  })) {
    return Response.json({ error: "hosted_member_not_active" }, { status: 403 });
  }
  const workspace = await prisma.hostedWorkspace.findUnique({
    select: { userId: true },
    where: { userId },
  });
  if (!workspace) {
    return Response.json({ error: "hosted_workspace_not_provisioned" }, { status: 403 });
  }
  const context = await readHostedRuntimeCryptoContextForWorker({
    prisma,
    userId,
  });
  return jsonOk({ ...context, fetchedAt: new Date().toISOString() });
});
