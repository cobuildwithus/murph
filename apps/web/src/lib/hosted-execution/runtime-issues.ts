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
  const recordedIds: string[] = [];

  for (const record of records) {
    await prisma.hostedAssistantRuntimeIssue.upsert({
      where: {
        id: record.issueId,
      },
      create: {
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
      },
      update: {},
    });
    recordedIds.push(record.issueId);
  }

  return {
    recordedIds,
    records,
  };
}

function toPrismaJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
