import * as z from "@murphai/contracts/zod-runtime";
import { requireHostedOpsRequestAccess } from "@/src/lib/hosted-ops/access";
import { readHostedOpsLinqHandleBlocks, updateHostedOpsLinqHandleBlock } from "@/src/lib/hosted-ops/linq-handle-block";
import { LINQ_HANDLE_BLOCK_REASONS } from "@/src/lib/hosted-routing/linq-handle-block";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { jsonOk, readHostedOnboardingJsonObject, withJsonError } from "@/src/lib/hosted-onboarding/http";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;
const operation = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("block"), contact: z.string().trim().min(1).max(320), reason: z.enum(LINQ_HANDLE_BLOCK_REASONS).optional() }).strict(),
  z.object({ operation: z.literal("unblock"), contact: z.string().trim().min(1).max(320) }).strict(),
]);
const querySchema = z.object({ after: z.string().min(1).max(256).optional() }).strict();
function invalidRequest(): never {
  throw hostedOnboardingError({ code: "HOSTED_LINQ_BLOCK_INVALID_REQUEST", httpStatus: 400,
    message: "Invalid blocked number request.", retryable: false });
}
export const GET = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request);
  const query = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) invalidRequest();
  return jsonOk(await readHostedOpsLinqHandleBlocks(query.data));
});
export const POST = withJsonError(async (request: Request) => {
  await requireHostedOpsRequestAccess(request, { requireMutationOrigin: true });
  const body = await readHostedOnboardingJsonObject(request, { limitBytes: 4096,
    tooLargeErrorCode: "HOSTED_LINQ_BLOCK_REQUEST_TOO_LARGE", tooLargeErrorMessage: "Blocked number request is too large." });
  const parsed = operation.safeParse(body);
  if (!parsed.success) invalidRequest();
  return jsonOk(await updateHostedOpsLinqHandleBlock(parsed.data));
});
