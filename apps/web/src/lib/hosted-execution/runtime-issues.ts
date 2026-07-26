import {
  Prisma,
  type PrismaClient,
} from "@prisma/client";
import {
  parseAssistantRuntimeIssueRecord,
  type AssistantRuntimeIssueRecord,
} from "@murphai/runtime-state/node/assistant-runtime-issues";

import { getPrisma } from "../prisma";

export interface ImportHostedAssistantRuntimeIssuesResult {
  recordedIds: string[];
  records: AssistantRuntimeIssueRecord[];
}

const HOSTED_ASSISTANT_RUNTIME_ISSUE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

type HostedAssistantRuntimeIssueClient = PrismaClient | Prisma.TransactionClient;

export async function importHostedAssistantRuntimeIssues(input: {
  issues: readonly unknown[];
  now?: Date;
  prisma?: HostedAssistantRuntimeIssueClient;
}): Promise<ImportHostedAssistantRuntimeIssuesResult> {
  const prisma = input.prisma ?? getPrisma();
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + HOSTED_ASSISTANT_RUNTIME_ISSUE_RETENTION_MS);
  const records = input.issues.map((entry) => parseAssistantRuntimeIssueRecord(entry));

  if (records.length > 0) {
    // Issue ids are already stable and an existing row was never updated, so
    // `createMany(skipDuplicates)` is the same import in one round trip
    // instead of one per issue.
    await prisma.hostedAssistantRuntimeIssue.createMany({
      data: records.map((record) => ({
        id: record.issueId,
        occurredAt: new Date(record.occurredAt),
        expiresAt,
        environment: record.environment,
        surface: record.surface,
        phase: record.phase,
        severity: record.severity,
        issueKind: record.issueKind,
        component: record.component,
        operation: record.operation,
        errorCode: record.errorCode,
        summary: record.summary,
        fingerprint: record.fingerprint,
        detailsJson: toPrismaJson(record.details),
      })),
      skipDuplicates: true,
    });
  }

  return {
    recordedIds: records.map((record) => record.issueId),
    records,
  };
}

function toPrismaJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
