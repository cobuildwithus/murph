# Codex auth ReviewGPT fixes

Status: completed
Created: 2026-06-23
Updated: 2026-06-23

## Goal

- Resolve accepted ReviewGPT findings on the hosted Codex auth checkpoint PR without broadening the auth architecture.
- Keep terminal auth callbacks, local credential state, and web-owned auth status consistent across retries, crashes, and deploy skew.

## Success criteria

- Duplicate terminal callbacks are idempotent and do not delete a valid current credential.
- Disconnect requests revoke the local managed credential even if remote logout fails; local delete failure remains retryable.
- Terminal Codex auth callbacks run only after durable workspace checkpoint success.
- Durable docs describe the auth callback ordering invariant.
- Focused tests and required repo verification pass before commit.

## Scope

- In scope:
  - Hosted Codex auth web store callback status and terminal-state handling.
  - Hosted runtime Codex auth wake, system-mailbox recorder, and assistant-phase after-durable-checkpoint effect wiring.
  - Shared hosted-execution callback response parser/contract.
  - Focused tests and durable hosted-runtime protocol docs.
- Out of scope:
  - Broader account-auth redesign.
  - New scheduler, queue, or callback ledger tables.
  - Unrelated hosted runtime, device-sync, billing, or UI changes.

## Constraints

- Preserve web as the hosted product/control-plane owner.
- Preserve runtime-owned workspace checkpointing and the existing after-durable-checkpoint effect lane.
- Keep secrets, credential contents, direct identifiers, and local machine paths out of committed artifacts.
- Prefer the smallest durable state primitive over a new abstraction.

## Risks and mitigations

1. Risk: A retry of a successful terminal callback looks superseded and deletes the current managed credential.
   Mitigation: Return explicit `applied`, `already_applied`, or `superseded` status from web and delete auth only for superseded connect terminal callbacks.
2. Risk: A failed remote logout consumes a disconnect request while local credentials remain active.
   Mitigation: Treat remote logout as best effort, require local `auth.json` deletion, and keep delete failures retryable.
3. Risk: Web shows connected/disconnected before the durable workspace snapshot captures the matching local state.
   Mitigation: Defer terminal Codex auth callbacks into the existing after-durable-checkpoint effect lane.

## Tasks

1. Update hosted Codex auth callback response contract and parser.
2. Make web auth terminal updates idempotent with a durable disconnected tombstone.
3. Make runtime disconnect local-revocation-first and retry local delete failures.
4. Defer terminal Codex auth callback recording until after durable checkpoint success.
5. Add focused regression tests and update docs.
6. Run verification, commit, push, and re-run PR review.

## Verification

- Commands run:
  - Focused web, hosted-execution, assistant-runtime, and Cloudflare Vitest suites.
  - `pnpm --dir apps/web verify`
  - `pnpm typecheck`
  - `pnpm test:diff`
  - `pnpm docs:drift`
  - `git diff --check`
- Result:
  - Passed.
  - Known non-failing warnings remained in hosted web and hosted-local verification output.
Completed: 2026-06-23
