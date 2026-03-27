import type { Prisma, PrismaClient } from "@prisma/client";

export type HostedSharePageStage = "invalid" | "expired" | "signin" | "ready" | "consumed";

export interface HostedSharePreview {
  counts: {
    foods: number;
    protocols: number;
    recipes: number;
  };
  foodTitles: string[];
  protocolTitles: string[];
  recipeTitles: string[];
  logMealAfterImport: boolean;
  title: string;
}

export interface HostedSharePageData {
  inviteCode: string | null;
  session: {
    active: boolean;
    authenticated: boolean;
    memberId: string | null;
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
  preview: HostedSharePreview;
  shareCode: string;
  shareUrl: string;
  url: string;
}

export interface AcceptHostedShareResult {
  alreadyImported: boolean;
  imported: boolean;
  preview: HostedSharePreview;
  shareCode: string;
}

export type HostedSharePrismaClient = PrismaClient | Prisma.TransactionClient;
