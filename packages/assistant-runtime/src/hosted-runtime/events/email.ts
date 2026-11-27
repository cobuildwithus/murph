import { isHostedEmailConversationMessageWake } from "@murphai/hosted-execution";
import { parseHostedEmailThreadTarget } from "@murphai/runtime-state";
import {
  type HostedExecutionConversationMessageWake,
} from "@murphai/hosted-execution";

import type {
  HostedRuntimeEffectsPort,
} from "../platform.ts";

export class HostedRawEmailMessageMissingError extends Error {
  readonly code = "email-raw-message-missing";

  constructor(input: { rawMessageKey: string; userId: string }) {
    super(
      `Hosted email message fetch failed for ${input.userId}/${input.rawMessageKey}.`,
    );
    this.name = "HostedRawEmailMessageMissingError";
  }
}

export async function readHostedRawEmailMessage(
  wake: HostedExecutionConversationMessageWake & {
    message: Extract<HostedExecutionConversationMessageWake["message"], { channel: "email" }>;
  },
  effectsPort: HostedRuntimeEffectsPort,
): Promise<Uint8Array> {
  const bytes = await effectsPort.readRawEmailMessage(wake.message.rawMessageKey);

  if (!bytes) {
    throw new HostedRawEmailMessageMissingError({
      rawMessageKey: wake.message.rawMessageKey,
      userId: wake.userId,
    });
  }

  return bytes;
}

// The fallback is readable by old runners. Only private ingress substitutes it
// for a different stored body. Ordinary wakes carry their actual body preview.
export async function readPortalForwardForAssistant(wake: HostedExecutionConversationMessageWake, effectsPort: Pick<HostedRuntimeEffectsPort, "readRawEmailMessage">) {
  if (!isHostedEmailConversationMessageWake(wake) || !wake.message.threadIsDirect
    || parseHostedEmailThreadTarget(wake.message.threadTarget)?.targetKind === "group"
    || wake.message.subject !== "Forwarded patient portal notice") return wake;
  const { forwardedPortalFallback, medicalRecordsFindUrl, normalizePortalDiscoveryFragment, portalDiscoverySummary }
    = await import("@murphai/clinical-records/portal-discovery-link");
  if (wake.message.textPreview !== forwardedPortalFallback) return wake;
  const bytes = await effectsPort.readRawEmailMessage(wake.message.rawMessageKey);
  if (!bytes) return wake;
  const { readHostedEmailConversationBody } = await import("@murphai/inboxd/connectors/hosted-conversation");
  const summary = readHostedEmailConversationBody(bytes)?.trim() ?? "";
  const fragment = summary.split(medicalRecordsFindUrl)[1] ?? "";
  if (!normalizePortalDiscoveryFragment(fragment)) return wake;
  const params = new URLSearchParams(fragment.slice(1));
  if (summary !== portalDiscoverySummary({ id: params.get("provider")!, brandName: params.get("find")! })) return wake;
  return { ...wake, message: { ...wake.message, textPreview: summary } };
}
