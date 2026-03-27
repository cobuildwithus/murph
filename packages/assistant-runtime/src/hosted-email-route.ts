import { readFile } from "node:fs/promises";

import {
  readHostedVerifiedEmailFromEnv,
  resolveRuntimePaths,
} from "@murph/runtime-state";
import {
  readAssistantAutomationState,
  saveAssistantAutomationState,
} from "murph/assistant/store";
import {
  resolveAssistantSelfDeliveryTarget,
  saveAssistantSelfDeliveryTarget,
} from "murph/operator-config";

const HOSTED_EMAIL_SETUP_CONNECTOR_ID = "email:agentmail";

type HostedEmailSelfTargetStatus =
  | "ambiguous-email-connectors"
  | "missing-email-connector"
  | "no-verified-email"
  | "saved"
  | "unchanged";

interface InboxConnectorConfigLike {
  accountId?: unknown;
  enabled?: unknown;
  id?: unknown;
  source?: unknown;
}

type HostedEmailConnectorIdentity =
  | {
      identityId: null;
      status: "ambiguous-email-connectors" | "missing-email-connector";
    }
  | {
      identityId: string;
      status: "selected";
    };

export interface HostedEmailSelfTargetReconciliationResult {
  emailAddress: string | null;
  identityId: string | null;
  preferredChannelsUpdated: boolean;
  selfTargetUpdated: boolean;
  status: HostedEmailSelfTargetStatus;
}

export async function reconcileHostedVerifiedEmailSelfTarget(input: {
  operatorHomeRoot: string;
  source?: Readonly<Record<string, string | undefined>>;
  vaultRoot: string;
}): Promise<HostedEmailSelfTargetReconciliationResult> {
  const verifiedEmail = readHostedVerifiedEmailFromEnv(input.source);

  if (!verifiedEmail) {
    return {
      emailAddress: null,
      identityId: null,
      preferredChannelsUpdated: false,
      selfTargetUpdated: false,
      status: "no-verified-email",
    };
  }

  const connectors = await readInboxConnectors(input.vaultRoot);
  const connectorIdentity = resolveHostedEmailConnectorIdentityId(connectors);

  if (connectorIdentity.status !== "selected") {
    return {
      emailAddress: verifiedEmail.address,
      identityId: null,
      preferredChannelsUpdated: false,
      selfTargetUpdated: false,
      status: connectorIdentity.status,
    };
  }

  const nextTarget = {
    channel: "email",
    deliveryTarget: verifiedEmail.address,
    identityId: connectorIdentity.identityId,
    participantId: verifiedEmail.address,
    sourceThreadId: null,
  };
  const existingTarget = await resolveAssistantSelfDeliveryTarget("email", input.operatorHomeRoot);
  const selfTargetUpdated = !isAssistantSelfDeliveryTargetEqual(existingTarget, nextTarget);

  if (selfTargetUpdated) {
    await saveAssistantSelfDeliveryTarget(nextTarget, input.operatorHomeRoot);
  }

  const automationState = await readAssistantAutomationState(input.vaultRoot);
  const preferredChannels = automationState.preferredChannels.includes("email")
    ? automationState.preferredChannels
    : [...automationState.preferredChannels, "email"];
  const preferredChannelsUpdated = preferredChannels.length !== automationState.preferredChannels.length;

  if (preferredChannelsUpdated) {
    await saveAssistantAutomationState(input.vaultRoot, {
      ...automationState,
      preferredChannels,
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    emailAddress: verifiedEmail.address,
    identityId: connectorIdentity.identityId,
    preferredChannelsUpdated,
    selfTargetUpdated,
    status: selfTargetUpdated || preferredChannelsUpdated ? "saved" : "unchanged",
  };
}

async function readInboxConnectors(vaultRoot: string): Promise<InboxConnectorConfigLike[]> {
  try {
    const raw = await readFile(resolveRuntimePaths(vaultRoot).inboxConfigPath, "utf8");
    const parsed = JSON.parse(raw) as {
      connectors?: unknown;
    };

    return Array.isArray(parsed.connectors)
      ? parsed.connectors.filter((value): value is InboxConnectorConfigLike => isRecord(value))
      : [];
  } catch {
    return [];
  }
}

function resolveHostedEmailConnectorIdentityId(
  connectors: readonly InboxConnectorConfigLike[],
): HostedEmailConnectorIdentity {
  const emailConnectors = connectors.filter((connector) => {
    const source = normalizeText(connector.source);
    const accountId = normalizeText(connector.accountId);

    return source === "email" && connector.enabled !== false && Boolean(accountId);
  });

  if (emailConnectors.length === 0) {
    return {
      identityId: null,
      status: "missing-email-connector",
    };
  }

  const preferredConnector = emailConnectors.find(
    (connector) => normalizeText(connector.id) === HOSTED_EMAIL_SETUP_CONNECTOR_ID,
  );

  if (preferredConnector) {
    return {
      identityId: normalizeText(preferredConnector.accountId) as string,
      status: "selected",
    };
  }

  if (emailConnectors.length === 1) {
    return {
      identityId: normalizeText(emailConnectors[0]?.accountId) as string,
      status: "selected",
    };
  }

  return {
    identityId: null,
    status: "ambiguous-email-connectors",
  };
}

function isAssistantSelfDeliveryTargetEqual(
  left: {
    channel: string;
    deliveryTarget: string | null;
    identityId: string | null;
    participantId: string | null;
    sourceThreadId: string | null;
  } | null,
  right: {
    channel: string;
    deliveryTarget: string | null;
    identityId: string | null;
    participantId: string | null;
    sourceThreadId: string | null;
  },
): boolean {
  return (
    left?.channel === right.channel
    && left?.deliveryTarget === right.deliveryTarget
    && left?.identityId === right.identityId
    && left?.participantId === right.participantId
    && left?.sourceThreadId === right.sourceThreadId
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}
