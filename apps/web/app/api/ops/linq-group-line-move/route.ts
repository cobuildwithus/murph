import * as z from "@murphai/contracts/zod-runtime";
import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import { operateHostedLinqGroupLineMove, startHostedLinqGroupLineMove } from "@/src/lib/hosted-ops/linq-group-line-move";
import { readHostedLinqGroupLineMoveOverview } from "@/src/lib/hosted-ops/linq-group-line-move-overview";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readHostedOnboardingJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;
const opaque = z.string().min(1).max(256);
const operation = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("start"), containerRef: opaque, targetLineLookupKey: opaque }).strict(),
  z.object({ operation: z.enum(["resume", "cancel", "retry_leave", "adopt"]), moveId: z.string().uuid() }).strict(),
]);
const overview = z.object({ status: z.enum(["reserved", "adopted", "left", "cancelled"]).optional(),
  sourceLineLookupKey: opaque.optional(), afterMoveId: z.string().uuid().optional(), afterContainerRef: opaque.optional() }).strict();

function invalidRequest(): never {
  throw hostedOnboardingError({ code: "HOSTED_LINQ_GROUP_MOVE_INVALID_REQUEST", httpStatus: 400,
    message: "Invalid group line move request.", retryable: false });
}
export const GET = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request);
  const query = overview.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) invalidRequest();
  return jsonOk(await readHostedLinqGroupLineMoveOverview(query.data));
});
export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, { requireMutationOrigin: true });
  const body = await readHostedOnboardingJsonObject(request, { limitBytes: 4 * 1024,
    tooLargeErrorCode: "HOSTED_LINQ_GROUP_MOVE_REQUEST_TOO_LARGE", tooLargeErrorMessage: "Group move request is too large." });
  const parsed = operation.safeParse(body);
  if (!parsed.success) invalidRequest();
  return jsonOk(parsed.data.operation === "start"
    ? await startHostedLinqGroupLineMove(parsed.data) : await operateHostedLinqGroupLineMove(parsed.data));
});
