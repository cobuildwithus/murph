# Prove device sync convergence across wake seams

Status: completed
Created: 2026-08-31
Updated: 2026-08-31

## Goal

- Prevent source-blind or same-owner wake races from either starving accepted
  device work or causing repeated no-progress runtime passes, using focused
  executable proof at the existing UserRunner/runtime/checkpoint owners.

## Success criteria

- The existing real UserRunner owner-boundary test sends a bounded burst of
  exact same-owner system rechecks against one active runtime fence.
- Every response refers to the same attempt and bounded recheck time, while no
  child wake, abort, replacement, backoff mutation, or new invocation occurs.
- Existing Assistant Runtime convergence tests remain the owner of provider,
  checkpoint, handled-frontier, and final-quiescence proof.
- Focused package/app tests, typecheck, exact-head CI, and final ReviewGPT pass.

## Scope

- In scope: strengthening one existing Cloudflare UserRunner test at the real
  same-owner producer boundary.
- Out of scope: Temporal release admission, live-reader derivation, worker
  migration tooling, new persisted state, provider integrations, and UI work.

## Constraints

- Technical constraints: reuse existing wake, checkpoint, and harness owners;
  add no second scheduler or recovery state machine; preserve foreground
  latency and current fail-closed boundaries.
- Product/process constraints: remain disjoint from the active
  `codex/temporal-release-admission` branch; use ReviewGPT for the implementation
  patch and the final exact-head review gate.

## Risks and mitigations

1. Risk: a synthetic runtime signal test could duplicate an impossible upstream
   state and provide false confidence.
   Mitigation: keep the burst at UserRunner, which intentionally absorbs exact
   same-owner rechecks before runtime transport.
2. Risk: timing-heavy tests become flaky.
   Mitigation: use deterministic barriers and explicit invocation counts rather
   than sleeps or wall-clock polling.

## Tasks

1. Inventory existing incident regressions and exact phase seams.
2. Ask ReviewGPT for a scoped attachment-based implementation patch.
3. Apply and parent-review the patch, retaining only evidence-backed minimal
   changes.
4. Run focused verification, commit, open a draft PR, and complete exact-head CI
   plus final ReviewGPT.
5. Merge only after every required gate is green.

## Decisions

- Keep this PR public-runtime focused; the other active session owns all
  Temporal release-admission and deploy-canary changes.

## Verification

- Commands to run: the focused Cloudflare Vitest case, Cloudflare typecheck,
  exact-head required GitHub checks, and final ReviewGPT.
- Expected outcomes: repeated same-owner acknowledgements remain bounded at the
  authoritative owner and create no downstream runtime work or state churn.
Completed: 2026-08-31
