# Repair Composio direct-write account identity

Status: active
Created: 2026-08-12
Updated: 2026-08-12

## Goal

- Restore confirmed connected-app writes by sending Composio both the selected
  connected-account identity and the authenticated Murph member identity.
- Preserve the existing approval, argument, privacy, and non-retryable
  ambiguity boundaries for email and calendar writes.

## Success criteria

- Gmail, Outlook mail, Google Calendar, and Outlook Calendar fixed writes use
  the authenticated member as the direct-execution user identity.
- The Composio client makes user identity mandatory for every direct execution,
  preventing a selected-account call from compiling without that binding.
- Focused request-shape tests cover the top-level user and connected-account
  fields together.
- Focused Web tests, Web typecheck, repository guards, exact-head CI, the
  preliminary coverage review, and the final ReviewGPT gate pass.

## Scope

- In scope:
  - The Web-owned Composio direct-execution request boundary.
  - Fixed email and calendar write request-shape coverage.
  - A public-safe changelog note for restored connected-app actions.
- Out of scope:
  - Retrying or replaying an ambiguous write.
  - Changing assistant prompts, approval policy, account selection, provider
    versions, or user-facing uncertainty wording.
  - Browser-vault refresh diagnostics observed separately from the foreground
    connected-app failure.

## Constraints

- Technical constraints:
  - Keep the provider request aligned with the current Composio direct-execute
    contract: top-level `user_id`, `connected_account_id`, pinned `version`, and
    bounded `arguments`.
  - Preserve the no-retry rule for failed or ambiguous provider writes.
- Product/process constraints:
  - Keep production evidence private and out of repository artifacts.
  - Use the isolated task worktree and the PR/ReviewGPT lane required for an
    external-provider write boundary.

## Risks and mitigations

1. Risk: Replaying the original request could duplicate a write whose outcome
   is uncertain.
   Mitigation: Change only future request identity; do not resend or add retry
   behavior.
2. Risk: Fixing only Gmail leaves the shared Outlook/calendar path broken.
   Mitigation: Repair the shared fixed-write branch and assert both email and
   calendar request shapes.
3. Risk: A later caller omits user identity again because the client accepts it
   as optional.
   Mitigation: Require `userId` in the direct-execution client contract.

## Tasks

1. [x] Correlate the foreground turn through the control database, hosted
   runtime logs, and production Web logs.
2. [x] Confirm the structured provider failure and compare the emitted request
   shape with the current Composio contract.
3. [x] Require and send member user identity for direct fixed writes.
4. [x] Strengthen exact-shape tests across email and calendar writes.
5. [x] Add the public-safe changelog fragment, run focused verification, and
   inspect the final diff for identifiers or secrets.
6. [ ] Push a PR candidate and complete specialist, final ReviewGPT, CI, and
   merge-tree gates.

## Decisions

- The new structured provider diagnostics are working as designed; no
  observability change is needed.
- The minimal repair is request identity, not retry, reconciliation, or a new
  provider adapter.
- Treat the change as ReviewGPT-sensitive because it repairs an external write
  trust boundary.

## Verification

- Commands to run:
  - Focused Vitest for the Composio client, connected-app service, and email
    send boundaries.
  - `pnpm --dir apps/web typecheck`.
  - `pnpm logs:guard`, `pnpm docs:drift`, `git diff --check`, and scoped
    identifier/credential scans.
  - Exact-head GitHub Actions, preliminary coverage review, final ReviewGPT,
    and `git merge-tree --write-tree HEAD origin/main`.
- Expected outcomes:
  - Every direct execute request contains `user_id`; account-selected requests
    also contain the selected `connected_account_id`.
  - All checks and review gates pass with no accepted findings remaining.

## Verification log

- Focused Composio client, fixed-email-write, and connected-app service tests:
  passed, 52 tests.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm logs:guard`: passed.
- Focused changelog-fragment tests: passed, 7 tests.
- A production-shaped synthetic direct scenario passed through the real Web
  service boundary and proved that the provider request binds both the
  authenticated member and selected account.
- `pnpm docs:drift`, `git diff --check`, and the scoped identifier scan: passed.
- The first focused test launch happened before fresh-worktree Prisma generation
  completed, so two suites failed during import with zero tests collected. The
  exact rerun after the typecheck generated Prisma passed all 52 tests.
