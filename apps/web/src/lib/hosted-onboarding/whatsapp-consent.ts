import { randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";

import {
  buildCurrentHostedConsentDocumentVersions,
} from "../legal/consent";

export const HOSTED_WHATSAPP_MESSAGING_CONSENT_SCOPE = "feature.whatsapp-messaging";

type HostedWhatsAppConsentAction = "granted" | "revoked";

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
  memberId: string;
  now: Date;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  await writeHostedWhatsAppMessagingConsentTx({
    action: "granted",
    memberId: input.memberId,
    now: input.now,
    prisma: input.prisma,
  });
}

export async function revokeHostedWhatsAppMessagingConsentTx(input: {
  memberId: string;
  now: Date;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  await writeHostedWhatsAppMessagingConsentTx({
    action: "revoked",
    memberId: input.memberId,
    now: input.now,
    prisma: input.prisma,
  });
}

async function writeHostedWhatsAppMessagingConsentTx(input: {
  action: HostedWhatsAppConsentAction;
  memberId: string;
  now: Date;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  const existingGrant = await input.prisma.hostedConsentGrant.findUnique({
    where: {
      memberId_scope: {
        memberId: input.memberId,
        scope: HOSTED_WHATSAPP_MESSAGING_CONSENT_SCOPE,
      },
    },
  });
  const documentVersions = input.action === "granted"
    ? buildCurrentHostedConsentDocumentVersions(HOSTED_WHATSAPP_MESSAGING_CONSENT_SCOPE)
    : existingGrant
      ? readHostedWhatsAppConsentDocumentVersions(existingGrant.documentVersionsJson)
      : buildCurrentHostedConsentDocumentVersions(HOSTED_WHATSAPP_MESSAGING_CONSENT_SCOPE);
  const event = await input.prisma.hostedConsentEvent.create({
    data: {
      action: input.action,
      createdAt: input.now,
      documentVersionsJson: documentVersions,
      id: generateHostedWhatsAppConsentEventId(),
      memberId: input.memberId,
      scope: HOSTED_WHATSAPP_MESSAGING_CONSENT_SCOPE,
      source: "whatsapp",
    },
  });

  if (input.action === "granted") {
    await input.prisma.hostedConsentGrant.upsert({
      create: {
        createdAt: input.now,
        documentVersionsJson: documentVersions,
        grantedAt: input.now,
        lastEventId: event.id,
        memberId: input.memberId,
        revokedAt: null,
        scope: HOSTED_WHATSAPP_MESSAGING_CONSENT_SCOPE,
        source: "whatsapp",
        status: "granted",
        updatedAt: input.now,
      },
      update: {
        documentVersionsJson: documentVersions,
        grantedAt: input.now,
        lastEventId: event.id,
        revokedAt: null,
        source: "whatsapp",
        status: "granted",
        updatedAt: input.now,
      },
      where: {
        memberId_scope: {
          memberId: input.memberId,
          scope: HOSTED_WHATSAPP_MESSAGING_CONSENT_SCOPE,
        },
      },
    });
    return;
  }

  if (existingGrant) {
    await input.prisma.hostedConsentGrant.update({
      data: {
        documentVersionsJson: documentVersions,
        lastEventId: event.id,
        revokedAt: input.now,
        source: "whatsapp",
        status: "revoked",
        updatedAt: input.now,
      },
      where: {
        memberId_scope: {
          memberId: input.memberId,
          scope: HOSTED_WHATSAPP_MESSAGING_CONSENT_SCOPE,
        },
      },
    });
  }
}

function hostedWhatsAppConsentDocumentVersionsAreCurrent(value: unknown): boolean {
  const current = buildCurrentHostedConsentDocumentVersions(
    HOSTED_WHATSAPP_MESSAGING_CONSENT_SCOPE,
  );
  const stored = readHostedWhatsAppConsentDocumentVersions(value);
  const currentEntries = Object.entries(current);

  if (Object.keys(stored).length !== currentEntries.length) {
    return false;
  }

  return currentEntries.every(([documentId, version]) => stored[documentId] === version);
}

function readHostedWhatsAppConsentDocumentVersions(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return buildCurrentHostedConsentDocumentVersions(HOSTED_WHATSAPP_MESSAGING_CONSENT_SCOPE);
  }

  const versions: Record<string, string> = {};
  for (const [documentId, version] of Object.entries(value)) {
    if (typeof version === "string") {
      versions[documentId] = version;
    }
  }

  return versions;
}

function generateHostedWhatsAppConsentEventId(): string {
  return `hbce_${randomBytes(12).toString("base64url")}`;
}
