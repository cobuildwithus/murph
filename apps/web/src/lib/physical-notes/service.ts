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

type PriorAcceptedPhysicalNote = NonNullable<
  HostedPhysicalNoteSendResponse["priorAcceptedPhysicalNote"]
>;

export async function createHostedPhysicalNote(input: HostedPhysicalNoteSendRequest & {
  memberId: string;
  prisma?: PrismaClient;
  runtime?: LobPhysicalNoteRuntime;
  signal?: AbortSignal;
}): Promise<HostedPhysicalNoteSendResponse> {
  const prisma = input.prisma ?? getPrisma();
  const config = readPhysicalNoteConfig();
  const recipient = normalizeHostedPhysicalNoteRecipient(input.recipient);
  let priorAcceptedPhysicalNote: PriorAcceptedPhysicalNote | null = null;
  const respond = (
    response: HostedPhysicalNoteSendResponse,
  ): HostedPhysicalNoteSendResponse => priorAcceptedPhysicalNote
    ? { ...response, priorAcceptedPhysicalNote }
    : response;

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
  let existing = await prisma.hostedPhysicalNote.findUnique({
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
  const runtime = config
    ? input.runtime ?? createLobPhysicalNoteRuntime({
      apiKey: config.apiKey,
      fromAddressId: config.fromAddressId,
    })
    : null;
  if (runtime) {
    priorAcceptedPhysicalNote = await resolveStaleComplimentaryPhysicalNote({
      memberId: input.memberId,
      prisma,
      runtime,
      signal: input.signal,
    });
    if (existing) {
      existing = await prisma.hostedPhysicalNote.findUniqueOrThrow({
        where: { id: existing.id },
      });
    }
  }
  if (existing) {
    const replay = await resolveHostedPhysicalNoteReplay({
      memberId: input.memberId,
      prisma,
      requestFingerprint,
      row: existing,
    });
    if (replay) {
      return respond(replay);
    }
    if (!config) {
      return respond(toResponse(existing, "pending"));
    }
  } else if (!config) {
    return respond(unavailableResponse());
  }

  if (!config || !runtime) {
    throw new Error("Hosted physical-note configuration invariant failed.");
  }
  const artworkExpiresAt = new Date(input.artwork.expiresAt);
  if (artworkExpiresAt.getTime() <= Date.now() + 60_000) {
    throw new TypeError("Physical-note artwork URL expires too soon.");
  }
  await reassertGroupOrigin?.();
  input.signal?.throwIfAborted();

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
    return respond({
      complimentary: false,
      costUsdMicros: reservation.costUsdMicros.toString(),
      physicalNoteId: null,
      status: "insufficient_usage",
    });
  }

  const replay = await resolveHostedPhysicalNoteReplay({
    memberId: input.memberId,
    prisma,
    requestFingerprint,
    row: reservation.row,
  });
  if (replay) {
    return respond(replay);
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
      return respond(toResponse(accepted, "accepted"));
    }
    if (current.status === "failed") {
      return respond(toResponse(current, "failed"));
    }
    return respond(toResponse(current, "pending"));
  }
  if (providerResult.kind === "definite_failure") {
    await markHostedPhysicalNoteFailed({
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
      return respond(toResponse(accepted, "accepted"));
    }
    return respond(toResponse(current, "failed"));
  }

  const accepted = await finalizeHostedPhysicalNoteAcceptance({
    acceptedAt: new Date(),
    memberId: input.memberId,
    noteId: reservation.row.id,
    prisma,
    providerLetterId: providerResult.providerLetterId,
  });
  return respond(toResponse(accepted, "accepted"));
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
    return toResponse(input.row, "failed");
  }
  return Date.now() - input.row.createdAt.getTime() >= REPLAY_WINDOW_MS
    ? toResponse(input.row, "pending")
    : null;
}

async function resolveStaleComplimentaryPhysicalNote(input: {
  memberId: string;
  prisma: PrismaClient;
  runtime: LobPhysicalNoteRuntime;
  signal?: AbortSignal;
}): Promise<PriorAcceptedPhysicalNote | null> {
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
  if (!stale) return null;

  const providerResult = await input.runtime.findLetterByNoteId({
    noteId: stale.id,
    signal: input.signal,
  });
  if (providerResult.kind === "accepted") {
    const accepted = await finalizeHostedPhysicalNoteAcceptance({
      acceptedAt: new Date(),
      memberId: input.memberId,
      noteId: stale.id,
      prisma: input.prisma,
      providerLetterId: providerResult.providerLetterId,
    });
    return { physicalNoteId: accepted.id };
  }
  if (providerResult.kind === "absent") {
    await markHostedPhysicalNoteFailed({
      memberId: input.memberId,
      noteId: stale.id,
      prisma: input.prisma,
    });
  }
  return null;
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
  memberId: string;
  noteId: string;
  prisma: PrismaClient;
}): Promise<void> {
  await input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    await tx.hostedPhysicalNote.updateMany({
      data: {
        complimentaryOfferCode: null,
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
