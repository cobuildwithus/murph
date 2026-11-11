import * as z from '@murphai/contracts/zod-runtime';
import { recapProviderRequestSchema } from '@murphai/contracts/recap-admission';
import { requireHostedCloudflareCallbackJsonRequest } from '@/src/lib/hosted-execution/cloudflare-callback-auth';
import { consumeRecapProviderReservation } from '@/src/lib/game/recap-admission';
import { jsonOk, withJsonError } from '@/src/lib/hosted-onboarding/http';

const bodySchema = z.object({
  attemptId: z.string().min(1).max(191), generation: z.string().regex(/^\d+$/u),
  token: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  providerRequest: recapProviderRequestSchema.nullable(), opaque: z.boolean(), nativeImage: z.boolean(),
}).strict();
export const POST = withJsonError(async (request: Request) => {
  const { payload, userId } = await requireHostedCloudflareCallbackJsonRequest(request, { maxBodyBytes: 8192 });
  const body = bodySchema.parse(payload);
  return jsonOk(await consumeRecapProviderReservation({ ...body, memberId: userId,
    runtimeIdentity: { userId, attemptId: body.attemptId, generation: body.generation } }));
});
