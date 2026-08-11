import { deviceSyncError } from "@murphai/device-syncd/errors";

import {
  createMemberOwnedProviderSetupService,
  readMemberOwnedProviderSetupRegistration,
} from "@/src/lib/device-sync/provider-setup";
import { jsonOk, withJsonError } from "@/src/lib/device-sync/settings-http";
import { resolveDecodedRouteParam } from "@/src/lib/http";
import { requireActiveHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { assertHostedHistoricalLaunchConsentGranted } from "@/src/lib/legal/consent";
import { getPrisma } from "@/src/lib/prisma";

export const GET = withJsonError(async (
  request: Request,
  context: { params: Promise<{ provider: string }> },
) => {
  const registration = await requireSupportedRegistration(context.params);
  const provider = registration.coordinates.provider;
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  const setup = await createMemberOwnedProviderSetupService(provider)
    .read(auth.member.id);

  return jsonOk({
    presentation: registration.presentation,
    provider,
    setup,
  });
});

export const POST = withJsonError(async (
  request: Request,
  context: { params: Promise<{ provider: string }> },
) => {
  assertHostedOnboardingMutationOrigin(request);
  const registration = await requireSupportedRegistration(context.params);
  const provider = registration.coordinates.provider;
  const auth = await requireActiveHostedAppSessionFromRequest(request);
  await assertHostedHistoricalLaunchConsentGranted({
    memberId: auth.member.id,
    prisma: getPrisma(),
  });
  const result = await createMemberOwnedProviderSetupService(provider)
    .advance(auth.member.id);

  return jsonOk({
    presentation: registration.presentation,
    provider,
    ...result,
  });
});

async function requireSupportedRegistration(
  params: Promise<{ provider: string }>,
) {
  const provider = await resolveDecodedRouteParam(params, "provider");
  const registration = readMemberOwnedProviderSetupRegistration(provider);
  if (!registration) {
    throw deviceSyncError({
      code: "DEVICE_PROVIDER_SETUP_PROVIDER_UNSUPPORTED",
      httpStatus: 404,
      message: "Private provider setup is not available for this source.",
      retryable: false,
    });
  }
  return registration;
}
