import { parseInput, RequestInputError, RequestBodyTooLargeError } from "@murphai/hosted-execution/request-input";
import {
  CLOUDFLARE_HOSTED_CONTROL_DEVICE_WEBHOOK_ENQUEUE_PATH,
  createDeviceWebhookTransportPrivateKeyringFromJson,
  DEVICE_WEBHOOK_QUEUE_MAX_ENVELOPE_BYTES,
  parseDeviceWebhookQueueEnvelope,
  readDeviceWebhookQueuePersistenceFailureCode,
  reencryptDeviceWebhookQueueEnvelopeForPersistence,
} from "@murphai/cloudflare-hosted-control/device-webhook-queue";

import { json } from "../../json.ts";
import {
  readCachedRequestText,
  type WorkerRouteContext,
} from "../../worker-routes/shared.ts";
import type { DeclarativeRoute } from "../routes.ts";
import { matchExactPath } from "../routes.ts";
import { parseJsonInput } from "../route-utils/json-body.ts";

export const deviceWebhookEnqueueRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = [
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    async handle(context) {
      return handleDeviceWebhookEnqueueRoute(context);
    },
    match: matchExactPath(CLOUDFLARE_HOSTED_CONTROL_DEVICE_WEBHOOK_ENQUEUE_PATH),
    methods: ["POST"],
    name: "device-webhook-enqueue",
    wrongMethodResponse: "method-not-allowed",
  },
];

async function handleDeviceWebhookEnqueueRoute(
  context: WorkerRouteContext,
): Promise<Response> {
  let envelope;
  try {
    envelope = parseInput(
      parseJsonInput(await readCachedRequestText(context, {
        limitBytes: DEVICE_WEBHOOK_QUEUE_MAX_ENVELOPE_BYTES,
      })),
      parseDeviceWebhookQueueEnvelope,
    );
  } catch (error) {
    if (error instanceof RequestInputError || error instanceof RequestBodyTooLargeError) {
      return json({ code: "invalid_request", error: "Malformed device webhook envelope." }, 400);
    }
    throw error;
  }
  if (!context.env.DEVICE_WEBHOOK_QUEUE) {
    return json({ code: "queue_unavailable", error: "Device webhook queue is unavailable." }, 503);
  }
  try {
    envelope = await reencryptDeviceWebhookQueueEnvelopeForPersistence({
      activeRecipientKeyId:
        context.environment.hostedCryptoCloudflareAutomationKeyId,
      env: context.environment.hostedCryptoEnv,
      envelope,
      privateKeyring: createDeviceWebhookTransportPrivateKeyringFromJson({
        activePrivateJwkJson:
          context.environment.hostedCryptoCloudflareAutomationPrivateJwk,
        activeRecipientKeyId:
          context.environment.hostedCryptoCloudflareAutomationKeyId,
        keyringJson:
          context.environment.hostedCryptoCloudflareAutomationPrivateKeyringJson,
      }),
    });
  } catch (error) {
    const code = readDeviceWebhookQueuePersistenceFailureCode(error);
    if (code !== "transport_context_mismatch" && code !== "transport_metadata_invalid") {
      // Decrypt failures cannot distinguish bad ciphertext from unavailable or
      // inconsistent server keys. Preserve the event for retry in either case.
      throw error;
    }
    return json({
      code,
      error: "Unauthenticated device webhook envelope.",
    }, 400);
  }
  try {
    await context.env.DEVICE_WEBHOOK_QUEUE.send(envelope, { contentType: "json" });
  } catch {
    return json({ code: "enqueue_failed", error: "Device webhook queue did not confirm acceptance." }, 503);
  }
  return json({ accepted: true, transportId: envelope.transportId }, 202);
}
