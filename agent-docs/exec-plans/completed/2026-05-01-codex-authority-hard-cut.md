# Land Codex authority hard-cut cleanup

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Land the supplied Codex-authority hard-cut cleanup against current HEAD.
- Assistant turns must flow to Codex instead of being intercepted by Murph device-connect heuristics before Codex sees the turn.
- Hosted Codex launches must keep environment inheritance explicit and minimal.
- Murph must stop treating a persisted provider/model catalog abstraction as the authority for Codex defaults.

## Success criteria

- The downloaded patch intent is ported without forcing stale hunks over current code.
- Regression coverage proves the removed pre-Codex device-connect shortcut and hosted Codex env allowlist behavior.
- Focused package checks, typecheck, privacy/security review, coverage review, final review, and diff hygiene complete or have explicit unrelated blockers.

## Scope

- In scope:
  - `packages/assistant-engine` provider-turn runner, provider catalog, Codex catalog defaults, and direct tests.
  - `packages/assistant-runtime` hosted Codex config env inheritance.
  - `packages/operator-config` assistant provider-config normalization/persistence cleanup.
- Out of scope:
  - Changing live Codex App Server protocol behavior beyond the supplied authority cleanup.
  - Adding new model catalog sources or UI surfaces.
  - Hosted device-sync/connect architecture changes outside removal of the pre-Codex shortcut.

## Constraints

- Technical constraints:
  - Preserve Codex App Server as the privileged assistant adapter and avoid reintroducing provider abstraction as durable authority.
  - Do not infer or persist provider state while still tolerating legacy input fields at current call sites.
  - Preserve unrelated active rows and dirty-tree edits.
- Product/process constraints:
  - Treat the supplied patch as intent, not overwrite authority.
  - Keep the patch landing narrow and record any stale hunk differences.

## Risks and mitigations

1. Risk: Removing shortcut behavior could regress hosted device-connect flows that depended on Murph-side interception.
   Mitigation: Add a regression test for absence of the shortcut and rely on Codex/Murph runtime tool surfaces for assistant handling.
2. Risk: Env inheritance changes could drop a required hosted Codex variable.
   Mitigation: Keep explicit includes/allowlist behavior under test rather than falling back to ambient host env.
3. Risk: Provider-config cleanup could break legacy callers passing `provider`.
   Mitigation: Continue accepting the field as input while excluding it from normalized/durable config output.

## Tasks

1. Inspect stale patch hunks against current HEAD.
2. Port the behavior manually into current files.
3. Run focused tests and typecheck.
4. Run required security/privacy, coverage-write, and task-finish-review passes.
5. Close with a scoped commit if the final tree can be safely staged.

## Decisions

- 2026-05-01: Use a plan-bearing high-risk patch-landing lane because the stale patch touches assistant authority, hosted env inheritance, and persisted provider config.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff <touched paths>`
  - Focused Vitest for the new Codex-authority regression test.
  - `git diff --check`
- Expected outcomes:
  - Checks pass, or any failure is tied to a documented unrelated active row in the current dirty checkout.
Completed: 2026-05-01
