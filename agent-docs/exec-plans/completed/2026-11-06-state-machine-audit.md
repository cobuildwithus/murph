# State-machine audit across Murph and iOS

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Goal

- Inventory explicit and implicit product state machines across Murph and its iOS companion in one maintained reference. Prove reachable invariant violations, group confirmed defects into prioritized issues, and repair them at their existing owners with regression tests.

## Success criteria

- Record source revisions, owners, states, invariants, and transition tables in `agent-docs/references/app-state-machines.md`; make coverage and remaining uncertainty explicit.
- Each confirmed defect has a concrete execution schedule, impact, issue, minimal correction, and regression evidence.
- Preserve success paths, reject stale authority, retain retryability when work fails, and prevent duplicate external effects.
- Review all task changes, run affected proof, and make scoped commits; report any unavailable completion gates honestly.

## Scope

- In scope: current Murph packages, hosted backend and client, and native iOS application lifecycles; failure, cancellation, retries, concurrency, persistence and recovery.
- Out of scope: production mutations, deployment, unrelated edits, speculative redesign, and exhaustive model checking of every possible application state.

## Constraints

- Technical constraints: retain canonical owners and public boundaries; prefer deletion, ordering, existing keys and exact claims over new machinery. Keep checks isolated and use synthetic evidence.
- Product/process constraints: preserve dirty primary checkout and active work; use latest remote bases and sanctioned checkout helpers. One combined inventory is the source of audit findings and fix status.

## Risks and mitigations

1. Scope is broad and derived state can hide transitions.
   Mitigation: enumerate families from source and schema, partition work by owner, record inspection depth, and distinguish proven defects from residual risks.
2. Concurrency failures can disappear under sequential mocks.
   Mitigation: use deferred operations, deterministic interleavings, exact claims and composed-owner tests; use real persistence contention when its semantics matter.

## Tasks

1. Fetch current sources and establish owned clean task checkouts.
2. Inventory web client, hosted control plane, runtime/packages, and iOS state-machine families.
3. Trace candidate violations to executable paths, reproduce failures, prioritize and group related issues.
4. Correct confirmed defects and add regression coverage at existing owners.
5. Consolidate tables/evidence in the shared reference and keep finding status current.
6. Run focused checks, review the diff, and complete the applicable commit/review workflow.

## Decisions

- Current Murph baseline: `c32c522e20fd61e61a65b9053b94f5d848b909e1`; iOS baseline: `184180816f448371cd4de03d7132aa5563cdb0a7`. Explicit main refspecs were fetched and compared with remote heads. The initial Murph tracking ref was stale because its shared fetch mapping targeted another branch; revalidated the entire inventory after fast-forwarding the owned checkout. The unrelated dirty primary checkout remains preserved.
- The parser race found on the stale revision was already fixed by upstream PR #4656; removed the duplicate local patch and closed audit issue #4729 with the upstream evidence.
- Current fix groups: diagnostic transition acknowledgements (#4730, P2), native stale Home and offline snapshots after game commands (iOS #473, P2), warmup cancellation during setup (#4731, P3), and explicit reminder choices overwritten by activation recovery (#4732, P2).
- Product UX effort: Patch. Outcome: existing flows converge correctly after failure or overlap. Reaches: people exercising the confirmed affected flows. Proof: normal success plus the demonstrated failing interleavings, updated per finding before implementation.
- Parent owns combined documentation and issues. Delegates own disjoint runtime, hosted-backend, and iOS source scopes.
- Delivery is scoped local commits. No PR, merge or deployment is requested; PR-specific CI and external review are not claimed. iOS uses its required fresh independent local review.
- The user explicitly authorized local Xcode simulator checks in place of the unavailable HEAVY launcher.

## Verification

- Diagnostics: six new cases failed before correction, ordinary-success case passed. Corrected lifecycle/sanitization/runtime-route suites pass 16 tests across three files; Web typecheck and focused lint pass.
- Warmup: new setup-cancellation test failed before correction (five existing cases passed); corrected suite passes all six. Cloudflare typecheck passes. Real filesystem setup and synthetic owned child exercise the lifecycle.
- Existing upstream parser/inbox proof on current baseline: 54 and 25 tests pass; no parser source changes remain.
- Native: seven new tests plus extended existing regressions prove stale success/failure, uncertain deletion, offline relaunch, partial-post persistence and block-cache preservation. All 276 tests across nine suites pass; Xcode build, tracked SwiftFormat and diff checks pass. Four API failures also reproduced on unchanged production source and were corrected by isolating the test-owned pending store. A fresh independent reviewer has no outstanding findings. Parent inspected the final six-file diff and committed it locally as `624c8e6` with the approved identity.
- Reminder recovery: two new real-PostgreSQL cases failed before correction. Corrected activation suite passes 12 and ordinary reminder suite passes 28. Both lock orders, optional-field carry-over, feature-disabled saves, kickoff preservation, and replay are covered. At 1 versus 1,000 live games, the same at-most-12 queries use one connection; two facts per seat are deduplicated. New work remains set-based and database-only; no product cap or schema was added.
- Complexity guard passes for five authored TypeScript owners, with unchanged member-message sibling hotspot 21 and new helper maximum 4. Final Web and Cloudflare typechecks pass. Focused lint reports no new warnings; existing service warnings remain outside the changed behavior. Local Node 24.14.1 emits the declared 24.22.1 minimum warning; these results do not substitute for CI on the declared runtime.
- Changelog: `game-reminder-choices-stay-saved` describes the member-visible reminder correction; four production archive rendering tests pass. Internal diagnostic/warmup changes need no public note; removed the duplicate parser note. Native release publication has not been requested.
- Product UX: Ready within local proof. Accepted game actions survive delayed responses and offline recovery; current credential rejection and block privacy remain authoritative. Reminder on/off choices win in either concurrent ordering without suppressing unchanged carry-over or kickoff. No UI layout, prompt, tool schema or provider protocol changed.
- Parent reviewed all source/test diffs, state ownership, query/lock ordering, privacy and proof boundaries. The combined reference contains 87 active families plus two retired interfaces, prioritized issues, failure schedules and corrected results. Source-reference checks identify only the deliberately retired wrist-command path. Document drift/gardening and diff checks pass.
- Remaining release boundaries: scoped local commits only; no PR CI, physical-device run, live provider operation, merge or deployment is claimed. Issues remain open until landing except the parser issue already fixed upstream. Detailed schedules and proof limits live in the combined reference.
Completed: 2026-11-06
