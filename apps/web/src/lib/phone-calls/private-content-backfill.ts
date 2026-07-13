import { isDeepStrictEqual } from "node:util";

import {
  Prisma,
  type HostedPhoneCall,
  type PrismaClient,
} from "@prisma/client";
import {
  hostedPhoneCallBriefSchema,
  hostedPhoneCallResultSchema,
} from "@murphai/hosted-execution/phone-calls";

import { getPrisma } from "../prisma";
import {
  hostedPhoneCallCrypto,
  type HostedPhoneCallCrypto,
} from "./crypto";

const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;

export type HostedPhoneCallPrivateContentBackfillMode = "apply" | "dry-run";

export interface HostedPhoneCallPrivateContentBackfillCandidate {
  briefEncrypted: string | null;
  briefJson: HostedPhoneCall["briefJson"];
  id: string;
  memberId: string;
  resultEncrypted: string | null;
  resultJson: HostedPhoneCall["resultJson"];
  updatedAt: Date;
}

export interface HostedPhoneCallPrivateContentBackfillStore {
  applyCandidate(input: {
    briefEncrypted: string | null;
    expectedBriefEncrypted: string | null;
    expectedBriefJson: HostedPhoneCall["briefJson"];
    expectedResultEncrypted: string | null;
    expectedResultJson: HostedPhoneCall["resultJson"];
    id: string;
    memberId: string;
    resultEncrypted: string | null;
    scrubBrief: boolean;
    scrubResult: boolean;
    updatedAt: Date;
  }): Promise<boolean>;
  listCandidates(input: {
    take: number;
  }): Promise<HostedPhoneCallPrivateContentBackfillCandidate[]>;
}

interface HostedPhoneCallPrivateContentBackfillFieldSummary {
  encrypted: number;
  scrubbed: number;
  wouldEncrypt: number;
  wouldScrub: number;
}

export interface HostedPhoneCallPrivateContentBackfillSummary {
  batchSize: number;
  conflicts: number;
  fields: {
    brief: HostedPhoneCallPrivateContentBackfillFieldSummary;
    result: HostedPhoneCallPrivateContentBackfillFieldSummary;
  };
  hasMore: boolean;
  mode: HostedPhoneCallPrivateContentBackfillMode;
  selectedRows: number;
}

export async function backfillHostedPhoneCallPrivateContent(input: {
  batchSize?: number;
  crypto?: HostedPhoneCallCrypto;
  mode?: HostedPhoneCallPrivateContentBackfillMode;
  store?: HostedPhoneCallPrivateContentBackfillStore;
} = {}): Promise<HostedPhoneCallPrivateContentBackfillSummary> {
  const batchSize = normalizeBatchSize(input.batchSize);
  const mode = input.mode ?? "dry-run";
  const store = input.store ?? createHostedPhoneCallPrivateContentBackfillStore();
  const crypto = input.crypto ?? hostedPhoneCallCrypto;
  const candidates = await store.listCandidates({ take: batchSize + 1 });
  const selected = candidates.slice(0, batchSize);
  const summary: HostedPhoneCallPrivateContentBackfillSummary = {
    batchSize,
    conflicts: 0,
    fields: {
      brief: emptyFieldSummary(),
      result: emptyFieldSummary(),
    },
    hasMore: candidates.length > batchSize,
    mode,
    selectedRows: selected.length,
  };

  for (const candidate of selected) {
    const scrubBrief = candidate.briefJson !== null;
    const scrubResult = candidate.resultJson !== null;
    const encryptBrief = scrubBrief && candidate.briefEncrypted === null;
    const encryptResult = scrubResult && candidate.resultEncrypted === null;

    summary.fields.brief.wouldEncrypt += Number(encryptBrief);
    summary.fields.brief.wouldScrub += Number(scrubBrief);
    summary.fields.result.wouldEncrypt += Number(encryptResult);
    summary.fields.result.wouldScrub += Number(scrubResult);

    if (mode === "dry-run") {
      validateLegacyPrivateContent(candidate);
      continue;
    }

    const legacyBrief = scrubBrief
      ? hostedPhoneCallBriefSchema.parse(candidate.briefJson)
      : null;
    const legacyResult = scrubResult
      ? hostedPhoneCallResultSchema.parse(candidate.resultJson)
      : null;
    const briefEncrypted = encryptBrief
      ? await encryptAndVerifyBrief({ candidate, crypto, value: legacyBrief })
      : candidate.briefEncrypted;
    const resultEncrypted = encryptResult
      ? await encryptAndVerifyResult({ candidate, crypto, value: legacyResult })
      : candidate.resultEncrypted;

    if (legacyBrief && briefEncrypted !== null && !encryptBrief) {
      const decrypted = await crypto.decryptBrief({
        callId: candidate.id,
        memberId: candidate.memberId,
        value: briefEncrypted,
      });
      assertPrivateContentMatches(decrypted, legacyBrief);
    }
    if (legacyResult && resultEncrypted !== null && !encryptResult) {
      const decrypted = await crypto.decryptResult({
        callId: candidate.id,
        memberId: candidate.memberId,
        value: resultEncrypted,
      });
      assertPrivateContentMatches(decrypted, legacyResult);
    }

    const applied = await store.applyCandidate({
      briefEncrypted,
      expectedBriefEncrypted: candidate.briefEncrypted,
      expectedBriefJson: candidate.briefJson,
      expectedResultEncrypted: candidate.resultEncrypted,
      expectedResultJson: candidate.resultJson,
      id: candidate.id,
      memberId: candidate.memberId,
      resultEncrypted,
      scrubBrief,
      scrubResult,
      updatedAt: candidate.updatedAt,
    });
    if (!applied) {
      summary.conflicts += 1;
      continue;
    }

    summary.fields.brief.encrypted += Number(encryptBrief);
    summary.fields.brief.scrubbed += Number(scrubBrief);
    summary.fields.result.encrypted += Number(encryptResult);
    summary.fields.result.scrubbed += Number(scrubResult);
  }

  return summary;
}

export function createHostedPhoneCallPrivateContentBackfillStore(
  prisma: Pick<PrismaClient, "hostedPhoneCall"> = getPrisma(),
): HostedPhoneCallPrivateContentBackfillStore {
  return {
    applyCandidate: async (input) => {
      const updated = await prisma.hostedPhoneCall.updateMany({
        data: {
          ...(input.briefEncrypted !== input.expectedBriefEncrypted
            ? { briefEncrypted: input.briefEncrypted }
            : {}),
          ...(input.resultEncrypted !== input.expectedResultEncrypted
            ? { resultEncrypted: input.resultEncrypted }
            : {}),
          ...(input.scrubBrief ? { briefJson: Prisma.DbNull } : {}),
          ...(input.scrubResult ? { resultJson: Prisma.DbNull } : {}),
        },
        where: {
          briefEncrypted: input.expectedBriefEncrypted,
          briefJson: jsonEquals(input.expectedBriefJson),
          id: input.id,
          memberId: input.memberId,
          resultEncrypted: input.expectedResultEncrypted,
          resultJson: jsonEquals(input.expectedResultJson),
          updatedAt: input.updatedAt,
        },
      });
      return updated.count === 1;
    },
    listCandidates: async ({ take }) => prisma.hostedPhoneCall.findMany({
      orderBy: { id: "asc" },
      select: {
        briefEncrypted: true,
        briefJson: true,
        id: true,
        memberId: true,
        resultEncrypted: true,
        resultJson: true,
        updatedAt: true,
      },
      take,
      where: {
        OR: [
          { briefJson: { not: Prisma.AnyNull } },
          { resultJson: { not: Prisma.AnyNull } },
        ],
      },
    }),
  };
}

async function encryptAndVerifyBrief(input: {
  candidate: HostedPhoneCallPrivateContentBackfillCandidate;
  crypto: HostedPhoneCallCrypto;
  value: ReturnType<typeof hostedPhoneCallBriefSchema.parse> | null;
}): Promise<string> {
  if (!input.value) {
    throw new Error("Hosted phone-call private-content backfill requires a legacy brief.");
  }
  const encrypted = await input.crypto.encryptBrief({
    callId: input.candidate.id,
    memberId: input.candidate.memberId,
    value: input.value,
  });
  const decrypted = await input.crypto.decryptBrief({
    callId: input.candidate.id,
    memberId: input.candidate.memberId,
    value: encrypted,
  });
  assertPrivateContentMatches(decrypted, input.value);
  return encrypted;
}

async function encryptAndVerifyResult(input: {
  candidate: HostedPhoneCallPrivateContentBackfillCandidate;
  crypto: HostedPhoneCallCrypto;
  value: ReturnType<typeof hostedPhoneCallResultSchema.parse> | null;
}): Promise<string> {
  if (!input.value) {
    throw new Error("Hosted phone-call private-content backfill requires a legacy result.");
  }
  const encrypted = await input.crypto.encryptResult({
    callId: input.candidate.id,
    memberId: input.candidate.memberId,
    value: input.value,
  });
  const decrypted = await input.crypto.decryptResult({
    callId: input.candidate.id,
    memberId: input.candidate.memberId,
    value: encrypted,
  });
  assertPrivateContentMatches(decrypted, input.value);
  return encrypted;
}

function jsonEquals(
  value: HostedPhoneCall["briefJson"] | HostedPhoneCall["resultJson"],
): Prisma.JsonNullableFilter<"HostedPhoneCall"> {
  if (value === null) {
    return { equals: Prisma.DbNull };
  }
  return { equals: value };
}

function assertPrivateContentMatches(actual: unknown, expected: unknown): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error("Hosted phone-call private-content verification failed.");
  }
}

function validateLegacyPrivateContent(
  candidate: HostedPhoneCallPrivateContentBackfillCandidate,
): void {
  if (candidate.briefJson !== null) {
    hostedPhoneCallBriefSchema.parse(candidate.briefJson);
  }
  if (candidate.resultJson !== null) {
    hostedPhoneCallResultSchema.parse(candidate.resultJson);
  }
}

function normalizeBatchSize(value: number | undefined): number {
  const batchSize = value ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`Hosted phone-call private-content batch size must be between 1 and ${MAX_BATCH_SIZE}.`);
  }
  return batchSize;
}

function emptyFieldSummary(): HostedPhoneCallPrivateContentBackfillFieldSummary {
  return {
    encrypted: 0,
    scrubbed: 0,
    wouldEncrypt: 0,
    wouldScrub: 0,
  };
}
