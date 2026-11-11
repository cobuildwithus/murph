import { recapMediaAccessRequestSchema } from '@murphai/contracts/recap-admission';
import { requireHostedCloudflareCallbackJsonRequest } from '@/src/lib/hosted-execution/cloudflare-callback-auth';
import { consumeRecapProviderReservation } from '@/src/lib/game/recap-admission';
import { jsonOk, withJsonError } from '@/src/lib/hosted-onboarding/http';

export const POST = withJsonError(async (request: Request) => {
  const { payload, userId } = await requireHostedCloudflareCallbackJsonRequest(request, { maxBodyBytes: 8192 });
  const body = recapMediaAccessRequestSchema.parse(payload);
  return jsonOk(await consumeRecapProviderReservation({ ...body, memberId: userId,
    runtimeIdentity: { userId, attemptId: body.attemptId, generation: body.generation } }));
});
