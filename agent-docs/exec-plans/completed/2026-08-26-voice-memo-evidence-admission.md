# Admit voice memos after attachment evidence

Status: completed
Created: 2026-08-26
Updated: 2026-08-27

## Goal

- Make attachment-bearing conversation turns reach Murph only after the existing
  inbox projection has written the available or failed attachment evidence that
  the assistant prompt consumes. Preserve the earliest durable foreground
  activity signal and attachment-free reply latency.

## Success criteria

- A deterministic runtime regression proves that an audio attachment cannot be
  admitted to an active turn before its projection-owned evidence settles.
- Existing text-only turns retain direct admission without opening or waiting on
  inbox projection.
- Projection success, permanent failure, and retryable failure retain their
  existing single-owner outcomes without a new queue, flag, or lifecycle.
- A focused real-Codex journey proves Murph uses synthetic voice-memo transcript
  evidence rather than claiming the memo is inaccessible.
- Focused tests and typechecks pass, required PR CI is green, and both required
  ReviewGPT stages resolve on the exact pushed candidate.

## Scope

- In scope: hosted mailbox conversation import ordering, its focused runtime
  tests, a focused real-assistant journey, and the user-visible changelog.
- Out of scope: transcription-provider replacement, new retry machinery,
  persisted state, prompt wording changes, or unrelated attachment UX.

## Constraints

- Technical constraints: reuse the existing staging, projection, notification,
  and retry owners; prefer deletion and reordering over added abstractions; keep
  text-only admission on the current fast path.
- Product/process constraints: use only synthetic public-safe regression data;
  never persist the production report, identifiers, transcript, screenshot, or
  exported workspace content; have ReviewGPT produce the initial patch, then
  inspect and simplify it before acceptance.

## Risks and mitigations

1. Risk: waiting for every projection could regress attachment-free replies.
   Mitigation: gate only inputs that need attachment evidence and lock the
   text-only ordering in focused coverage.
2. Risk: reordering could strand retryable or permanently failed projection.
   Mitigation: exercise both outcomes at the existing importer boundary and
   preserve its current retry owner.
3. Risk: a model-only test could pass without proving production ordering.
   Mitigation: require deterministic importer proof first, then a focused
   production-builder real-Codex journey.

## Tasks

1. Ask ReviewGPT to implement the smallest owner-level patch and return a diff.
2. Inspect the proposed diff against the importer, prompt-input, and retry
   contracts; accept only the minimal proven behavior.
3. Add deterministic success/failure/retry regressions and a focused real-Codex
   voice-memo journey.
4. Run focused verification and the parent Product UX walkthrough.
5. Commit, push, open the draft PR, and run preliminary specialists plus final
   ReviewGPT concurrently with exact-head CI.
6. Resolve accepted findings, complete final proof, and prepare the merge-ready
   handoff.

## Decisions

- Product UX effort is Patch: restore the existing promise that Murph can use a
  voice memo already accepted by the conversation channel.
- The importer remains the single ordering owner. Process preparation may begin
  at durable staging, while active-turn admission waits only when prompt meaning
  depends on projection-owned attachment evidence.
- ReviewGPT's owner-level patch was accepted after parent inspection. The final
  implementation deletes provider-specific video eligibility and reuses the
  existing attachment-evidence and inbox-projection predicates; no new state,
  retry owner, queue, service, or dependency was added.

## Verification

- Commands to run: focused assistant-runtime tests and typecheck; focused
  assistant-engine real-Codex journey; relevant doc/drift checks; exact-head PR
  CI; preliminary and final ReviewGPT stages.
- Expected outcomes: audio evidence settles before admission, text-only turns
  retain the fast path, retry semantics remain unchanged, and Murph's rendered
  reply demonstrates use of the supplied transcript evidence.
- Completed focused proof:
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-mailbox-conversation-import.test.ts`
    passed 66 tests.
  - `pnpm --filter @murphai/assistant-runtime typecheck` passed.
  - `pnpm --filter @murphai/assistant-engine typecheck` passed.
  - The focused real-Codex journey passed on the one authorized alternate local
    subscription home after the default home returned a usage limit before any
    provider action. The tested `gpt-5.6-terra` reply used the supplied
    transcript exactly and made no false access or resend claim. Product UX
    verdict: Ready.
Completed: 2026-08-27
