# Device-sync provider yield hardening

Status: completed
Created: 2026-05-27
Updated: 2026-05-27

## Goal

- Let hosted device-sync background work yield during a single slow provider job when foreground conversation input arrives.

## Success criteria

- Provider job context exposes a cooperative abort signal tied to the existing foreground-yield hook.
- Provider network requests in the current configured providers honor that signal without logging raw payloads, provider paths, tokens, or local paths.
- Yielding a job releases it for a later run without recording a provider failure or consuming a permanent retry attempt.
- Focused device-sync tests and required typecheck/coverage lanes pass, or any blocker is proven unrelated.

## Scope

- In scope:
- `packages/device-syncd` provider job execution, provider request helpers, and focused tests.
- Minimal `packages/assistant-runtime` type/call-site updates if required by the same seam.
- Out of scope:
- Hosted web dirty-state acceptance semantics.
- Temporal orchestration demand semantics.
- Provider webhook verification or OAuth connect flow changes outside job-time requests.

## Constraints

- Keep the existing `shouldYield` ownership model; do not introduce a new scheduler or persisted demand store.
- Do not persist or log provider payloads, credentials, account identifiers, raw response bodies, local paths, or direct personal identifiers.
- Preserve active ledger rows and unrelated worktree edits.

## Risks and mitigations

1. Risk: Treating a foreground yield as a normal provider failure could consume retries or create noisy diagnostics.
   Mitigation: classify yield-aborted jobs separately and release the owned lease back to queued state.
2. Risk: A provider helper may keep using only timeout signals.
   Mitigation: thread the job signal into the shared OAuth helper and Junction client paths used by configured providers.

## Tasks

1. Add a provider job abort signal and release-on-yield behavior in `device-syncd`.
2. Thread the signal through configured provider request helpers.
3. Add focused regression coverage for mid-job yield behavior and request-signal propagation.
4. Run verification, required audits, and the scoped commit path.

## Decisions

- Use a cooperative AbortSignal tied to the existing foreground-yield callback instead of adding new persisted state.
- Keep cancellation metadata local to the worker; durable job state should simply be available for a future drain.

## Progress

- Implemented provider-job abort propagation, release-on-yield, provider request signal threading, and hosted yielded-pass retry gating.
- Added focused service/shared OAuth/Junction/hosted maintenance regressions, including unrelated provider `AbortError` after yield and immediately-due released jobs.

## Verification

- Passed:
  - `pnpm --dir packages/device-syncd test service.test.ts shared-oauth.test.ts junction-provider.test.ts`
  - `pnpm --dir packages/assistant-runtime test hosted-runtime-maintenance.test.ts`
  - `pnpm --dir packages/device-syncd typecheck`
  - `pnpm --dir packages/device-syncd test:coverage`
  - `git diff --check`
- Blocked by unrelated dirty `packages/query` edits:
  - `pnpm test:diff packages/device-syncd packages/assistant-runtime/src/hosted-runtime/maintenance.ts packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm typecheck`
Completed: 2026-05-27
