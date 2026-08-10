# Complete PR 1381 with Codex 0.147.0 and ReviewGPT

Status: active
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Complete PR 1381 against current `main`, ship Codex CLI `0.147.0`, and prove
  Murph accepts exactly the pinned App Server protocol without losing valid
  usage, tool, error, or lifecycle events.
- Finish the repository's preliminary-specialist and final ReviewGPT loop on an
  exact pushed head, with required CI green and no accepted findings left open.

## Success criteria

- The public package pin, lockfile, hosted runner base-image pin, runtime
  verification profile, docs, and exact-protocol comments agree on `0.147.0`.
- Canonical `0.147.0` server envelopes are accepted and client-only or malformed
  envelopes fail closed in focused protocol, assistant, runtime, and CLI tests.
- Dependency guards, focused tests, relevant typechecks/builds, and exact-head
  required GitHub checks pass.
- Preliminary ReviewGPT reports `SPECIALIST_OUTCOME: PASS`; final ReviewGPT
  reports `ROUND_OUTCOME: PASS`; all accepted findings are resolved and any
  behavior-changing remediation is reviewed on a new pushed head.
- The PR description records architecture, invariants, provider-input impact,
  review metadata, verification, and deployment concerns, and the head is
  merge-clean.

## Scope

- In scope: PR 1381's Codex App Server protocol adapter and fixtures; the shipped
  Codex dependency and hosted runner pin; version-coupled verification profiles,
  tests, and operator docs; PR review and CI remediation attributable to this
  change.
- Out of scope: unrelated assistant behavior, new compatibility shims, provider
  fallbacks, runtime lifecycle redesign, or deployment execution.

## Constraints

- Technical constraints: retain one exact typed protocol owner; accept only
  documented server-to-client envelopes from the pinned release; preserve
  usage accounting, dynamic-tool authority, error classification, and resident
  process ownership; use public package specs and commit the lockfile.
- Product/process constraints: preserve unrelated work; use the PR worktree;
  run ReviewGPT concurrently with CI on the exact pushed head; do not use local
  deep-review; redact private identifiers and secrets from durable artifacts.

## Risks and mitigations

1. Risk: a release pin changes event shapes that silently erase usage, tool, or
   failure evidence.
   Mitigation: derive fixtures from the pinned package/protocol and retain
   positive plus fail-closed parser coverage for each consumed event family.
2. Risk: the package, container base image, verification profile, and docs drift.
   Mitigation: update all version owners together and run their contract tests
   plus dependency guards.
3. Risk: a stale or remediated PR head is treated as reviewed.
   Mitigation: record immutable first-reviewed and current head SHAs, package a
   fresh full snapshot for each required round, and rerun after behavior changes.
4. Risk: worker/runner deployment skew leaves old containers on a hard-cut
   protocol.
   Mitigation: document immediate runner rollout and post-deploy Codex version,
   App Server handshake, and container-identity checks.

## Tasks

1. Diagnose the old exact-head CI failures and reconcile the branch with current
   `main` before review.
2. Inspect the `0.147.0` package/protocol, update all version owners, and repair
   the exact protocol parser and fixtures at the root cause.
3. Run focused local proof, dependency checks, provider-input measurement, and
   parent candidate review; update the PR description.
4. Commit and push the exact candidate, then start preliminary specialists and
   final ReviewGPT round 1 concurrently with GitHub Actions.
5. Resolve accepted ReviewGPT or CI findings, push and review any required new
   exact head, and continue until both gates pass.
6. Confirm required checks, merge cleanliness, final metadata, and deployment
   handoff; archive this plan in the final scoped commit.

## Decisions

- Merge current `main` before the first reviewed candidate. Base-only movement
  does not itself trigger another review round.
- Treat `147` as the public package release `0.147.0`, matching the existing
  `0.147.0` versioning convention.
- Use the PR's mandatory ReviewGPT lane instead of local deep-review.

## Verification

- Commands to run: focused Vitest projects/files for assistant-engine,
  assistant-runtime, CLI, Cloudflare container contracts, and hosted-control;
  relevant workspace typechecks/builds; pnpm dependency guards; provider-input
  measurement; `scripts/review-gpt-pr-head-preflight.sh`; exact-head GitHub
  checks and both ReviewGPT phases.
- Expected outcomes: all commands pass, valid `0.147.0` events retain their
  semantic data, invalid envelopes fail closed, both ReviewGPT markers pass,
  required checks are green, and GitHub reports the PR mergeable.
