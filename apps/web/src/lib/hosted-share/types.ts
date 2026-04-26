import type { Prisma, PrismaClient } from "@prisma/client";
import type { SharePack } from "@murphai/contracts";

export type HostedSharePageStage = "invalid" | "expired" | "signin" | "ready" | "processing" | "consumed";
export type HostedShareKind = "food" | "recipe" | "regimen";

export interface HostedSharePreview {
  kinds: HostedShareKind[];
  counts: {
    foods: number;
    recipes: number;
    regimens: number;
    total: number;
  };
  logMealAfterImport: boolean;
}

export interface HostedSharePageData {
  inviteCode: string | null;
  session: {
    active: boolean;
    authenticated: boolean;
  };
  share: {
    acceptedByCurrentMember: boolean;
    consumed: boolean;
    expiresAt: string;
    preview: HostedSharePreview;
  } | null;
  stage: HostedSharePageStage;
}

export interface CreateHostedShareLinkResult {
  inviteCode: string | null;
  joinUrl: string | null;
  shareCode: string;
  shareUrl: string;
  url: string;
}

export interface HostedSharePayloadState {
  pack: SharePack;
  payloadSchema: string;
  shareId: string;
}

export interface AcceptHostedShareResult {
  alreadyImported: boolean;
  imported: boolean;
  pending: boolean;
  shareCode: string;
}

export type HostedSharePrismaClient = PrismaClient | Prisma.TransactionClient;
