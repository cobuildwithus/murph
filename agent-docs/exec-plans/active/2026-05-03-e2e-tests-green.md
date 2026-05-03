# Get e2e tests green

Status: active
Created: 2026-05-03
Updated: 2026-05-03

## Goal

- Make the repo's local e2e test surface pass from the current dirty checkout without reverting unrelated active work.

## Success criteria

- `pnpm test:e2e:hosted-local` passes.
- `pnpm --dir apps/cloudflare test:e2e:local` passes, or any omitted sublane has a documented unrelated blocker.
- Repo-required typecheck/test follow-up for touched files passes, or remaining failures are documented as unrelated to this e2e fix.

## Scope

- In scope: hosted-local e2e harness/tests, Cloudflare e2e support, and directly coupled runtime fixes needed to make a failing e2e scenario pass.
- Out of scope: broad hosted auth/settings/sidebar cleanup, Health Commons content work, dependency upgrades, live provider calls, and production deploy changes unless an e2e failure directly proves they are required.

## Constraints

- Technical constraints: preserve unrelated dirty files and active ledger rows; inspect ownership before editing; prefer failing e2e output over speculative fixes.
- Product/process constraints: do not expose local identifiers, secrets, raw credentials, raw authorization headers, provider payloads, or private contact data in files, logs, docs, or commits.

## Risks and mitigations

1. Risk: active rows already overlap hosted-local and Cloudflare e2e files.
   Mitigation: avoid owned files unless the failure is directly coupled and the overlap is safe; report blockers instead of taking over another lane.
2. Risk: hosted-local e2e can be slow and can leave runner containers behind.
   Mitigation: use the repo harness cleanup path and record any manual cleanup if needed.

## Tasks

1. Run the e2e lane and capture the first failing scenario.
2. Inspect the responsible code/tests and ledger overlap before editing.
3. Apply the smallest safe fix for attributable failures. (done)
4. Re-run focused failing scenarios, then the aggregate e2e command. (done)
5. Run required follow-up checks and complete the repo handoff workflow.

## Decisions

- Use a separate narrow e2e plan because the existing `repo-green` plan is active and broader than this user request.
- The Linq webhook audio/PDF failures came from a rejected hosted log key containing `message` and an audio assertion still expecting the stripped direct `.m4a` URL instead of the metadata `.wav` download URL.

## Verification

- Commands to run: `pnpm test:e2e:hosted-local`; `pnpm --dir apps/cloudflare test:e2e:local`; touched-owner typecheck/test follow-up.
- Expected outcomes: e2e commands exit 0; any non-e2e remaining check failure is explicitly attributed.
- Current evidence: `pnpm hosted-local e2e linq-webhook --no-bundle` failed before the fix with two attachment-case failures.
- Focused proof: `pnpm hosted-local e2e linq-webhook` passed after rebuilding the runner bundle.
- Focused first-contact proof: `pnpm hosted-local e2e linq-first-contact --no-bundle` passed after an aggregate timeout did not reproduce in isolation.
- Aggregate hosted-local proof: `pnpm test:e2e:hosted-local` passed with 5 files / 16 tests.
