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
  if (existing) {
    return await resolveExactPhysicalNoteReplay({
      memberId: input.memberId,
      prisma,
      row: existing,
      runtime,
      signal: input.signal,
    });
  }
  const prior = await findPhysicalNoteEffectGuard({
    memberId: input.memberId,
    prisma,
  });
  if (prior) {
    const guarded = prior.requestKey === input.requestKey
      ? { current: prior, prior }
      : await recordPhysicalNoteBlockedRequest({
          memberId: input.memberId,
          pricingVersion: config.pricingVersion,
          prisma,
          providerCostUsdMicros: config.costUsdMicros,
          requestFingerprint,
          requestKey: input.requestKey,
        });
    if (guarded) {
      return await resolvePhysicalNoteEffectGuard({
        current: guarded.current,
        memberId: input.memberId,
        prior: guarded.prior,
        prisma,
        runtime,
        signal: input.signal,
      });
    }
  }

  const artworkExpiresAt = new Date(input.artwork.expiresAt);
  if (artworkExpiresAt.getTime() <= Date.now() + 60_000) {
    throw new TypeError("Physical-note artwork URL expires too soon.");
  }
  await reassertGroupOrigin?.();
  input.signal?.throwIfAborted();

  const reservation = await prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    const guarded = await reservePhysicalNoteBlockedRequestTx({
      memberId: input.memberId,
      pricingVersion: config.pricingVersion,
      providerCostUsdMicros: config.costUsdMicros,
      requestFingerprint,
      requestKey: input.requestKey,
      tx,
    });
    if (guarded) {
      return {
        kind: "guarded" as const,
        ...guarded,
      };
    }
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
      return { kind: "existing" as const, row: existing };
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
      if (
        !gate.allowed
        || gate.remainingUsdMicros < config.costUsdMicros
      ) {
        return {
          kind: "insufficient" as const,
          costUsdMicros: config.costUsdMicros,
        };
      }
    }

    return {
      kind: "created" as const,
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

  if (reservation.kind === "guarded") {
    return await resolvePhysicalNoteEffectGuard({
      current: reservation.current,
      memberId: input.memberId,
      prior: reservation.prior,
      prisma,
      runtime,
      signal: input.signal,
    });
  }
  if (reservation.kind === "insufficient") {
    return {
      complimentary: false,
      costUsdMicros: reservation.costUsdMicros.toString(),
      physicalNoteId: null,
      status: "insufficient_usage",
    };
  }

  if (reservation.kind === "existing") {
    const replay = await resolveHostedPhysicalNoteReplay({
      requestFingerprint,
      row: reservation.row,
    });
    return replay ?? toResponse(reservation.row, "pending");
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
  requestFingerprint: string;
  row: HostedPhysicalNote;
}): Promise<HostedPhysicalNoteSendResponse | null> {
  if (input.row.requestFingerprint !== input.requestFingerprint) {
    throw new Error("Hosted physical-note request key collision.");
  }
  if (input.row.status === "accepted") {
    requireProviderLetterId(input.row);
    if (input.row.acceptedAt === null) {
      throw new Error("Accepted physical note is missing its acceptance time.");
    }
    return toResponse(input.row, "accepted");
  }
  if (input.row.status === "failed") {
    return input.row.failureReason === null
      ? null
      : toResponse(input.row, "failed");
  }
  return null;
}

async function resolveGuardedPhysicalNote(input: {
  allowRecentLookup: boolean;
  memberId: string;
  prior: HostedPhysicalNote;
  prisma: PrismaClient;
  runtime: LobPhysicalNoteRuntime;
  signal?: AbortSignal;
}): Promise<void> {
  const mayResolveAbsence =
    Date.now() - input.prior.createdAt.getTime() >= REPLAY_WINDOW_MS;
  if (!input.allowRecentLookup && !mayResolveAbsence) {
    return;
  }
  const providerResult = await input.runtime.findLetterByNoteId({
    noteId: input.prior.id,
    signal: input.signal,
  });
  if (providerResult.kind === "indeterminate") {
    return;
  }
  if (providerResult.kind === "accepted") {
    if (input.prior.status === "starting") {
      await finalizeHostedPhysicalNoteAcceptance({
        acceptedAt: new Date(),
        memberId: input.memberId,
        noteId: input.prior.id,
        prisma: input.prisma,
        providerLetterId: providerResult.providerLetterId,
      });
    } else {
      await finalizeLegacyPhysicalNoteAcceptance({
        acceptedAt: new Date(),
        memberId: input.memberId,
        noteId: input.prior.id,
        prisma: input.prisma,
        providerLetterId: providerResult.providerLetterId,
      });
    }
    return;
  }
  if (!mayResolveAbsence) {
    return;
  }

  await markGuardedPhysicalNoteAbsent({
    memberId: input.memberId,
    noteId: input.prior.id,
    prisma: input.prisma,
  });
}

async function resolveExactPhysicalNoteReplay(input: {
  memberId: string;
  prisma: PrismaClient;
  row: HostedPhysicalNote;
  runtime: LobPhysicalNoteRuntime;
  signal?: AbortSignal;
}): Promise<HostedPhysicalNoteSendResponse> {
  await resolveGuardedPhysicalNote({
    allowRecentLookup: input.row.status === "starting",
    memberId: input.memberId,
    prior: input.row,
    prisma: input.prisma,
    runtime: input.runtime,
    signal: input.signal,
  });
  const reconciled = await input.prisma.hostedPhysicalNote.findUniqueOrThrow({
    where: { id: input.row.id },
  });
  if (reconciled.status === "accepted") {
    return toResponse(reconciled, "accepted");
  }
  return reconciled.failureReason === null
    ? toResponse(reconciled, "pending")
    : toResponse(reconciled, "failed");
}

async function findPhysicalNoteEffectGuard(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<HostedPhysicalNote | null> {
  return await input.prisma.hostedPhysicalNote.findFirst({
    orderBy: { createdAt: "asc" },
    where: {
      memberId: input.memberId,
      OR: [
        {
          status: "starting",
        },
        {
          failureReason: null,
          status: "failed",
        },
      ],
    },
  });
}

type PhysicalNoteGuardedRequest = {
  current: HostedPhysicalNote;
  prior: HostedPhysicalNote;
};

async function recordPhysicalNoteBlockedRequest(input: {
  memberId: string;
  pricingVersion: string;
  prisma: PrismaClient;
  providerCostUsdMicros: bigint;
  requestFingerprint: string;
  requestKey: string;
}): Promise<PhysicalNoteGuardedRequest | null> {
  return await input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    return await reservePhysicalNoteBlockedRequestTx({
      memberId: input.memberId,
      pricingVersion: input.pricingVersion,
      providerCostUsdMicros: input.providerCostUsdMicros,
      requestFingerprint: input.requestFingerprint,
      requestKey: input.requestKey,
      tx,
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function reservePhysicalNoteBlockedRequestTx(input: {
  memberId: string;
  pricingVersion: string;
  providerCostUsdMicros: bigint;
  requestFingerprint: string;
  requestKey: string;
  tx: Prisma.TransactionClient;
}): Promise<PhysicalNoteGuardedRequest | null> {
  const prior = await findPhysicalNoteEffectGuard({
    memberId: input.memberId,
    prisma: input.tx,
  });
  if (!prior) return null;
  const blockerReason: HostedPhysicalNoteFailureReason =
    prior.status === "accepted"
      ? "prior_note_accepted"
      : "prior_note_unresolved";
  const existing = await input.tx.hostedPhysicalNote.findUnique({
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
    return { current: existing, prior };
  }
  await assertHostedPhysicalNoteMemberAccess({
    memberId: input.memberId,
    prisma: input.tx,
  });
  const current = await input.tx.hostedPhysicalNote.create({
    data: {
      complimentaryOfferCode: null,
      failureReason: blockerReason,
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
  return { current, prior };
}

async function resolvePhysicalNoteEffectGuard(input: {
  current: HostedPhysicalNote;
  memberId: string;
  prior: HostedPhysicalNote;
  prisma: PrismaClient;
  runtime: LobPhysicalNoteRuntime;
  signal?: AbortSignal;
}): Promise<HostedPhysicalNoteSendResponse> {
  if (input.current.status === "accepted") {
    return toResponse(input.current, "accepted");
  }
  if (input.current.failureReason === "prior_note_accepted") {
    return toResponse(input.current, "failed");
  }
  if (input.current.failureReason === null) {
    return await resolveExactPhysicalNoteReplay({
      memberId: input.memberId,
      prisma: input.prisma,
      row: input.current,
      runtime: input.runtime,
      signal: input.signal,
    });
  }
  await resolveGuardedPhysicalNote({
    allowRecentLookup: false,
    memberId: input.memberId,
    prior: input.prior,
    prisma: input.prisma,
    runtime: input.runtime,
    signal: input.signal,
  });
  const reconciledCurrent = await input.prisma.hostedPhysicalNote.findUniqueOrThrow({
    where: { id: input.current.id },
  });
  return reconciledCurrent.status === "failed"
    ? toResponse(reconciledCurrent, "failed")
    : toResponse(reconciledCurrent, "pending");
}

async function assertHostedPhysicalNoteMemberAccess(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  if (!await readActiveHostedMemberAccess(input)) {
    await assertActiveHostedMemberAccessAllowed(input);
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
    const guard = await findPhysicalNoteEffectGuard({
      memberId: input.memberId,
      prisma: tx,
    });
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
        failureReason: "prior_note_accepted",
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
      || note.failureReason !== "prior_note_accepted"
      || note.providerLetterId !== input.providerLetterId
      || note.acceptedAt === null
    ) {
      throw new Error("Legacy physical-note acceptance invariant failed.");
    }
    if (guard?.id === input.noteId) {
      await tx.hostedPhysicalNote.updateMany({
        data: { failureReason: "prior_note_accepted" },
        where: {
          failureReason: "prior_note_unresolved",
          memberId: input.memberId,
          providerLetterId: null,
          status: "failed",
        },
      });
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
    const guard = await findPhysicalNoteEffectGuard({
      memberId: input.memberId,
      prisma: tx,
    });
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
    if (guard?.id === input.noteId) {
      await tx.hostedPhysicalNote.updateMany({
        data: { failureReason: "prior_note_accepted" },
        where: {
          failureReason: "prior_note_unresolved",
          memberId: input.memberId,
          providerLetterId: null,
          status: "failed",
        },
      });
    }
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
    const guard = await findPhysicalNoteEffectGuard({
      memberId: input.memberId,
      prisma: tx,
    });
    const failed = await tx.hostedPhysicalNote.updateMany({
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
    if (failed.count > 0 && guard?.id === input.noteId) {
      await tx.hostedPhysicalNote.updateMany({
        data: { failureReason: "unknown" },
        where: {
          failureReason: "prior_note_unresolved",
          memberId: input.memberId,
          providerLetterId: null,
          status: "failed",
        },
      });
    }
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function markGuardedPhysicalNoteAbsent(input: {
  memberId: string;
  noteId: string;
  prisma: PrismaClient;
}): Promise<HostedPhysicalNote> {
  return await input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    const guard = await findPhysicalNoteEffectGuard({
      memberId: input.memberId,
      prisma: tx,
    });
    await tx.hostedPhysicalNote.updateMany({
      data: {
        complimentaryOfferCode: null,
        failureReason: "unknown",
        status: "failed",
      },
      where: {
        failureReason: null,
        id: input.noteId,
        memberId: input.memberId,
        providerLetterId: null,
        OR: [
          { status: "failed" },
          { status: "starting" },
        ],
      },
    });
    if (guard?.id === input.noteId) {
      await tx.hostedPhysicalNote.updateMany({
        data: { failureReason: "unknown" },
        where: {
          failureReason: "prior_note_unresolved",
          memberId: input.memberId,
          providerLetterId: null,
          status: "failed",
        },
      });
    }
    const note = await tx.hostedPhysicalNote.findUniqueOrThrow({
      where: { id: input.noteId },
    });
    if (
      note.memberId !== input.memberId
      || note.status !== "failed"
      || note.failureReason === null
    ) {
      throw new Error("Guarded physical-note absence invariant failed.");
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
  const failureReason = status === "failed"
    || (
      status === "accepted"
      && note.failureReason === "prior_note_accepted"
    )
    ? note.failureReason
    : null;
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
