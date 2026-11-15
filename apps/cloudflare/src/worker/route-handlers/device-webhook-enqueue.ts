import { parseInput, RequestInputError } from "@murphai/hosted-execution/request-input";
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
    // Preserve provider-webhook responses until the provider-webhook stage of
    // 2026-11-14-explicit-request-rejection reviews retry and recovery behavior.
    if (error instanceof RequestInputError || error instanceof RangeError) {
      return json({ code: "invalid_request", error: "Malformed device webhook envelope." }, 400);
    }
    if (error instanceof SyntaxError) return json({ error: "Invalid JSON." }, 400);
    if (error instanceof TypeError || error instanceof URIError) return json({ error: "Invalid request." }, 400);
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
    // The provider-webhook stage must separate input/auth failures from server
    // keyring and persistence failures before changing this final 400.
    return json({
      code:
        readDeviceWebhookQueuePersistenceFailureCode(error)
        ?? "persistence_failure_unclassified",
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
