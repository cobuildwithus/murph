import { serializeHostedEmailThreadTarget } from "@murphai/runtime-state";
import { describe, expect, it } from "vitest";
import { parseInput, RequestInputError } from "../src/request-input.ts";
import { parseHostedEmailIngressWakeAppendRequest } from "../src/email-ingress.ts";
import { parseHostedRuntimeUsageRecordRequest, parseHostedRuntimeIssueExportRequest } from "../src/parsers/runtime-control.ts";
import { parseHostedRuntimeEnsureProcessingRequest } from "../src/parsers/orchestration-control.ts";

const usage = { schema: "murph.assistant-usage.v1", attemptCount: 1, credentialSource: "platform", occurredAt: "2026-11-14T00:00:00.000Z", sessionId: "session_synthetic", turnId: "turn_synthetic", usageId: "turn_synthetic.attempt-1" };

describe("request-only value constraints", () => {
  it.each([0, 1])("requires positive TTS metering: %i", characterCount => {
    const parse = () => parseInput({ usage: { ...usage, provider: "elevenlabs", requestedModel: "eleven_multilingual_v2", usageExtractionSourcePath: "elevenlabs.text_to_speech", rawUsageJson: { characterCount } } }, parseHostedRuntimeUsageRecordRequest);
    if (characterCount === 0) expect(parse).toThrow(RequestInputError); else expect(parse).not.toThrow();
  });
  it.each([0, 1])("requires positive transcription bytes: %i", audioBytes => {
    const parse = () => parseInput({ usage: { ...usage, provider: "workers-ai", featureKey: "audio-transcription", requestedModel: "@cf/openai/whisper-large-v3-turbo", usageExtractionSourcePath: "workers-ai.transcribe", rawUsageJson: { audioBytes, durationMs: 1000 } } }, parseHostedRuntimeUsageRecordRequest);
    if (audioBytes === 0) expect(parse).toThrow(RequestInputError); else expect(parse).not.toThrow();
  });
  it.each([null, 0])("requires music duration while accepting zero: %s", durationMs => {
    const parse = () => parseInput({ usage: { ...usage, provider: "elevenlabs", featureKey: "music-generation", requestedModel: "music_v2_5", usageExtractionSourcePath: "elevenlabs.music.compose", rawUsageJson: durationMs === null ? null : { durationMs } } }, parseHostedRuntimeUsageRecordRequest);
    if (durationMs === null) expect(parse).toThrow(RequestInputError); else expect(parse).not.toThrow();
  });
  it.each(["identityId", "selfAddress", "threadKey", "threadTarget", "rawMessageKey"])("checks the selected email identity fallback: %s", field => {
    const request = { eventId: "evt_synthetic", identityId: null, occurredAt: "2026-11-14T00:00:00.000Z", rawMessageKey: "raw_synthetic" };
    expect(() => parseInput({ ...request, [field]: " " }, parseHostedEmailIngressWakeAppendRequest)).toThrow(RequestInputError);
    expect(() => parseInput({ ...request, [field]: "x" }, parseHostedEmailIngressWakeAppendRequest)).not.toThrow();
  });
  it.each([
    { rawMessageKey: " ", threadKey: null, references: [], rejected: true },
    { rawMessageKey: "raw_synthetic", threadKey: null, references: [], rejected: false },
    { rawMessageKey: " ", threadKey: "thread_synthetic", references: [], rejected: false },
    { rawMessageKey: " ", threadKey: null, references: ["<root@example.test>"], rejected: false },
  ])("validates the resolved group email identity: %j", ({ rawMessageKey, threadKey, references, rejected }) => {
    const request = { eventId: "event_synthetic", identityId: null, occurredAt: "2026-11-14T00:00:00.000Z", rawMessageKey, threadKey,
      threadTarget: serializeHostedEmailThreadTarget({ targetKind: "group", groupId: "group_synthetic", references }) };
    const parse = () => parseInput(request, parseHostedEmailIngressWakeAppendRequest);
    if (rejected) expect(parse).toThrow(RequestInputError); else expect(parse).not.toThrow();
  });
  it.each([8.64e15 - 30_000, 8.64e15 - 29_999])("bounds admission retry arithmetic: %i", timestamp => {
    const request = { orchestrationAttemptId: "orchestration_synthetic", admission: { cutover: "postgres", status: "existing", owner: {
      userId: "member_synthetic", attemptId: "attempt_synthetic", generation: "1", phase: "active", processingMode: "default", allocationId: "standby-claim-00000000-0000-4000-8000-000000000000",
      runnerContainerName: "runner_synthetic", workspaceVersion: "0", platformAiUsageAllowed: true,
      startedAt: new Date(timestamp).toISOString(), acceptedAt: null, completedAt: null, failureCount: 0, lastErrorCode: null,
    } } };
    if (timestamp > 8.64e15 - 30_000) expect(() => parseInput(request, parseHostedRuntimeEnsureProcessingRequest)).toThrow(RequestInputError);
    else expect(() => parseInput(request, parseHostedRuntimeEnsureProcessingRequest)).not.toThrow();
  });
});

for (const depth of [128, 129, 10000]) {
  it(`bounds request issue detail depth ${depth}`, () => {
    const details = JSON.parse('{"a":'.repeat(depth + 1) + 'true' + '}'.repeat(depth + 1));
    const parse = () => parseInput({ issues: [{
      schema: "murph.assistant-runtime-issue.v1", issueId: "ari_0000000000000000_000000000000000000000000",
      fingerprint: "000000000000000000000000", occurredAt: "2026-11-14T00:00:00.000Z",
      environment: "hosted", phase: "tool_call", severity: "warning", issueKind: "tool_error",
      component: "synthetic", summary: "Synthetic issue", details,
    }] }, parseHostedRuntimeIssueExportRequest);
    if (depth <= 128) expect(parse).not.toThrow();
    else expect(parse).toThrow(RequestInputError);
  });
}
