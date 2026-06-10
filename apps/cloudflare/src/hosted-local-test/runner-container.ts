import {
  CLOUDFLARE_HOSTED_TRANSCRIBE_HOST,
} from "../internal-hosts.ts";
import {
  RunnerContainer as BaseRunnerContainer,
} from "../runner-container.ts";
import {
  HOSTED_RUNNER_OUTBOUND_BY_HOST,
} from "../runner-egress-intercept.ts";
import type {
  WorkerAiBindingLike,
} from "../worker-contracts.ts";

export class RunnerContainer extends BaseRunnerContainer {
  async expireActivityForTest(_input: { userId: string }): Promise<{ ok: true }> {
    await this.onActivityExpired();
    return { ok: true };
  }
}

// The hosted-local generated wrangler config has no Workers AI binding, so
// the transcribe egress handler would fail closed in E2E. Inject a
// deterministic fake binding here (test entrypoint composition only) so the
// audio E2E proves the full production chain — container parser drain ->
// remote-transcription provider -> murph-transcribe.worker handler ->
// AI binding -> transcript evidence — with only the model call faked.
const hostedLocalTestAiBinding: WorkerAiBindingLike = {
  async run(_model: string, input: Record<string, unknown>) {
    if (typeof input.audio !== "string" || input.audio.length === 0) {
      throw new TypeError("Hosted-local test AI binding requires base64 audio input.");
    }

    return {
      segments: [
        { end: 1.4, start: 0, text: "Remember to" },
        { end: 2.5, start: 1.4, text: "log the voice note" },
      ],
      text: "Remember to log the voice note",
      transcription_info: { duration: 2.5, language: "en" },
    };
  },
};

// Scope the fake-binding wrap to the transcribe host only: it is the single
// AI-reading egress route today, and a future AI-reading handler must not
// silently inherit the fake in E2E. Note @cloudflare/containers keys
// outboundByHost by class NAME, so this assignment replaces the shared
// "RunnerContainer" registry entry for any module graph that imports this
// file — the production entrypoint graph must never import hosted-local-test
// (pinned by apps/cloudflare/test/hosted-local-test-runner-container.test.ts).
const transcribeHandler =
  HOSTED_RUNNER_OUTBOUND_BY_HOST[CLOUDFLARE_HOSTED_TRANSCRIBE_HOST];
if (!transcribeHandler) {
  throw new Error("Hosted-local test composition requires the transcribe outbound handler.");
}

const hostedLocalTestOutboundByHost: typeof HOSTED_RUNNER_OUTBOUND_BY_HOST = {
  ...HOSTED_RUNNER_OUTBOUND_BY_HOST,
  [CLOUDFLARE_HOSTED_TRANSCRIBE_HOST]: (request, env, ctx) =>
    transcribeHandler(request, env.AI ? env : { ...env, AI: hostedLocalTestAiBinding }, ctx),
};

RunnerContainer.outboundByHost = hostedLocalTestOutboundByHost;
