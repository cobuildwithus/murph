import { requireHostedCloudflareCallbackRequest } from "@/src/lib/hosted-execution/cloudflare-callback-auth";
import {
  isHostedDomainRootEnvelopeUnavailableError,
  readHostedDomainRootEnvelopeByRootKeyIdOrThrow,
} from "@/src/lib/hosted-crypto/domain-root-store";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonError, jsonOk, withJsonError } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

type HostedRuntimeCryptoRootDomain = "ingress" | "runtime";
const HOSTED_RUNTIME_CRYPTO_ROOT_CALLBACK_BODY_LIMIT_BYTES = 4 * 1024;

export const POST = withJsonError(async (request: Request) => {
  const userId = await requireHostedCloudflareCallbackRequest(request, {
    maxBodyBytes: HOSTED_RUNTIME_CRYPTO_ROOT_CALLBACK_BODY_LIMIT_BYTES,
  });
  const body = parseHostedRuntimeCryptoRootRequest(await request.json());
  const prisma = getPrisma();
  const workspace = await prisma.hostedWorkspace.findUnique({
    select: { userId: true },
    where: { userId },
  });
  if (!workspace) {
    return Response.json({ error: "hosted_workspace_not_provisioned" }, { status: 403 });
  }

  let envelope: Awaited<ReturnType<typeof readHostedDomainRootEnvelopeByRootKeyIdOrThrow>>;
  try {
    envelope = await readHostedDomainRootEnvelopeByRootKeyIdOrThrow({
      domain: body.domain,
      prisma,
      rootKeyId: body.rootKeyId,
      userId,
    });
  } catch (error) {
    if (isHostedDomainRootEnvelopeUnavailableError(error)) {
      return jsonError(hostedOnboardingError({
        code: "HOSTED_RUNTIME_CRYPTO_ROOT_NOT_FOUND",
        httpStatus: 404,
        message: "Hosted runtime crypto root is not available.",
      }));
    }

    throw error;
  }

  return jsonOk({
    domain: body.domain,
    envelope,
    fetchedAt: new Date().toISOString(),
    rootKeyId: envelope.rootKeyId,
    schema: "murph.hosted-runtime-crypto-root.v1",
    userId,
  });
});

function parseHostedRuntimeCryptoRootRequest(value: unknown): {
  domain: HostedRuntimeCryptoRootDomain;
  rootKeyId: string;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Hosted runtime crypto root request must be an object.");
  }

  const record = value as Record<string, unknown>;
  const domain = record.domain;
  const rootKeyId = record.rootKeyId;

  if (domain !== "ingress" && domain !== "runtime") {
    throw new TypeError("Hosted runtime crypto root request domain must be ingress or runtime.");
  }

  if (typeof rootKeyId !== "string" || rootKeyId.trim().length === 0) {
    throw new TypeError("Hosted runtime crypto root request rootKeyId must be a non-empty string.");
  }

  return {
    domain,
    rootKeyId: rootKeyId.trim(),
  };
}
