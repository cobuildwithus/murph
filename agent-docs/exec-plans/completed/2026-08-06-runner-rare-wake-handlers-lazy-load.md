# Lazy-load rare hosted wake handlers

Status: completed
Created: 2026-08-06
Updated: 2026-08-07

## Goal

- Remove rare system-wake handlers from the hosted runner's eager Node startup
  graph.
- Load each handler only when its matching durable mailbox wake is processed.

## Success criteria

- Member activation, assistant notification, assistant-ask completion,
  Environment voice, and Codex-auth wakes preserve their existing behavior,
  retries, and mailbox outcomes.
- Ordinary conversation, health, and high-volume device-sync paths do not
  evaluate the rare handler modules at startup.
- The production bundle's static boot closure shrinks measurably, exact handler
  tests and typechecking pass, and Docker startup proof shows the effect or
  demonstrates that the split is not worth shipping.
- Exact-head CI and required completion reviews have no unresolved findings.

## Evidence

- The four eager handler modules contain about 57.9 KiB of authored TypeScript
  before bundling.
- Seven-day production aggregates for `mailbox.system_processed` show 44 member
  activations, 30 assistant notifications, four Environment voice captures,
  and no assistant-ask completion or Codex-auth wakes. The already-lazy
  device-sync lane handled 8,894 wakes in the same window.

## Scope

- In scope:
  - Replace static handler imports in `hosted-runtime/events.ts` with direct
    per-case dynamic imports.
  - Remove the unused internal notification-handler re-export.
  - Guard the production bundle against those modules re-entering the static
    closure.
  - Add focused runtime, bundle, and Docker proof.
- Out of scope:
  - Changing wake schemas, routing, mailbox ownership, retries, or responses.
  - Dynamic imports for high-frequency conversation or device-sync paths.
  - Idle maintenance, outbox scans, Zod, or dynamic-tool loading.

## Constraints

- Use native ESM caching; do not add a loader manager or new state owner.
- Let existing mailbox error and retry ownership handle import failures.
- Keep this PR independent of the Zod and dynamic-tool startup PRs.

## Tasks

1. Measure current handler frequency and baseline bundle/Docker startup.
2. Move rare handler imports behind their exact wake switch cases.
3. Add static-closure guards and focused regression proof.
4. Assemble and benchmark the exact candidate in Docker.
5. Commit, push, open a separate PR, run exact-head CI and completion reviews,
   then close this plan with `scripts/finish-task`.

## Decisions

- Use direct dynamic imports in the existing exhaustive switch. Each wake kind
  already supplies the dispatch boundary, and Node caches successful ESM module
  evaluation without another abstraction.
- Keep member activation and assistant notification in their existing shared
  module. Splitting that module would add churn without changing when it loads.
- Keep the assistant-ask preemption error and predicate in a tiny eager leaf.
  The serial mailbox needs to recognize that control-flow error without
  evaluating the full ask-completion handler at startup.
- Ship based on the deterministic static-closure reduction, not the local
  Docker timing. Docker Desktop was substantially noisier than the earlier
  startup run and did not show a candidate improvement.

## Verification

- Seven-day typed production aggregate: 44 member activations, 30 assistant
  notification requests, four Environment voice captures, and no
  assistant-ask completion or Codex-auth wakes (78 targeted wakes total).
- Exact clean-main production assembly: 1,729,632B entry, 8,596,243B static
  closure, 10,282,554B total.
- Exact candidate production assembly: 1,636,957B entry, 8,453,351B static
  closure, 10,291,322B total.
- Deterministic delta: -92,675B entry, -142,892B static closure, +8,768B total.
- The four direct lazy chunks total 49,750B; shared dependencies account for
  the remaining static-closure reduction.
- Twenty alternating Docker samples per arm: baseline p50 2,095.7ms/p90
  2,402.3ms, candidate p50 2,173.4ms/p90 2,630.0ms, paired median +156.3ms.
  The 1.7-4.1s sample range was too noisy to attribute to the 143KB split.
- Assistant Runtime and Cloudflare typechecks passed.
- Six focused Assistant Runtime test files passed (97 tests).
- Cloudflare runner-bundle tests passed before the final baseline ratchet; rerun
  with workspace-boundary and package-cycle checks before the candidate commit.
- Preliminary specialist review found that the direct handler test did not
  prove the new lazy handler and eager serial mailbox shared preemption identity.
  A production-shaped integration test now exercises the real prepare, dynamic
  handler import, and mailbox retention path. It proves `preempted`, pending
  status, no retry timestamp, and no persisted error metadata.
- The remediation passes 13 focused Assistant Ask tests, 49 Cloudflare bundle
  and image-contract tests, Assistant Runtime typecheck, and exact production
  runner assembly. Emitted bytes remain 1,636,957B entry, 8,453,351B static
  closure, and 10,291,322B total.
- After merging the Zod runtime change and current `main`, 52 focused
  Cloudflare bundle/image tests and the production-shaped Assistant Ask
  preemption integration test passed. Exact artifact assembly measured
  1,640,840B entry, 8,053,604B static closure, and 9,885,077B total. Relative
  to the post-Zod base, the authored delta remains exactly -92,675B entry,
  -142,892B static closure, and +8,768B total.
- Two initial full assembly attempts hit the pre-existing 60-second CLI
  manifest generation timeout under extreme shared-host CPU contention. A
  direct manifest probe later completed in 28.79 seconds, the package build
  passed unchanged, and the assembled production artifact reported
  `devDependencies: skipped`; no timeout or runtime invariant was changed.
- Post-merge workspace-boundary and workspace-package-cycle verification
  passed.
Completed: 2026-08-07
