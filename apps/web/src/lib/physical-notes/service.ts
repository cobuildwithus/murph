import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type {
  HostedPhysicalNote,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import type {
  HostedPhysicalNoteFailureReason,
  HostedPhysicalNoteSendRequest,
  HostedPhysicalNoteSendResponse,
} from "@murphai/hosted-execution/physical-notes";
import {
  normalizeHostedPhysicalNoteRecipient,
  stableHostedPhysicalNoteRecipientJson,
} from "@murphai/hosted-execution/physical-notes";

import { assertHostedGroupParticipantActionOriginHasOwnMurph } from "../hosted-groups/participant-action-authority";
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
import { readPhysicalNoteConfig } from "./config";
import {
  createLobPhysicalNoteRuntime,
  type LobPhysicalNoteRuntime,
} from "./lob-runtime";

const COMPLIMENTARY_OFFER_CODE = "physical-note-v1";
const REPLAY_WINDOW_MS = 23 * 60 * 60 * 1_000;

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
  const existing = await prisma.hostedPhysicalNote.findUnique({
    where: {
      memberId_requestKey: {
        memberId: input.memberId,
        requestKey: input.requestKey,
      },
    },
  });
  if (existing && existing.requestFingerprint !== requestFingerprint) {
    throw new Error("Hosted physical-note request key collision.");
  }
  if (existing) {
    const replay = await resolveHostedPhysicalNoteReplay({
      memberId: input.memberId,
      prisma,
      requestFingerprint,
      row: existing,
    });
    if (replay) {
      return replay;
    }
    if (!config) {
      return toResponse(existing, "pending");
    }
  } else if (!config) {
    return unavailableResponse();
  }

  if (!config) {
    throw new Error("Hosted physical-note configuration invariant failed.");
  }
  const runtime = input.runtime ?? createLobPhysicalNoteRuntime({
    apiKey: config.apiKey,
    fromAddressId: config.fromAddressId,
  });
  const legacy = await findLegacyFailedPhysicalNote({
    memberId: input.memberId,
    prisma,
  });
  if (legacy) {
    const current = legacy.requestKey === input.requestKey
      ? legacy
      : await recordLegacyBlockedPhysicalNoteRequest({
          memberId: input.memberId,
          pricingVersion: config.pricingVersion,
          prisma,
          providerCostUsdMicros: config.costUsdMicros,
          requestFingerprint,
          requestKey: input.requestKey,
        });
    await resolveLegacyFailedPhysicalNote({
      legacy,
      memberId: input.memberId,
      prisma,
      runtime,
      signal: input.signal,
    });
    const reconciledCurrent = await prisma.hostedPhysicalNote.findUniqueOrThrow({
      where: { id: current.id },
    });
    const replay = await resolveHostedPhysicalNoteReplay({
      memberId: input.memberId,
      prisma,
      requestFingerprint,
      row: reconciledCurrent,
    });
    return replay ?? toResponse(reconciledCurrent, "pending");
  }
  await resolveStaleComplimentaryPhysicalNote({
    memberId: input.memberId,
    prisma,
    runtime,
    signal: input.signal,
  });

  const artworkExpiresAt = new Date(input.artwork.expiresAt);
  if (artworkExpiresAt.getTime() <= Date.now() + 60_000) {
    throw new TypeError("Physical-note artwork URL expires too soon.");
  }
  await reassertGroupOrigin?.();
  input.signal?.throwIfAborted();

  const reservation = await prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    await assertHostedPhysicalNoteMemberAccess({
      memberId: input.memberId,
      prisma: tx,
    });
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
      return { kind: "row" as const, row: existing };
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
      const gate = await readHostedAiUsageGate({
        memberId: input.memberId,
        prisma: tx,
      });
      const pendingPaidNotes = await tx.hostedPhysicalNote.aggregate({
        _sum: { providerCostUsdMicros: true },
        where: {
          complimentaryOfferCode: null,
          createdAt: {
            gte: gate.periodStart,
            lt: gate.periodEnd,
          },
          memberId: input.memberId,
          status: "starting",
        },
      });
      const reservedUsdMicros =
        pendingPaidNotes._sum.providerCostUsdMicros ?? 0n;
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

  if (reservation.kind === "insufficient") {
    return {
      complimentary: false,
      costUsdMicros: reservation.costUsdMicros.toString(),
      physicalNoteId: null,
      status: "insufficient_usage",
    };
  }

  const replay = await resolveHostedPhysicalNoteReplay({
    memberId: input.memberId,
    prisma,
    requestFingerprint,
    row: reservation.row,
  });
  if (replay) {
    return replay;
  }
  const providerResult = await runtime.create({
    artworkUrl: input.artwork.url,
    idempotencyKey: reservation.row.id,
    noteId: reservation.row.id,
    recipient,
  });

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
      failureReason: providerResult.reason,
      memberId: input.memberId,
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

async function resolveHostedPhysicalNoteReplay(input: {
  memberId: string;
  prisma: PrismaClient;
  requestFingerprint: string;
  row: HostedPhysicalNote;
}): Promise<HostedPhysicalNoteSendResponse | null> {
  if (input.row.requestFingerprint !== input.requestFingerprint) {
    throw new Error("Hosted physical-note request key collision.");
  }
  if (input.row.status === "accepted") {
    const accepted = await finalizeHostedPhysicalNoteAcceptance({
      acceptedAt: input.row.acceptedAt ?? new Date(),
      memberId: input.memberId,
      noteId: input.row.id,
      prisma: input.prisma,
      providerLetterId: requireProviderLetterId(input.row),
    });
    return toResponse(accepted, "accepted");
  }
  if (input.row.status === "failed") {
    return input.row.failureReason === null
      ? null
      : toResponse(input.row, "failed");
  }
  return Date.now() - input.row.createdAt.getTime() >= REPLAY_WINDOW_MS
    ? toResponse(input.row, "pending")
    : null;
}

async function resolveLegacyFailedPhysicalNote(input: {
  legacy: HostedPhysicalNote;
  memberId: string;
  prisma: PrismaClient;
  runtime: LobPhysicalNoteRuntime;
  signal?: AbortSignal;
}): Promise<void> {
  if (Date.now() - input.legacy.createdAt.getTime() < REPLAY_WINDOW_MS) {
    return;
  }
  const providerResult = await input.runtime.findLetterByNoteId({
    noteId: input.legacy.id,
    signal: input.signal,
  });
  if (providerResult.kind === "indeterminate") {
    return;
  }
  if (providerResult.kind === "accepted") {
    await finalizeLegacyPhysicalNoteAcceptance({
      acceptedAt: new Date(),
      memberId: input.memberId,
      noteId: input.legacy.id,
      prisma: input.prisma,
      providerLetterId: providerResult.providerLetterId,
    });
    return;
  }

  await markLegacyPhysicalNoteAbsent({
    memberId: input.memberId,
    noteId: input.legacy.id,
    prisma: input.prisma,
  });
}

async function findLegacyFailedPhysicalNote(input: {
  memberId: string;
  prisma: PrismaClient;
}): Promise<HostedPhysicalNote | null> {
  return await input.prisma.hostedPhysicalNote.findFirst({
    orderBy: { createdAt: "asc" },
    where: {
      failureReason: null,
      memberId: input.memberId,
      status: "failed",
    },
  });
}

async function recordLegacyBlockedPhysicalNoteRequest(input: {
  memberId: string;
  pricingVersion: string;
  prisma: PrismaClient;
  providerCostUsdMicros: bigint;
  requestFingerprint: string;
  requestKey: string;
}): Promise<HostedPhysicalNote> {
  return await input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    const existing = await tx.hostedPhysicalNote.findUnique({
      where: {
        memberId_requestKey: {
          memberId: input.memberId,
          requestKey: input.requestKey,
        },
      },
    });
    if (existing) {
      if (existing.requestFingerprint !== input.requestFingerprint) {
        throw new Error("Hosted physical-note request key collision.");
      }
      return existing;
    }
    await assertHostedPhysicalNoteMemberAccess({
      memberId: input.memberId,
      prisma: tx,
    });
    return await tx.hostedPhysicalNote.create({
      data: {
        complimentaryOfferCode: null,
        failureReason: "unknown",
        id: createPhysicalNoteId(),
        memberId: input.memberId,
        pricingVersion: input.pricingVersion,
        provider: "lob",
        providerCostUsdMicros: input.providerCostUsdMicros,
        requestFingerprint: input.requestFingerprint,
        requestKey: input.requestKey,
        status: "failed",
      },
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function assertHostedPhysicalNoteMemberAccess(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  if (!await readActiveHostedMemberAccess(input)) {
    await assertActiveHostedMemberAccessAllowed(input);
  }
}

async function resolveStaleComplimentaryPhysicalNote(input: {
  memberId: string;
  prisma: PrismaClient;
  runtime: LobPhysicalNoteRuntime;
  signal?: AbortSignal;
}): Promise<void> {
  const stale = await input.prisma.hostedPhysicalNote.findFirst({
    select: { id: true },
    where: {
      complimentaryOfferCode: COMPLIMENTARY_OFFER_CODE,
      createdAt: {
        lte: new Date(Date.now() - REPLAY_WINDOW_MS),
      },
      memberId: input.memberId,
      status: "starting",
    },
  });
  if (!stale) return;

  const providerResult = await input.runtime.findLetterByNoteId({
    noteId: stale.id,
    signal: input.signal,
  });
  if (providerResult.kind === "accepted") {
    await finalizeHostedPhysicalNoteAcceptance({
      acceptedAt: new Date(),
      memberId: input.memberId,
      noteId: stale.id,
      prisma: input.prisma,
      providerLetterId: providerResult.providerLetterId,
    });
  }
  if (providerResult.kind === "absent") {
    await markHostedPhysicalNoteFailed({
      failureReason: "unknown",
      memberId: input.memberId,
      noteId: stale.id,
      prisma: input.prisma,
    });
  }
}

async function finalizeLegacyPhysicalNoteAcceptance(input: {
  acceptedAt: Date;
  memberId: string;
  noteId: string;
  prisma: PrismaClient;
  providerLetterId: string;
}): Promise<HostedPhysicalNote> {
  return await input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    const currentComplimentary = await tx.hostedPhysicalNote.findFirst({
      select: { id: true },
      where: {
        complimentaryOfferCode: COMPLIMENTARY_OFFER_CODE,
        memberId: input.memberId,
      },
    });
    await tx.hostedPhysicalNote.updateMany({
      data: {
        acceptedAt: input.acceptedAt,
        ...(currentComplimentary
          ? {}
          : { complimentaryOfferCode: COMPLIMENTARY_OFFER_CODE }),
        failureReason: null,
        providerLetterId: input.providerLetterId,
        status: "accepted",
      },
      where: {
        failureReason: null,
        id: input.noteId,
        memberId: input.memberId,
        providerLetterId: null,
        status: "failed",
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
      throw new Error("Legacy physical-note acceptance invariant failed.");
    }
    // The old failure transition erased whether this reservation was free or
    // paid. Do not create a charge from missing historical billing evidence.
    return note;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
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
        failureReason: null,
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
      // The reservation is committed before the Lob request. acceptedAt is
      // provider completion and can fall on the other side of a plan reset.
      occurredAt: input.note.createdAt,
      physicalNoteId: input.note.id,
      providerCostUsdMicros: cost,
      providerLetterId,
      providerPricingVersion: input.note.pricingVersion,
    })],
  });
}

async function markHostedPhysicalNoteFailed(input: {
  failureReason: HostedPhysicalNoteFailureReason;
  memberId: string;
  noteId: string;
  prisma: PrismaClient;
}): Promise<void> {
  await input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    await tx.hostedPhysicalNote.updateMany({
      data: {
        complimentaryOfferCode: null,
        failureReason: input.failureReason,
        status: "failed",
      },
      where: {
        id: input.noteId,
        memberId: input.memberId,
        providerLetterId: null,
        status: "starting",
      },
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function markLegacyPhysicalNoteAbsent(input: {
  memberId: string;
  noteId: string;
  prisma: PrismaClient;
}): Promise<HostedPhysicalNote> {
  return await input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    await tx.hostedPhysicalNote.updateMany({
      data: { failureReason: "unknown" },
      where: {
        failureReason: null,
        id: input.noteId,
        memberId: input.memberId,
        providerLetterId: null,
        status: "failed",
      },
    });
    const note = await tx.hostedPhysicalNote.findUniqueOrThrow({
      where: { id: input.noteId },
    });
    if (
      note.memberId !== input.memberId
      || note.status !== "failed"
      || note.failureReason === null
    ) {
      throw new Error("Legacy physical-note absence invariant failed.");
    }
    return note;
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
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
    | "complimentaryOfferCode"
    | "failureReason"
    | "id"
    | "providerCostUsdMicros"
  >,
  status: HostedPhysicalNoteSendResponse["status"],
): HostedPhysicalNoteSendResponse {
  const failureReason = status === "failed" ? note.failureReason : null;
  if (status === "failed" && failureReason === null) {
    throw new Error("Legacy physical-note outcome remains unresolved.");
  }
  return {
    complimentary: note.complimentaryOfferCode !== null,
    costUsdMicros: note.providerCostUsdMicros.toString(),
    ...(failureReason ? { failureReason } : {}),
    physicalNoteId: note.id,
    status,
  };
}

function createPhysicalNoteId(): string {
  return `hpn_${randomUUID().replaceAll("-", "")}`;
}

function unavailableResponse(): HostedPhysicalNoteSendResponse {
  return {
    complimentary: false,
    costUsdMicros: "0",
    physicalNoteId: null,
    status: "unavailable",
  };
}
