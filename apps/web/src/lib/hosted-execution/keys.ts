import type {
  HostedUserManagedRootKeyRecipientKind,
  HostedUserRecipientPublicKeyJwk,
  HostedUserRootKeyEnvelope,
} from "@murphai/runtime-state";
import {
  readHostedExecutionAutomationRecipientPublicKeyJwk,
  type HostedExecutionUserRootKeyRecipientUpsert,
} from "@murphai/hosted-execution";

import { requireHostedExecutionControlClient } from "./control";

export function requireHostedExecutionAutomationRecipientPublicKey(): HostedUserRecipientPublicKeyJwk {
  const key = readHostedExecutionAutomationRecipientPublicKeyJwk();
  if (!key) {
    throw new Error("HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK is not configured.");
  }
  return key;
}

export async function readHostedUserRootKeyEnvelope(
  userId: string,
): Promise<HostedUserRootKeyEnvelope> {
  return requireHostedExecutionControlClient().getUserKeyEnvelope(userId);
}

export async function putHostedUserRootKeyEnvelope(input: {
  envelope: HostedUserRootKeyEnvelope;
  userId: string;
}): Promise<HostedUserRootKeyEnvelope> {
  return requireHostedExecutionControlClient().putUserKeyEnvelope(input.userId, input.envelope);
}

export async function upsertHostedUserRootKeyRecipient(input: {
  kind: HostedUserManagedRootKeyRecipientKind;
  recipient: HostedExecutionUserRootKeyRecipientUpsert;
  userId: string;
}): Promise<HostedUserRootKeyEnvelope> {
  return requireHostedExecutionControlClient().upsertUserKeyRecipient(
    input.userId,
    input.kind,
    input.recipient,
  );
}
