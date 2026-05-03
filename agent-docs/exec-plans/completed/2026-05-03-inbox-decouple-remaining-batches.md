# Land remaining inbox decouple batches

Status: completed
Created: 2026-05-03
Updated: 2026-05-03

## Goal

- Land the remaining source-neutral assistant input attachment-evidence migration batches after the committed Batch 1/2 foundation.
- Remove prompt-time inbox projection dependency while preserving local image multimodality, filesystem-inspectable PDF/document refs, and hosted/local parity.

## Success criteria

- Batch 3 producer adapter converts inbox capture attachment records into safe `AssistantInputAttachmentEvidence`.
- Batch 4 local run loop writes initial evidence for `capture.imported` and refreshes evidence after parser drains without aborting automation on failures.
- Batch 5 hosted mailbox projection writes or marks attachment evidence best-effort after staged assistant input exists.
- Batch 6 prompt construction reads `AssistantInputEvent.attachmentEvidence` only, with no `inboxServices.show()` prompt dependency and no `InboxShowResult` import in prompt builder.
- Batch 7/8 docs and residue gates document the vault-relative artifact-ref exception and prove prompt-time inbox residue is gone.
- Focused tests, typecheck, and required completion audits pass, or unrelated dirty-tree blockers are named precisely.

## Scope

- In scope: assistant-engine producer/prompt/runtime code and tests, assistant-runtime hosted mailbox evidence hook/tests, and the durable hosted assistant input hard-cut doc if present.
- Out of scope: broad hosted-local Codex execution rewrites, Cloudflare runner refactors, web onboarding fixes, Health Commons work, and unrelated dirty hosted/device-connect files.

## Constraints

- Preserve unrelated dirty work in this checkout and do not stage unrelated hunks.
- Prompt construction must not call inbox services or depend on rebuildable inbox projection SQLite.
- Producer/update paths may call inbox services because they write durable event-owned evidence.
- Artifact refs stored on assistant input events must stay sanitized vault-relative refs only, never absolute paths, URLs, signed URLs, auth headers, cookies, provider payloads, or bytes.
- Hosted logs must remain privacy-bounded: counts, statuses, and reason codes only; no raw paths or payloads.

## Risks and mitigations

1. Risk: hard-cutting prompt enrichment regresses local image/PDF handling.
   Mitigation: preserve the Batch 2 source-neutral model module and add prompt tests for image content parts and PDF stored-path notes.
2. Risk: producer hooks make inbox projection a Codex admission gate again.
   Mitigation: evidence updates are best-effort and failures log nonblocking progress only.
3. Risk: overlapping dirty work in hosted runtime files blocks a safe scoped commit.
   Mitigation: inspect current dirtiness before edits, keep changes on unclaimed files where possible, and use scoped commit paths only when safe.

## Tasks

1. Map remaining guide batches to current code and split explorer lanes.
2. Implement Batch 3 adapter plus focused tests.
3. Implement Batch 4 local producer hooks plus focused tests.
4. Implement Batch 5 hosted producer hook plus focused tests.
5. Implement Batch 6 prompt hard cut plus focused tests/residue scans.
6. Update docs/residue gates for Batch 7/8.
7. Run verification and required audits, fix findings, and commit scoped changes.

## Decisions

- Treat Batch 1/2 commit `99102082b` as the foundation and avoid reworking its schema/model shape unless later batches expose a concrete defect.
- Reuse existing `input.reply-progress` events for nonfatal producer/prompt evidence failures unless a minimal typed event addition proves necessary.

## Verification

- Passed: `pnpm --dir packages/assistant-engine typecheck`
- Passed: `pnpm --dir packages/assistant-runtime typecheck`
- Passed: `pnpm --dir packages/runtime-state typecheck`
- Passed: `pnpm --dir packages/hosted-execution typecheck`
- Passed: focused assistant-engine Vitest suites for inbox evidence adapter, evidence materialization, prompt builder, reply event path, runtime hooks, and support redaction.
- Passed: focused assistant-runtime Vitest suites for hosted mailbox import, conversation events, workspace runner, and workspace entrypoint.
- Passed: focused hosted-execution runtime-control Vitest suite.
- Passed: `pnpm typecheck`
- Passed: `bash scripts/workspace-verify.sh test:diff ...` after an unrelated parsers timing failure passed immediately in isolation.
- Passed: prompt-path residue scans for `inboxServices.show`, `InboxShowResult`, legacy inbox multimodal helpers, and enrichment wording.
- Passed: hosted error-log residue scan and raw filename/path leakage scan.
- Passed: final review subagent; no Batch 3-8 regressions found after neutral raw-artifact refs were introduced.
- Passed: `git diff --check` and scoped privacy scan.
Completed: 2026-05-03
