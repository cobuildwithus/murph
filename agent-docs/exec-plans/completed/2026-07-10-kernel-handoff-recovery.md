# Kernel handoff recovery and viewport ownership

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Make hosted browser handoffs recover predictably after expiry, guarantee that replacement handoff links reach the user, and give Kernel viewport sizing one simple owner while upgrading the web app to the latest SDK release.

## Success criteria

- A fresh user message can reclaim an open or expired interactive handoff without requiring the user to revisit or finish its link.
- An interactive handoff without a fresh post-pause user reply remains locked against model takeover.
- Any newly created handoff URL returned by the pause tool is present in the delivered assistant response or the turn fails closed before delivery.
- Opening, refreshing, or resizing the handoff page never force-resizes an already-running Kernel browser.
- `@onkernel/sdk` is upgraded to the current public-registry `latest` release with the lockfile updated and dependency guards green.
- Focused recovery, final-response, viewport, and Kernel-client tests cover the production incident paths.
- Required verification, audits, PR review, and CI complete without unresolved accepted findings.

## Scope

- In scope: `apps/web` Kernel client and handoff lifecycle/viewport code, `packages/assistant-engine` final-response enforcement for pause results, their focused tests, the Kernel dependency/lockfile, and matching durable computer-use documentation.
- Out of scope: Kernel provider internals, a new scheduler or recovery queue, extending handoff token lifetime, browser session recording, or broad computer-use refactoring.

## Constraints

- Technical constraints: preserve member/session ownership, hidden post-pause mailbox proof, compare-and-set run/handoff fencing, short-lived hashed handoff tokens, raw live-view URL secrecy, and a fresh-open handoff's exclusive user control.
- Product/process constraints: prefer deletion and one owner over new state; use Fable when available and record the authorized direct-implementation fallback after the required local Claude sweep proves it unavailable; dependency controls stay enabled; preserve unrelated active work.

## Risks and mitigations

1. Risk: reclaiming too broadly lets Murph fight a user who is still controlling the browser.
   Mitigation: require valid post-pause hidden reply proof and existing exact state fences for both open and expired interactive handoffs; keep every handoff locked without that proof.
2. Risk: deterministic link insertion exposes the wrong capability or duplicates model text.
   Mitigation: retain the single server-generated member-bound Murph handoff URL for the paused turn, append only when absent, and add exact response tests.
3. Risk: removing forced resize leaves the browser larger than a small handoff surface.
   Mitigation: keep the live view responsive within the page while leaving the running browser at Kernel's creation-time viewport; remove the compositor-mutating update path entirely.
4. Risk: the latest SDK changes generated API types.
   Mitigation: review the official changelog/types and prove the existing Kernel client through typecheck and focused tests.

## Tasks

1. Reconfirm the current Kernel SDK contract and map the exact reclaim, response, and viewport call paths.
2. Add incident-regression tests for open/expired reclaim, no-proof locking, and required handoff-link delivery.
3. Implement the smallest fenced reclaim and response-delivery corrections.
4. Use Fable for the handoff component simplification when available; otherwise use the documented direct-implementation fallback and review the result locally.
5. Upgrade Kernel and the lockfile after the repository's minimum-release-age gate permits the latest release.
6. Update durable computer-use docs, run dependency/scoped/full verification, direct scenario proof, and required specialist audits.
7. Finish the plan, commit, push, open a PR, run ReviewGPT to zero accepted findings, and confirm final CI/merge readiness.

## Decisions

- Preserve the 20-minute handoff-token TTL; recovery should reclaim server-side rather than weaken the capability lifetime.
- A post-pause user reply is the explicit authority to reclaim an open or expired interactive handoff; without that proof, never take concurrent control.
- Delete runtime viewport mutation instead of moving ownership: the handoff renders Kernel's existing live view and never calls `browsers.update(... force: true)`.
- The local Claude sweep found no usable Fable lane (default credits exhausted; alternate homes unauthenticated; existing Murph processes not safe to commandeer), so the parent implements the frontend deletion directly under the documented fallback.

## Verification

- Focused web handoff/Kernel/session tests passed (7 files, 197 tests), including 141 service tests after final simplification. Focused assistant-engine tests passed (2 files, 184 tests), including omission, exact-once URL preservation, and no-reply ordering.
- `apps/web` verification passed: production build, lint with no errors, development smoke, and 4,167 tests passed with 9 skipped. `apps/cloudflare` verification passed: typecheck, package/runtime checks, and 1,702 tests.
- All 24 affected-package typechecks, the hosted-local harness (382 tests), frozen-lockfile install, dependency guard, ignored-build check, and upgraded-SDK client tests passed. The registry still reports `@onkernel/sdk@0.76.0` as `latest`.
- The repo-wide parallel `test:diff` lane exposed pre-existing generated-artifact ordering and shared temporary-fixture collisions; every failing owner test passed in isolation, and both affected apps passed their complete verifiers. The dependency audit reports only pre-existing unrelated dependency paths and no Kernel path.
- Direct incident evidence confirmed that refresh surfaced the existing 20-minute expiry and that the replacement pause created a new handoff whose final reply omitted its URL. Static proof confirms no runtime viewport route, observer, session hint, or Kernel force-resize call remains.
- Required security/privacy and frontend reviews found no actionable issue. Coverage-write added the exact missing URL-omission case and otherwise found the existing authority/race coverage sufficient. The frontend review recorded the expected authenticated-live-handoff render gap because that state requires a live hosted session and Kernel handoff.
Completed: 2026-07-10
