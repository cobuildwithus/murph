import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type {
  HostedPhysicalNote,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import type {
  HostedPhysicalNoteSendRequest,
  HostedPhysicalNoteSendResponse,
} from "@murphai/hosted-execution/physical-notes";
import {
  normalizeHostedPhysicalNoteRecipient,
  stableHostedPhysicalNoteRecipientJson,
} from "@murphai/hosted-execution/physical-notes";

import { assertHostedGroupParticipantActionOriginHasOwnMurph } from "../hosted-groups/participant-action-authority";
import { isHostedOnboardingError } from "../hosted-onboarding/errors";
import {
  assertActiveHostedMemberAccessAllowed,
  readActiveHostedMemberAccess,
} from "../hosted-onboarding/member-access";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "../hosted-onboarding/shared";
import {
  isHostedThreadContainerNotificationDestination,
  requireHostedAssistantNotificationDestination,
} from "../hosted-routing/assistant-notification-destination";
import { getPrisma } from "../prisma";
import { readHostedAiUsageGate } from "../hosted-execution/usage-allowance";
import { recordHostedAiUsageRecords } from "../hosted-execution/usage";
import { buildHostedLobPhysicalNoteUsageRecord } from "../hosted-execution/usage-lob";
import {
  createLobPhysicalNoteRuntime,
  type LobPhysicalNoteRuntime,
} from "./lob-runtime";

const COMPLIMENTARY_OFFER_CODE = "physical-note-v1";
const REPLAY_WINDOW_MS = 23 * 60 * 60 * 1_000;

interface PhysicalNoteConfig {
  apiKey: string;
  costUsdMicros: bigint;
  fromAddressId: string;
  pricingVersion: string;
}

export async function createHostedPhysicalNote(input: HostedPhysicalNoteSendRequest & {
  memberId: string;
  prisma?: PrismaClient;
  runtime?: LobPhysicalNoteRuntime;
  signal?: AbortSignal;
}): Promise<HostedPhysicalNoteSendResponse> {
  const prisma = input.prisma ?? getPrisma();
  const config = readPhysicalNoteConfig();
  const recipient = normalizeHostedPhysicalNoteRecipient(input.recipient);

  const destination = await requireHostedAssistantNotificationDestination({
    memberId: input.memberId,
    prisma,
    signal: input.signal,
  });
  let reassertGroupOrigin: (() => Promise<void>) | null = null;
  if (isHostedThreadContainerNotificationDestination(destination)) {
    const routeAuthority = destination.externalThreadRouteAuthority;
    if (!routeAuthority) {
      throw new Error("Hosted physical-note group route authority is missing.");
    }
    const authorityInput = {
      originAssistantInputId: input.originAssistantInputId,
      prisma,
      routeAuthority,
      signal: input.signal,
    };
    await assertHostedGroupParticipantActionOriginHasOwnMurph(authorityInput);
    reassertGroupOrigin = async () => {
      await assertHostedGroupParticipantActionOriginHasOwnMurph(authorityInput);
    };
  }
  input.signal?.throwIfAborted();

  const requestFingerprint = buildPhysicalNoteFingerprint({
    artworkSha256: input.artwork.sha256,
    originAssistantInputId: input.originAssistantInputId,
    recipient,
  });
  const reservation = await prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    if (!await readActiveHostedMemberAccess({
      memberId: input.memberId,
      prisma: tx,
    })) {
      await assertActiveHostedMemberAccessAllowed({
        memberId: input.memberId,
        prisma: tx,
      });
    }
    const existing = await tx.hostedPhysicalNote.findUnique({
      where: {
        memberId_requestKey: {
          memberId: input.memberId,
          requestKey: input.requestKey,
        },
      },
    });
    if (existing) {
      if (existing.requestFingerprint !== requestFingerprint) {
        throw new Error("Hosted physical-note request key collision.");
      }
      return { kind: "row" as const, created: false, row: existing };
    }
    if (!config) {
      return { kind: "unavailable" as const };
    }
    if (isPhysicalNoteArtworkCapabilityExpiringSoon(input.artwork.expiresAt)) {
      throw new TypeError("Physical-note artwork URL expires too soon.");
    }

    const priorComplimentary = await tx.hostedPhysicalNote.findFirst({
      select: { id: true },
      where: {
        complimentaryOfferCode: COMPLIMENTARY_OFFER_CODE,
        memberId: input.memberId,
      },
    });
    const complimentary = priorComplimentary === null;
    if (!complimentary) {
      const pendingPaidNotes = await tx.hostedPhysicalNote.aggregate({
        _sum: { providerCostUsdMicros: true },
        where: {
          complimentaryOfferCode: null,
          memberId: input.memberId,
          status: "starting",
        },
      });
      const reservedUsdMicros =
        pendingPaidNotes._sum.providerCostUsdMicros ?? 0n;
      const gate = await readHostedAiUsageGate({
        memberId: input.memberId,
        prisma: tx,
      });
      if (
        !gate.allowed
        || gate.remainingUsdMicros - reservedUsdMicros < config.costUsdMicros
      ) {
        return {
          kind: "insufficient" as const,
          costUsdMicros: config.costUsdMicros,
        };
      }
    }

    return {
      kind: "row" as const,
      created: true,
      row: await tx.hostedPhysicalNote.create({
        data: {
          complimentaryOfferCode: complimentary
            ? COMPLIMENTARY_OFFER_CODE
            : null,
          id: createPhysicalNoteId(),
          memberId: input.memberId,
          pricingVersion: config.pricingVersion,
          provider: "lob",
          providerCostUsdMicros: config.costUsdMicros,
          requestFingerprint,
          requestKey: input.requestKey,
          status: "starting",
        },
      }),
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  if (reservation.kind === "unavailable") {
    return unavailableResponse();
  }
  if (reservation.kind === "insufficient") {
    return {
      complimentary: false,
      costUsdMicros: reservation.costUsdMicros.toString(),
      physicalNoteId: null,
      status: "insufficient_usage",
    };
  }

  if (reservation.row.status === "accepted") {
    const accepted = await finalizeHostedPhysicalNoteAcceptance({
      acceptedAt: reservation.row.acceptedAt ?? new Date(),
      memberId: input.memberId,
      noteId: reservation.row.id,
      prisma,
      providerLetterId: requireProviderLetterId(reservation.row),
    });
    return toResponse(accepted, "accepted");
  }
  if (reservation.row.status === "failed") {
    return toResponse(reservation.row, "failed");
  }
  if (
    !reservation.created
    && Date.now() - reservation.row.createdAt.getTime() >= REPLAY_WINDOW_MS
  ) {
    return toResponse(reservation.row, "pending");
  }
  if (!config) {
    return toResponse(reservation.row, "pending");
  }
  if (
    !reservation.created
    && isPhysicalNoteArtworkCapabilityExpiringSoon(input.artwork.expiresAt)
  ) {
    return toResponse(reservation.row, "pending");
  }

  const runtime = input.runtime ?? createLobPhysicalNoteRuntime({
    apiKey: config.apiKey,
    fromAddressId: config.fromAddressId,
  });
  let providerResult;
  try {
    await reassertGroupOrigin?.();
    input.signal?.throwIfAborted();
    providerResult = await runtime.create({
      artworkUrl: input.artwork.url,
      idempotencyKey: reservation.row.id,
      noteId: reservation.row.id,
      recipient,
      signal: input.signal,
    });
  } catch (error) {
    if (
      reservation.created
      && (
        input.signal?.aborted === true
        || (isHostedOnboardingError(error) && !error.retryable)
      )
    ) {
      await markHostedPhysicalNoteFailed({
        noteId: reservation.row.id,
        prisma,
      });
    }
    throw error;
  }

  if (providerResult.kind === "ambiguous_failure") {
    const current = await prisma.hostedPhysicalNote.findUniqueOrThrow({
      where: { id: reservation.row.id },
    });
    if (current.status === "accepted") {
      const accepted = await finalizeHostedPhysicalNoteAcceptance({
        acceptedAt: current.acceptedAt ?? new Date(),
        memberId: input.memberId,
        noteId: current.id,
        prisma,
        providerLetterId: requireProviderLetterId(current),
      });
      return toResponse(accepted, "accepted");
    }
    if (current.status === "failed") {
      return toResponse(current, "failed");
    }
    return toResponse(current, "pending");
  }
  if (providerResult.kind === "definite_failure") {
    await markHostedPhysicalNoteFailed({
      noteId: reservation.row.id,
      prisma,
    });
    const current = await prisma.hostedPhysicalNote.findUniqueOrThrow({
      where: { id: reservation.row.id },
    });
    if (current.status === "accepted") {
      const accepted = await finalizeHostedPhysicalNoteAcceptance({
        acceptedAt: current.acceptedAt ?? new Date(),
        memberId: input.memberId,
        noteId: current.id,
        prisma,
        providerLetterId: requireProviderLetterId(current),
      });
      return toResponse(accepted, "accepted");
    }
    return toResponse(current, "failed");
  }

  const accepted = await finalizeHostedPhysicalNoteAcceptance({
    acceptedAt: new Date(),
    memberId: input.memberId,
    noteId: reservation.row.id,
    prisma,
    providerLetterId: providerResult.providerLetterId,
  });
  return toResponse(accepted, "accepted");
}

async function finalizeHostedPhysicalNoteAcceptance(input: {
  acceptedAt: Date;
  memberId: string;
  noteId: string;
  prisma: PrismaClient;
  providerLetterId: string;
}): Promise<HostedPhysicalNote> {
  return await input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    await tx.hostedPhysicalNote.updateMany({
      data: {
        acceptedAt: input.acceptedAt,
        providerLetterId: input.providerLetterId,
        status: "accepted",
      },
      where: {
        id: input.noteId,
        memberId: input.memberId,
        providerLetterId: null,
        status: "starting",
      },
    });
    const note = await tx.hostedPhysicalNote.findUniqueOrThrow({
      where: { id: input.noteId },
    });
    if (
      note.memberId !== input.memberId
      || note.status !== "accepted"
      || note.providerLetterId !== input.providerLetterId
      || note.acceptedAt === null
    ) {
      throw new Error("Hosted physical-note acceptance invariant failed.");
    }
    await recordPaidPhysicalNoteUsageTx({ note, tx });
    return note;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function recordPaidPhysicalNoteUsageTx(input: {
  note: HostedPhysicalNote;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  if (input.note.complimentaryOfferCode !== null) return;
  const providerLetterId = requireProviderLetterId(input.note);
  if (!input.note.acceptedAt) {
    throw new Error("Accepted physical-note usage evidence is incomplete.");
  }
  const cost = Number(input.note.providerCostUsdMicros);
  if (!Number.isSafeInteger(cost) || cost < 0) {
    throw new TypeError("Physical-note provider cost is invalid.");
  }
  await recordHostedAiUsageRecords({
    accountAllowance: true,
    prisma: input.tx,
    trustedUserId: input.note.memberId,
    usage: [buildHostedLobPhysicalNoteUsageRecord({
      memberId: input.note.memberId,
      occurredAt: input.note.acceptedAt,
      physicalNoteId: input.note.id,
      providerCostUsdMicros: cost,
      providerLetterId,
      providerPricingVersion: input.note.pricingVersion,
    })],
  });
}

function readPhysicalNoteConfig(): PhysicalNoteConfig | null {
  const apiKey = readEnv("LOB_API_KEY");
  const fromAddressId = readEnv("LOB_FROM_ADDRESS_ID");
  const pricingVersion = readEnv("LOB_PHYSICAL_NOTE_PRICING_VERSION");
  const costText = readEnv("LOB_PHYSICAL_NOTE_COST_USD_MICROS");
  if (!apiKey || !fromAddressId || !pricingVersion || !costText) {
    return null;
  }
  if (
    apiKey.startsWith("live_")
    && process.env.LOB_PHYSICAL_NOTES_LIVE_ENABLED?.trim().toLowerCase() !== "true"
  ) {
    return null;
  }
  const cost = Number(costText);
  if (!Number.isSafeInteger(cost) || cost <= 0) {
    return null;
  }
  return {
    apiKey,
    costUsdMicros: BigInt(cost),
    fromAddressId,
    pricingVersion,
  };
}

async function markHostedPhysicalNoteFailed(input: {
  noteId: string;
  prisma: PrismaClient;
}): Promise<void> {
  await input.prisma.hostedPhysicalNote.updateMany({
    data: {
      complimentaryOfferCode: null,
      status: "failed",
    },
    where: {
      id: input.noteId,
      providerLetterId: null,
      status: "starting",
    },
  });
}

function buildPhysicalNoteFingerprint(input: {
  artworkSha256: string;
  originAssistantInputId: string;
  recipient: HostedPhysicalNoteSendRequest["recipient"];
}): string {
  return createHash("sha256")
    .update("murph.hosted-physical-note.request.v1\0")
    .update(input.artworkSha256)
    .update("\0")
    .update(input.originAssistantInputId)
    .update("\0")
    .update(stableHostedPhysicalNoteRecipientJson(input.recipient))
    .digest("hex");
}

function requireProviderLetterId(
  note: Pick<HostedPhysicalNote, "providerLetterId">,
): string {
  if (!note.providerLetterId) {
    throw new Error("Accepted physical note is missing its Lob letter id.");
  }
  return note.providerLetterId;
}

function toResponse(
  note: Pick<
    HostedPhysicalNote,
    "complimentaryOfferCode" | "id" | "providerCostUsdMicros"
  >,
  status: HostedPhysicalNoteSendResponse["status"],
): HostedPhysicalNoteSendResponse {
  return {
    complimentary: note.complimentaryOfferCode !== null,
    costUsdMicros: note.providerCostUsdMicros.toString(),
    physicalNoteId: note.id,
    status,
  };
}

function createPhysicalNoteId(): string {
  return `hpn_${randomUUID().replaceAll("-", "")}`;
}

function isPhysicalNoteArtworkCapabilityExpiringSoon(
  expiresAt: string,
): boolean {
  return new Date(expiresAt).getTime() <= Date.now() + 60_000;
}

function readEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function unavailableResponse(): HostedPhysicalNoteSendResponse {
  return {
    complimentary: false,
    costUsdMicros: "0",
    physicalNoteId: null,
    status: "unavailable",
  };
}
