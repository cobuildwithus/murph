import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import {
  admitHostedOperatorTask,
  listHostedOperatorTasks,
  resolveHostedOperatorTaskMemberId,
  type HostedOperatorTaskKind,
} from "@/src/lib/hosted-ops/operator-task";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  jsonOk,
  readHostedOnboardingJsonObject,
  withJsonError,
} from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const BODY_LIMIT_BYTES = 8 * 1024;

export const GET = withJsonError(async (request: Request) => {
  const session = await requireHostedOpsRequestAccess(request);
  return jsonOk({
    tasks: await listHostedOperatorTasks({
      requestedByMemberId: session.member.id,
    }),
  });
});

export const POST = withJsonError(async (request: Request) => {
  const session = await requireHostedOpsRequestAccess(request, {
    requireMutationOrigin: true,
  });
  const body = await readHostedOnboardingJsonObject(request, {
    limitBytes: BODY_LIMIT_BYTES,
    tooLargeErrorCode: "HOSTED_OPERATOR_TASK_REQUEST_TOO_LARGE",
    tooLargeErrorMessage: "Operator task request body is too large.",
  });
  const memberId = await resolveHostedOperatorTaskMemberId({
    query: readString(body, "memberId"),
  });
  return jsonOk(await admitHostedOperatorTask({
    idempotencyKey: readString(body, "idempotencyKey"),
    kind: readKind(body.kind),
    memberId,
    prompt: readString(body, "prompt"),
    requestedByMemberId: session.member.id,
    signal: request.signal,
    source: "ops",
  }));
});

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  throw hostedOnboardingError({
    code: "HOSTED_OPERATOR_TASK_INPUT_INVALID",
    httpStatus: 400,
    message: `${key} is required.`,
    retryable: false,
  });
}

function readKind(value: unknown): HostedOperatorTaskKind {
  if (value === "diagnostic" || value === "member_message") {
    return value;
  }
  throw hostedOnboardingError({
    code: "HOSTED_OPERATOR_TASK_KIND_INVALID",
    httpStatus: 400,
    message: "Operator task kind is invalid.",
    retryable: false,
  });
}
