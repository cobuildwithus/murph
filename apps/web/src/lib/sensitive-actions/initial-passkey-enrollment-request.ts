import "server-only";
import * as z from "@murphai/contracts/zod-runtime";
import { hostedAuthRequestIp } from "../better-auth/admission";
import { hostedAuthRateLimitStorage } from "../better-auth/rate-limit";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { jsonOk } from "../hosted-onboarding/http";
import { parseApprovalPasskeyRegistration, readApprovalPasskeyRequest } from "./passkey-http";
import { createInitialApprovalEnrollmentOptions, registerInitialApprovalEnrollment } from "./initial-passkey-enrollment";

const optionsSchema = z.object({}).strict();
const registerSchema = z.object({ initialToken: z.string().max(128), response: z.unknown() }).strict();

export async function initialApprovalEnrollmentRequest(request: Request, operation: "options" | "register",
  admitted?: Awaited<ReturnType<typeof readApprovalPasskeyRequest>>): Promise<Response> {
  const { body, prisma, session } = admitted ?? await readApprovalPasskeyRequest(request);
  const limits = hostedAuthRateLimitStorage(prisma);
  for (const [key, max] of [[`initial-approval-enrollment:member:${session.member.id}`, 20],
    [`initial-approval-enrollment:ip:${hostedAuthRequestIp(request)}`, 100]] as const) {
    if (!(await limits.consume(key, { max, window: 600 })).allowed) throw hostedOnboardingError({
      code: "AUTH_RATE_LIMITED", httpStatus: 429, message: "Too many attempts. Wait a few minutes and try again.", retryable: true,
    });
  }
  const input = { prisma, session, request };
  if (operation === "options" && optionsSchema.safeParse(body).success) return jsonOk(await createInitialApprovalEnrollmentOptions(input));
  const parsed = registerSchema.safeParse(body);
  if (operation !== "register" || !parsed.success) throw hostedOnboardingError({
    code: "SENSITIVE_ACTION_REGISTRATION_INVALID", httpStatus: 400, message: "Start passkey setup again.",
  });
  await registerInitialApprovalEnrollment({ ...input, token: parsed.data.initialToken,
    response: parseApprovalPasskeyRegistration(parsed.data.response) });
  return jsonOk({ registered: true });
}
