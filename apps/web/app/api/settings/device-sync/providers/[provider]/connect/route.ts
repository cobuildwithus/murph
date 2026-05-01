import { createHostedDeviceSyncControlPlane } from "@/src/lib/device-sync/control-plane";
import {
  readConfiguredDeviceSyncProviderConfigs,
  resolveConfiguredDeviceSyncConnectTarget,
} from "@murphai/device-syncd/config";
import { deviceSyncError } from "@murphai/device-syncd/public-ingress";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { readOptionalJsonObject } from "@/src/lib/hosted-onboarding/http";
import { requireActivePrivyMemberAuth } from "@/src/lib/hosted-onboarding/request-auth";
import {
  assertHostedConsentScopeGranted,
  assertHostedLaunchRequiredConsentGranted,
} from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";

export async function GET(): Promise<Response> {
  return Response.json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message:
        "Hosted settings device-sync connect routes only allow POST because starting a connection mutates server state.",
    },
  }, {
    status: 405,
    headers: {
      Allow: "POST",
      "Cache-Control": "no-store",
    },
  });
}

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ provider: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const prisma = getPrisma();
  const auth = await requireActivePrivyMemberAuth(request, prisma);
  await assertHostedLaunchRequiredConsentGranted({
    memberId: auth.member.id,
    prisma,
  });
  await assertHostedConsentScopeGranted({
    memberId: auth.member.id,
    prisma,
    scope: "feature.connected-health-source",
  });
  const body = await readOptionalJsonObject(request);
  const provider = await resolveDecodedRouteParam(context.params, "provider");
  const target = resolveHostedSettingsDeviceConnectTarget(provider);
  const controlPlane = createHostedDeviceSyncControlPlane(request);
  const returnTo = typeof body.returnTo === "string" ? body.returnTo : "/settings";

  return jsonOk(await controlPlane.startConnection(
    auth.member.id,
    target.provider,
    returnTo,
    { sourceProviderSlug: target.sourceProviderSlug ?? null },
  ));
});

function resolveHostedSettingsDeviceConnectTarget(provider: string) {
  const target = resolveConfiguredDeviceSyncConnectTarget(
    readConfiguredDeviceSyncProviderConfigs(process.env),
    provider,
  );

  if (!target) {
    throw deviceSyncError({
      code: "HOSTED_DEVICE_CONNECT_TARGET_NOT_CONFIGURED",
      httpStatus: 404,
      message: "Hosted device connect target is not configured.",
      retryable: false,
    });
  }

  return target;
}
