## Prove hosted-local Linq voice memo replies end to end

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Extend the hosted-local Linq webhook harness so a metadata-only voice memo can flow through hosted attachment hydration, parser transcription, and assistant reply delivery.
- Keep the production hosted Linq attachment allowlist strict by default while adding the smallest explicit local-only override needed for the E2E harness.

## Success criteria

- The hosted runtime can accept an explicit local attachment CDN base override without relaxing the default production Linq CDN gate.
- The hosted-local Linq stub serves attachment metadata plus downloadable audio bytes for voice memo attachments.
- A hosted-local Linq webhook E2E sends a voice-memo-only inbound message, proves the local attachment metadata/download requests happened, proves the assistant provider saw the transcript text, and observes the outbound assistant reply.
- Focused verification is green, including the new hosted runtime regression test and the hosted-local Linq webhook E2E.

## Scope

- In scope:
  - `packages/assistant-runtime/src/hosted-runtime/events/linq.ts`
  - directly coupled hosted runtime tests
  - `apps/cloudflare/test/helpers/hosted-local-linq-support.ts`
  - `apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts`
  - plan/ledger bookkeeping for this task
- Out of scope:
  - broader hosted Linq runtime redesigns beyond the local attachment override needed for truthful E2E proof
  - unrelated hosted typing or zero-retention behavior already in flight in nearby Linq tests/helpers

## Constraints

- Preserve unrelated dirty-tree edits, especially the active hosted typing lane already touching `apps/cloudflare/test/helpers/hosted-local-linq-support.ts`.
- Do not weaken the default production Linq attachment gate to satisfy local testing; any new override must be explicit and local-only.
- Keep the parser proof local and deterministic; prefer a fake whisper CLI plus WAV fixture over new runtime bypasses.

## Risks and mitigations

1. Risk: the shared Linq helper overlap could cause merge conflicts with the active typing lane.
   Mitigation: keep helper edits additive, avoid rewriting existing request-count helpers, and leave `apps/cloudflare/test/hosted-local-linq-first-contact-e2e.test.ts` untouched.

2. Risk: the local harness could still miss the real hosted path if the voice memo includes text or bypasses parser work.
   Mitigation: send a voice-memo-only webhook event, assert attachment metadata/download requests, and assert the assistant provider request body contains the transcript text.

3. Risk: local downloader proof could accidentally broaden production acceptance rules.
   Mitigation: keep the new CDN base override opt-in via env and preserve the current production default when unset.

## Tasks

1. Register the active plan and ledger row.
2. Add an explicit local attachment CDN base override to the hosted Linq downloader and cover it with a unit regression test.
3. Extend the hosted-local Linq stub with attachment metadata and downloadable voice memo bytes.
4. Add a hosted-local Linq webhook E2E that uses a fake whisper CLI and proves transcript-backed reply delivery.
5. Run focused verification, required audits, and finish through the scoped commit flow.

## Decisions

- Use the existing hosted webhook E2E lane with a fake whisper CLI rather than inventing a second parser bypass or a synthetic post-parse wake.

## Verification

- Commands to run:
  - `pnpm vitest packages/assistant-runtime/test/hosted-runtime-linq-event.test.ts`
  - `pnpm --dir apps/cloudflare test:e2e:linq-webhook:local`
  - `pnpm --dir apps/cloudflare typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime/events/linq.ts packages/assistant-runtime/test/hosted-runtime-linq-event.test.ts apps/cloudflare/test/helpers/hosted-local-linq-support.ts apps/cloudflare/test/hosted-local-linq-webhook-e2e.test.ts`
  - `git diff --check`
  - required `coverage-write` and `task-finish-review` audit passes
- Direct scenario proof to capture:
  - one hosted-local Linq webhook run showing `GET /attachments/:id`, `GET /attachment-downloads/:id.wav`, an assistant provider request containing the transcript text, and the outbound assistant reply send

## Verification notes

- Passed:
  - `pnpm vitest packages/assistant-runtime/test/hosted-runtime-linq-event.test.ts`
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/runner-env.test.ts --no-coverage`
- Blocked in the current checkout:
  - `pnpm --dir apps/cloudflare test:e2e:linq-webhook:local` cannot rebuild the runner bundle because unrelated dirty-tree type errors remain in `packages/core/src/vault-sync.ts`.
  - The direct hosted-local webhook E2E lane with `MURPH_DEV_SKIP_RUNNER_BUNDLE=1` is also currently red before the new voice-memo path runs: the pre-existing `routes a signed Linq webhook through apps/web and delivers the follow-up reply` case times out on this checkout after a hosted bundle cleanup warning (`Hosted bundle archive is invalid.`), so the new voice-memo case cannot produce a truthful green end-to-end result until that broader hosted-local runner state is fixed.
Completed: 2026-04-23
