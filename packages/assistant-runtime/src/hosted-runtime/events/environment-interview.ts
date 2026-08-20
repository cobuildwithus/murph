import { upsertHabitatAspect } from "@murphai/core";
import type {
  HostedExecutionEnvironmentInterviewCompletedWake,
} from "@murphai/hosted-execution";

import {
  createNoopMailboxEffect,
  type HostedMailboxOutcome,
} from "./mailbox-outcome.ts";

export async function executeHostedEnvironmentInterviewWake(input: {
  vaultRoot: string;
  wake: HostedExecutionEnvironmentInterviewCompletedWake;
}): Promise<HostedMailboxOutcome> {
  const indicatorsByAspect = new Map<
    string,
    Record<string, string | number | boolean>
  >();
  const indicatorNotesByAspect = new Map<
    string,
    Record<string, string | null>
  >();

  for (const topic of input.wake.environmentInterview.topics) {
    for (const answer of topic.answers) {
      const indicators = indicatorsByAspect.get(answer.aspectId) ?? {};
      indicators[answer.indicatorId] = answer.value;
      indicatorsByAspect.set(answer.aspectId, indicators);
      if (answer.note !== undefined) {
        const indicatorNotes = indicatorNotesByAspect.get(answer.aspectId) ?? {};
        indicatorNotes[answer.indicatorId] = answer.note;
        indicatorNotesByAspect.set(answer.aspectId, indicatorNotes);
      }
    }
  }

  const recordedAt = input.wake.environmentInterview.completedAt.slice(0, 10);
  for (const [aspect, indicators] of indicatorsByAspect) {
    await upsertHabitatAspect({
      aspect,
      indicators,
      indicatorNotes: indicatorNotesByAspect.get(aspect),
      recordedAt,
      vaultRoot: input.vaultRoot,
    });
  }

  return createNoopMailboxEffect({
    conversationMetrics: null,
    mailboxLane: "environment-voice",
  });
}
