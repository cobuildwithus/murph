import { type Prisma, type PrismaClient } from "@prisma/client";

import { HOSTED_FAMILY_MAX_SEATS } from "./billing-plans";
import type {
  HostedStripeActivatedMemberOutcome,
} from "./stripe-billing-events";

const HOSTED_STRIPE_ACTIVATION_RESULT_SCHEMA =
  "hosted.stripe.activation-result.v1";

export type HostedStripeActivationResultJson = {
  activationMailboxItemIds: string[];
  schema: typeof HOSTED_STRIPE_ACTIVATION_RESULT_SCHEMA;
};

export type HostedStripeActivationMailboxItem = {
  dedupeKey: string;
  id: string;
  userId: string;
};

export function buildHostedStripeActivationResultJson(result: {
  activatedMemberId: string | null;
  activatedMembers?: HostedStripeActivatedMemberOutcome[];
  hostedExecutionEventId: string | null;
  hostedExecutionMailboxItemId?: string | null;
}): HostedStripeActivationResultJson {
  const explicitActivations = (result.activatedMembers ?? []).filter(
    (activation): activation is HostedStripeActivatedMemberOutcome & {
      activatedMemberId: string;
      hostedExecutionEventId: string;
    } => Boolean(activation.activatedMemberId && activation.hostedExecutionEventId),
  );
  const activations = explicitActivations.length > 0
    ? explicitActivations
    : result.activatedMemberId && result.hostedExecutionEventId
    ? [{
        activatedMemberId: result.activatedMemberId,
        hostedExecutionEventId: result.hostedExecutionEventId,
        hostedExecutionMailboxItemId:
          result.hostedExecutionMailboxItemId,
      }]
    : [];

  const activationMailboxItemIds = activations.map((activation) => {
    const mailboxItemId = activation.hostedExecutionMailboxItemId;
    if (!mailboxItemId) {
      throw new Error(
        "Stripe activation completion requires an exact mailbox pointer.",
      );
    }
    return mailboxItemId;
  });
  if (activationMailboxItemIds.length > HOSTED_FAMILY_MAX_SEATS) {
    throw new Error("Stripe activation completion exceeds the Family seat limit.");
  }

  return {
    activationMailboxItemIds,
    schema: HOSTED_STRIPE_ACTIVATION_RESULT_SCHEMA,
  };
}

export function parseHostedStripeActivationResultJson(
  value: Prisma.JsonValue | null,
): HostedStripeActivationResultJson | null {
  if (value === null) {
    return null;
  }
  if (
    typeof value !== "object"
    || Array.isArray(value)
    || value.schema !== HOSTED_STRIPE_ACTIVATION_RESULT_SCHEMA
    || !Array.isArray(value.activationMailboxItemIds)
  ) {
    throw new Error("Stored Stripe activation result has an unsupported schema.");
  }

  if (value.activationMailboxItemIds.length > HOSTED_FAMILY_MAX_SEATS) {
    throw new Error("Stored Stripe activation result exceeds the Family seat limit.");
  }

  const activationMailboxItemIds = value.activationMailboxItemIds.map(
    (mailboxItemId) => {
      if (typeof mailboxItemId !== "string" || mailboxItemId.length === 0) {
        throw new Error("Stored Stripe activation result is malformed.");
      }
      return mailboxItemId;
    },
  );
  if (new Set(activationMailboxItemIds).size !== activationMailboxItemIds.length) {
    throw new Error("Stored Stripe activation result contains duplicate pointers.");
  }

  return {
    activationMailboxItemIds,
    schema: HOSTED_STRIPE_ACTIVATION_RESULT_SCHEMA,
  };
}

export async function readStoredHostedStripeActivationMailboxItems(input: {
  mailboxItemIds: string[];
  prisma: PrismaClient;
}): Promise<HostedStripeActivationMailboxItem[]> {
  if (input.mailboxItemIds.length === 0) {
    return [];
  }
  const rows = await input.prisma.hostedMailboxItem.findMany({
    select: { dedupeKey: true, id: true, userId: true },
    where: {
      id: { in: input.mailboxItemIds },
      kind: {
        in: ["member.activated", "runtime.maintenance-requested"],
      },
    },
  });
  const rowsById = new Map(rows.map((row) => [row.id, row] as const));
  // Account deletion can cascade a pointed-to mailbox row while the
  // member-agnostic Stripe receipt remains. Preserve the receipt outcome and
  // wake only pointers that still have a durable owner.
  return input.mailboxItemIds.flatMap((mailboxItemId) => {
    const row = rowsById.get(mailboxItemId);
    return row ? [row] : [];
  });
}
