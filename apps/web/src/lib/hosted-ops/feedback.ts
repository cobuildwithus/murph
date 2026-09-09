import "server-only";

import { sanitizeHostedProductFeedbackSummary } from "@murphai/hosted-execution/runtime-control";
import { getPrisma } from "../prisma";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { admitHostedOperatorTask, decryptOperatorTaskResult, resolveHostedOperatorTaskStatus } from "./operator-task";
import { HOSTED_OPERATOR_TASK_RESULT_RETENTION_MS } from "./operator-task-retention";

const PAGE_SIZE = 20;

export async function listHostedOpsFeedback(after?: string) {
  const rows = await getPrisma().hostedProductFeedback.findMany({
    select: { id: true, kind: true, summary: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(after ? { cursor: { id: after }, skip: 1 } : {}),
  });
  return {
    feedback: rows.slice(0, PAGE_SIZE).map((row) => ({
      id: row.id,
      kind: row.kind,
      summary: row.summary ? sanitizeHostedProductFeedbackSummary(row.summary) : null,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: rows.length > PAGE_SIZE ? rows[PAGE_SIZE - 1]?.id ?? null : null,
  };
}

export async function listHostedFeedbackDiagnostics(input: {
  feedbackId: string;
  after?: string;
  now?: Date;
}) {
  const rows = await getPrisma().hostedOperatorTask.findMany({
    where: { feedbackId: input.feedbackId, kind: "diagnostic" },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    ...(input.after ? { cursor: { id: input.after }, skip: 1 } : {}),
  });
  const now = input.now ?? new Date();
  const tasks = await Promise.all(rows.slice(0, PAGE_SIZE).map(async (row) => {
    const resultExpiresAt = row.completedAt
      ? new Date(row.completedAt.getTime() + HOSTED_OPERATOR_TASK_RESULT_RETENTION_MS)
      : null;
    const result = row.resultEncrypted && resultExpiresAt && resultExpiresAt > now
      ? await decryptOperatorTaskResult({
          memberId: row.memberId, taskId: row.id, value: row.resultEncrypted,
        })
      : null;
    return {
      id: row.id,
      status: resolveHostedOperatorTaskStatus(row, now),
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      resultExpiresAt: resultExpiresAt?.toISOString() ?? null,
      answer: result?.answer ? sanitizeHostedProductFeedbackSummary(result.answer) : null,
    };
  }));
  return {
    tasks,
    nextCursor: rows.length > PAGE_SIZE ? rows[PAGE_SIZE - 1]?.id ?? null : null,
  };
}

export async function requestHostedFeedbackDiagnostic(input: {
  feedbackId: string;
  question: string;
  idempotencyKey: string;
  requestedByMemberId: string;
  signal?: AbortSignal;
}) {
  const feedback = await getPrisma().hostedProductFeedback.findUnique({
    where: { id: input.feedbackId },
    select: { memberId: true },
  });
  if (!feedback?.memberId) {
    throw hostedOnboardingError({
      code: "HOSTED_FEEDBACK_TARGET_UNAVAILABLE",
      httpStatus: 409,
      message: "This feedback has no linked workspace. Continue with code investigation.",
      retryable: false,
    });
  }
  const task = await admitHostedOperatorTask({
    feedbackId: input.feedbackId,
    idempotencyKey: input.idempotencyKey,
    kind: "diagnostic",
    memberId: feedback.memberId,
    prompt: input.question,
    requestedByMemberId: input.requestedByMemberId,
    signal: input.signal,
    source: "ops",
  });
  // Never serialize the ordinary operator-task view here: it includes linkage.
  return { id: task.id, status: task.status, expiresAt: task.expiresAt };
}
