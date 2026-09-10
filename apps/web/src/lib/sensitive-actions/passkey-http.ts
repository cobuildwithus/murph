import "server-only";

import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { requireHostedAppSessionFromRequest } from "@/src/lib/hosted-onboarding/app-session";
import { assertHostedOnboardingMutationOrigin } from "@/src/lib/hosted-onboarding/csrf";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { readJsonObject } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export async function readApprovalPasskeyRequest(request: Request) {
  assertHostedOnboardingMutationOrigin(request);
  const session = await requireHostedAppSessionFromRequest(request);
  const body = await readJsonObject(request, { limitBytes: 32 * 1024 });
  return { body, prisma: getPrisma(), session };
}

export function parseApprovalPasskeyRegistration(value: unknown): RegistrationResponseJSON {
  if (value && typeof value === "object") {
    const id: unknown = Reflect.get(value, "id");
    const rawId: unknown = Reflect.get(value, "rawId");
    const type: unknown = Reflect.get(value, "type");
    const response: unknown = Reflect.get(value, "response");
    if (typeof id === "string" && id.length > 0 && rawId === id && type === "public-key"
      && response && typeof response === "object") {
      const attestationObject: unknown = Reflect.get(response, "attestationObject");
      const clientDataJSON: unknown = Reflect.get(response, "clientDataJSON");
      if (typeof attestationObject === "string" && typeof clientDataJSON === "string") {
        return { id, rawId, type, response: { attestationObject, clientDataJSON }, clientExtensionResults: {} };
      }
    }
  }
  throw hostedOnboardingError({
    code: "SENSITIVE_ACTION_REGISTRATION_INVALID", httpStatus: 400,
    message: "Your passkey could not be registered. Please try again.",
  });
}
