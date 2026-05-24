import { createHash, randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";

import {
  buildCurrentHostedConsentDocumentVersions,
} from "../legal/consent";

export const HOSTED_WHATSAPP_MESSAGING_CONSENT_SCOPE = "feature.whatsapp-messaging";

export type HostedWhatsAppConsentAction = "granted" | "revoked";

export interface HostedWhatsAppMessagingConsentWriteResult {
  applied: boolean;
  duplicate: boolean;
  stale: boolean;
}

export async function readHostedWhatsAppMessagingConsentGrantedTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<boolean> {
  const grant = await input.prisma.hostedConsentGrant.findUnique({
    where: {
      memberId_scope: {
        memberId: input.memberId,
        scope: HOSTED_WHATSAPP_MESSAGING_CONSENT_SCOPE,
      },
    },
  });

  return Boolean(
    grant
    && grant.status === "granted"
    && !grant.revokedAt
    && hostedWhatsAppConsentDocumentVersionsAreCurrent(grant.documentVersionsJson),
  );
}

export async function grantHostedWhatsAppMessagingConsentTx(input: {
  eventId?: string;
  memberId: string;
  now: Date;
  prisma: Prisma.TransactionClient;
}): Promise<HostedWhatsAppMessagingConsentWriteResult> {
  return await writeHostedWhatsAppMessagingConsentTx({
    action: "granted",
    eventId: input.eventId,
    memberId: input.memberId,
    now: input.now,
    prisma: input.prisma,
  });
}

export async function revokeHostedWhatsAppMessagingConsentTx(input: {
  eventId?: string;
  memberId: string;
  now: Date;
  prisma: Prisma.TransactionClient;
}): Promise<HostedWhatsAppMessagingConsentWriteResult> {
  return await writeHostedWhatsAppMessagingConsentTx({
    action: "revoked",
    eventId: input.eventId,
    memberId: input.memberId,
    now: input.now,
    prisma: input.prisma,
  });
}

async function writeHostedWhatsAppMessagingConsentTx(input: {
  action: HostedWhatsAppConsentAction;
  eventId?: string;
  memberId: string;
  now: Date;
  prisma: Prisma.TransactionClient;
}): Promise<HostedWhatsAppMessagingConsentWriteResult> {
  const existingGrant = await input.prisma.hostedConsentGrant.findUnique({
    where: {
      memberId_scope: {
        memberId: input.memberId,
        scope: HOSTED_WHATSAPP_MESSAGING_CONSENT_SCOPE,
      },
    },
  });

  if (existingGrant && existingGrant.updatedAt >= input.now) {
    return {
      applied: false,
      duplicate: false,
      stale: true,
    };
  }

  const documentVersions = input.action === "granted"
    ? buildCurrentHostedConsentDocumentVersions(HOSTED_WHATSAPP_MESSAGING_CONSENT_SCOPE)
    : existingGrant
      ? readHostedWhatsAppConsentDocumentVersions(existingGrant.documentVersionsJson)
      : buildCurrentHostedConsentDocumentVersions(HOSTED_WHATSAPP_MESSAGING_CONSENT_SCOPE);
  let event: { id: string };

  try {
    event = await input.prisma.hostedConsentEvent.create({
      data: {
        action: input.action,
        createdAt: input.now,
        documentVersionsJson: documentVersions,
        id: input.eventId ?? generateHostedWhatsAppConsentEventId(),
        memberId: input.memberId,
        scope: HOSTED_WHATSAPP_MESSAGING_CONSENT_SCOPE,
        source: "whatsapp",
      },
    });
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      return {
        applied: false,
        duplicate: true,
        stale: false,
      };
    }

    throw error;
  }

  if (input.action === "granted") {
    const grantData = {
      documentVersionsJson: documentVersions,
      grantedAt: input.now,
      lastEventId: event.id,
      revokedAt: null,
      source: "whatsapp",
      status: "granted",
      updatedAt: input.now,
    };

    if (existingGrant) {
      const updated = await updateHostedWhatsAppConsentGrantIfUnchangedTx({
        data: grantData,
        memberId: input.memberId,
        observedUpdatedAt: existingGrant.updatedAt,
        prisma: input.prisma,
      });

      return buildHostedWhatsAppConsentStaleWriteResult(updated);
    }

    try {
      await input.prisma.hostedConsentGrant.create({
        data: {
          ...grantData,
          createdAt: input.now,
          memberId: input.memberId,
          scope: HOSTED_WHATSAPP_MESSAGING_CONSENT_SCOPE,
        },
      });
    } catch (error) {
      if (!isPrismaUniqueViolation(error)) {
        throw error;
      }

      const racedGrant = await input.prisma.hostedConsentGrant.findUnique({
        where: {
          memberId_scope: {
            memberId: input.memberId,
            scope: HOSTED_WHATSAPP_MESSAGING_CONSENT_SCOPE,
          },
        },
        select: {
          updatedAt: true,
        },
      });

      if (!racedGrant || racedGrant.updatedAt >= input.now) {
        return {
          applied: false,
          duplicate: false,
          stale: true,
        };
      }

      const updated = await updateHostedWhatsAppConsentGrantIfUnchangedTx({
        data: grantData,
        memberId: input.memberId,
        observedUpdatedAt: racedGrant.updatedAt,
        prisma: input.prisma,
      });

      return buildHostedWhatsAppConsentStaleWriteResult(updated);
    }

    return {
      applied: true,
      duplicate: false,
      stale: false,
    };
  }

  if (existingGrant) {
    const updated = await updateHostedWhatsAppConsentGrantIfUnchangedTx({
      data: {
        documentVersionsJson: documentVersions,
        lastEventId: event.id,
        revokedAt: input.now,
        source: "whatsapp",
        status: "revoked",
        updatedAt: input.now,
      },
      memberId: input.memberId,
      observedUpdatedAt: existingGrant.updatedAt,
      prisma: input.prisma,
    });

    return buildHostedWhatsAppConsentStaleWriteResult(updated);
  }

  return {
    applied: true,
    duplicate: false,
    stale: false,
  };
}

async function updateHostedWhatsAppConsentGrantIfUnchangedTx(input: {
  data: Prisma.HostedConsentGrantUpdateManyMutationInput;
  memberId: string;
  observedUpdatedAt: Date;
  prisma: Prisma.TransactionClient;
}): Promise<{ count: number }> {
  return input.prisma.hostedConsentGrant.updateMany({
    data: input.data,
    where: {
      memberId: input.memberId,
      scope: HOSTED_WHATSAPP_MESSAGING_CONSENT_SCOPE,
      updatedAt: input.observedUpdatedAt,
    },
  });
}

function hostedWhatsAppConsentDocumentVersionsAreCurrent(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const current = buildCurrentHostedConsentDocumentVersions(
    HOSTED_WHATSAPP_MESSAGING_CONSENT_SCOPE,
  );
  const storedEntries = Object.entries(value);
  const currentEntries = Object.entries(current);

  if (storedEntries.length !== currentEntries.length) {
    return false;
  }

  return storedEntries.every(([documentId, version]) =>
    typeof version === "string" && current[documentId] === version
  );
}

function readHostedWhatsAppConsentDocumentVersions(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const versions: Record<string, string> = {};
  for (const [documentId, version] of Object.entries(value)) {
    if (typeof version === "string") {
      versions[documentId] = version;
    }
  }

  return versions;
}

function buildHostedWhatsAppConsentStaleWriteResult(input: {
  count: number;
}): HostedWhatsAppMessagingConsentWriteResult {
  const applied = input.count === 1;
  return {
    applied,
    duplicate: false,
    stale: !applied,
  };
}

function generateHostedWhatsAppConsentEventId(): string {
  return `hbce_${randomBytes(12).toString("base64url")}`;
}

export function buildHostedWhatsAppConsentCommandEventId(input: {
  action: HostedWhatsAppConsentAction;
  externalMessageId: string;
}): string {
  const digest = createHash("sha256")
    .update(`${input.action}\u0000${input.externalMessageId}`)
    .digest("hex")
    .slice(0, 32);
  return `hbce_whatsapp_${digest}`;
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002",
  );
}
