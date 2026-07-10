import "server-only";

import type {
  HostedCallCircleMatch,
  HostedCallCircleParticipant,
  HostedCallCircleParticipantStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";

export type CallCirclePrismaClient = PrismaClient | Prisma.TransactionClient;

export type CallCircleSide = "A" | "B";

export type CallCircleMatchOutcome =
  | "completed"
  | "connector_agent_unconfigured"
  | "connector_start_failed"
  | "declined_by_a"
  | "declined_by_b"
  | "expired"
  | "notification_blocked"
  | "participant_unavailable"
  | "text_handoff"
  | "verified_phone_missing";

export type CallCircleParticipantRow = HostedCallCircleParticipant;
export type CallCircleMatchRow = HostedCallCircleMatch;
export type CallCircleParticipantStatus = HostedCallCircleParticipantStatus;
