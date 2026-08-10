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
- Preliminary ReviewGPT either reports `SPECIALIST_OUTCOME: PASS` or has every
  finding explicitly resolved or rejected with evidence and product-owner
  direction; final ReviewGPT reports `ROUND_OUTCOME: PASS`. Any
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
- Accept final ReviewGPT round 2's model-reroute usage finding. Keep the fix at
  the existing invocation event owner: only a canonical reroute after the
  matching `turn/started` changes the served model and pricing basis. Do not
  restore deleted completion aliases or custom-inference compatibility paths.

## Verification

- Merged current `origin/main` without conflicts after preserving the protocol
  repair in scoped commit `40bea9d6fb1d`.
- Passed the full fake App Server runtime suite (248 tests) and the full real
  pinned-binary scripted App Server suite (32 tests).
- Passed 231 adjacent assistant protocol/usage/tool/notification tests, 268
  hosted-runtime entrypoint tests, 287 Cloudflare runner/container tests, 154
  Web settings/control tests, nine CLI tests, 23 hosted-execution usage tests,
  and 52 hosted-control tests.
- Passed scoped typechecks for assistant-engine, hosted-execution,
  cloudflare-hosted-control, Cloudflare, and Web. `pnpm install
  --frozen-lockfile`, `pnpm deps:guard`, and the blocked-install-script review
  passed; the exact package binary reports `codex-cli 0.147.0` and App Server
  help exits successfully.
- `pnpm deps:audit` remains red on 77 repository advisories (one critical, 32
  high, 38 moderate, six low). The lockfile delta changes only the Codex package
  and its six platform packages from `0.145.0` to `0.147.0`; no reported
  vulnerable path traverses that dependency.
- Complete first-provider requests were captured twice through the real
  `0.145.0` and `0.147.0` App Servers with identical synthetic direct/group
  fixtures, `gpt-5.6-terra`, low reasoning, production code mode, and
  `gpt-tokenizer` 3.4.0 `o200k_harmony`. Normalized repeats were identical:
  direct grew from 121,482 bytes / 26,531 tokens to 121,604 / 26,767 (+122
  bytes, +236 tokens, +0.89%); group grew from 104,218 / 22,666 to 104,340 /
  22,902 (+122 bytes, +236 tokens, +1.04%). All change is in Codex-generated
  `input`; Murph prompt builders and dynamic-tool definitions are unchanged.
- Parent candidate review found no unresolved local issue. Remaining proof is
  the pushed-head preliminary specialist pass, final ReviewGPT gate, exact-head
  GitHub checks, merge cleanliness, and plan closure.
- Preliminary specialists reviewed pushed head
  `577c106260b13d0ff23b35b0827b9554fa3f1b86` and found one coupled recovery
  gap: a selected `0.145.0` profile was runtime-blocked but still shown as in
  use, and the current-profile guard also prevented explicit managed
  deselection. A first remediation implemented that compatibility journey, but
  the product owner explicitly rejected it after confirming the production
  database contains zero custom-inference rows. The current direction deletes
  the stale-profile UI, deselection exception, catalog studies, transition
  fixtures, and compatibility documentation. The release remains a clean hard
  cut: newly verified connections use the `0.147.0` profile, while no legacy
  row or migration surface exists to preserve.
- Final ReviewGPT round 1 on that same immutable first head required the
  repository's large-change retrospective and reported no tactical finding.
  The retrospective is recorded on PR 1381 and accepts the hard-cut shape as
  indivisible net deletion with no new state owner, compatibility layer, or
  migration machinery.
- Exact-head GitHub Actions on the first reviewed head found stale assistant
  test fixtures that still emitted removed `0.145.0` identities and event or
  usage aliases. Production behavior was already exact; the fixture remediation
  now emits canonical request identity, notification item types, text fields,
  and six-field token usage. A clean full assistant coverage run passed 221
  files (one skipped), 3,367 tests (42 skipped), and all coverage thresholds;
  the final corrected dynamic fixture then passed its focused suite and the
  assistant typecheck.
- The rejected recovery UI is deleted, restoring a frontend-neutral PR; design
  catalog and screenshot proof are therefore not applicable to the current
  candidate.
- Final ReviewGPT round 2 on `f18e3904ebc7` found that canonical
  `model/rerouted` notifications were visible in progress but discarded during
  usage extraction, so durable allowance pricing used the requested model. A
  focused failing test reproduced both Luna-to-Sol and Sol-to-Luna
  misattribution. The correction derives served-model identity and token
  pricing only from a post-`turn/started` canonical reroute and preserves the
  reused-process stale-event fence; focused verification and a new exact-head
  review remain pending.
- Exact-head GitHub Actions also exposed an inherited `main` regression from
  the newly added static Family setup route: the fail-closed Vercel telemetry
  allowlist had not added that literal pathname. The route and failing contract
  both predate this remediation; the smallest CI repair adds the missing
  sanitized static pathname without changing the page or telemetry payload.
