# Bound native iOS E2E queue latency

Status: completed
Created: 2026-08-19
Updated: 2026-08-20

## Goal

- Keep the native iOS hosted E2E gate close to one real-journey duration for current merge candidates by eliminating superseded-head convoy work before adding provider capacity.
- Preserve exact-head evidence, default-branch controller authority, secret isolation, and the existing single destructive live slot.

## Success criteria

- A PR can retain at most its running controller plus its newest pending controller; intermediate pending heads are replaced rather than accumulated.
- The controller rejects a stale head before checkout, toolchain setup, dependency installation, token minting, reset, deployment, or native dispatch, and checks again immediately before dispatch.
- Commit-status descriptions distinguish a real passed journey from selection, deferral, supersession, and failure; an unexecuted head is never described as having passed the journey.
- The global single-slot serialization remains fail-closed until independently isolated provider slots exist.
- Focused workflow and script tests pass, required exact-head CI is green, ReviewGPT specialist and final gates complete, and the scoped task commit contains the completed plan plus any Frog entry.

## Scope

- In scope:
  - The trusted Murph native iOS hosted E2E controller workflow.
  - Focused workflow-contract tests and required durable verification/reliability documentation.
  - ReviewGPT-authored Phase 1 patch triage and local correction when needed.
- Out of scope:
  - Four-slot provider provisioning, slot leases, asynchronous finalization, or multi-simulator packing.
  - Privy, Junction, database, Vercel, or GitHub Environment creation.
  - Changes to the private iOS repository.
  - Enabling auto-merge, changing the main ruleset, or inventing an implicit merge-intent signal.

## Constraints

- Technical constraints:
  - One database, Privy principal, Junction sandbox scope, Vercel target, and private iOS lane remain destructive singletons.
  - Cross-repository GitHub concurrency groups do not coordinate ownership.
  - The current main ruleset does not require the native iOS status, and current PRs do not use auto-merge.
  - Candidate code must never receive controller or provider secrets.
- Product/process constraints:
  - The cheapest safe change comes before new infrastructure.
  - A green exact-journey context may be published only after a real exact-head journey and postcondition proof.
  - Unrelated worktree changes and active task ownership must remain untouched.

## Risks and mitigations

1. Risk: PR-number concurrency cancels or drops the current exact head.
   Mitigation: keep `cancel-in-progress: false`, use GitHub's default single-pending replacement behavior, and test the exact expression and omission of `queue: max` at workflow scope.
2. Risk: early stale-head exit leaves a misleading or permanently pending status.
   Mitigation: pending replacements never start or publish a status, while a stale running controller fails through the existing terminal status owner; execute the status shell matrix in focused tests.
3. Risk: moving validation changes the trusted-code or secret boundary.
   Mitigation: perform the first check without secrets before checkout/setup and retain trusted default-branch checkout for all secret-bearing work.
4. Risk: removing the global queue permits destructive overlap.
   Mitigation: preserve the job-level singleton and its fail-closed queue until isolated slots are provisioned.

## Tasks

1. Completed: recovered the existing ReviewGPT architecture thread, supplied current ruleset and workflow facts, and requested an attachment-based Phase 1 implementation patch.
2. Completed: inspected the returned patch for scope, current-main compatibility, trust boundaries, status truthfulness, and coverage before applying it.
3. Completed: reconstructed the accepted patch exactly in the isolated task worktree and applied the specialist coverage-only patch after full inspection and hash verification.
4. Completed: ran focused workflow/script tests, the CLI trust-guard project, TypeScript checks, workflow composition, PR-body guards, diff/privacy checks, and parent review.
5. Completed: pushed PR #2040, ran the specialist pass and three final ReviewGPT rounds, resolved every accepted finding, recorded the round-3 retrospective, and reached a zero-finding final pass with required candidate-head CI green.

## Decisions

- Implement Phase 1 before provider-slot infrastructure because it removes measured stale convoy work without external provisioning or a new state owner.
- Treat merge-intent admission as a separate explicit contract unless the patch can establish an authenticated existing signal without new repository settings.
- Use a fresh task worktree from current `origin/main`; the prior native iOS activation checkout was clean, merged, contained in main, and retired through the sanctioned helper to free the worktree slot.
- Accept the specialist findings: align the routed index with informational-status truth and execute the real status-publishing shell matrix rather than checking string presence.
- Accept final round 1: replace the prose-coupled workflow-run allowlist with parsed trusted-admission, exact-head-ordering, checkout, and credential invariants.
- Accept final round 2: narrow `pr-live` to exact job-level `contents: read` and `pull-requests: read` authority so the long-lived secret-bearing controller cannot write commit statuses.
- Continue after the required round-3 retrospective because authored source stayed at 61 changed lines, remediation remained in tests/docs/three permission lines, and no new runtime owner or repeated finding mechanism appeared.

## Verification

- Passed `node --test scripts/native-ios-hosted-e2e.test.mjs`: 35/35.
- Passed the full `cli-release-smoke` Vitest project: 55 passed, one intentional skip.
- Passed `pnpm typecheck` before remediation and the affected CLI package typecheck after each trust-guard correction.
- Passed JavaScript syntax checks, Ruby Psych workflow composition, diff whitespace, commit-status length, privacy scan, and all four PR-body evidence guards.
- The preliminary specialist review completed in 19m33s with two accepted findings and one inspected coverage-only patch.
- Final ReviewGPT rounds completed in 21m40s, approximately 28 minutes, and approximately 30 minutes; round 3 returned `ROUND_OUTCOME: PASS` with verified `gpt-5-6-pro` model evidence.
- All required GitHub checks passed on reviewed candidate `3a2aea8ff582d99bf54233a6bf509fbabf937f2d`; the informational native iOS status remained pending and is not a Protect main requirement.
Completed: 2026-08-20
