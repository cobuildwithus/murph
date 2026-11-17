# About you height through canonical measurements

Status: completed
Created: 2026-11-16
Updated: 2026-11-16

## Outcome and scope

Support the approved About you Height row through the same private body-height
measurement used by imports. Backend only; native wheels, optimistic rendering
and Progress image prompts belong to other lanes. No endpoint, table, flag,
projection generation or separate profile height is added.

## Owners and evidence

The measurement.add contract currently accepts only VO2. Its existing handler
already resolves catalog units and writes a manual event with an action-derived
id, keeping an existing record unchanged. Reuse that path without editing it.
Numbers already carries About you demographics and loads metricsIndex, which
contains canonical latest-valid selections for body-height across sources.
Add heightCm beside demographics and expose readCompanionBodyHeight for server
composition. Values older than 365 local days return null, evaluated at read
time; missing height and unknown memory demographics remain independent.

## Product UX

Effort: Product change. Entry: About you. Outcome: a member can save height in
cm and read their newest valid saved selection after ordinary publication.
Journeys: manual entry and exact replay; existing imported height; no usable
height; stale height; invalid units/ranges; revoked session or health consent.
The backend does not promise that an accepted action is already published.
Native rendering and end-to-end rollout are outside this lane.

## Constraints and deployment

Follow locked Progress PLAN section 9. Validate at admission; typed handlers
reuse the current writer. Preserve canonical same-date source precedence.
Private values remain in the existing encrypted mailbox, sealed hosted vault
and sealed replica, with no private metadata in logs or new plaintext fields.
Deploy height-capable contracts in Worker and runner, replacing warm old
bundles, before Web and then the native producer. Old VO2 requests and records
keep their shape. Keep compatible consumers until height requests drain.
No ReviewGPT or merge in this lane; the integrator owns those.

## Tasks

1. Extend the shared measurement range contract and generic route error.
2. Derive height from the existing metric selection in Numbers.
3. Prove ranges, replay, source selection, expiry and authority with synthetic tests.
4. Update owner docs, run focused checks and diff selector, review, commit and open PR.

## Verification

Focused contract tests: 23 passed, exit 0. Runtime handler tests: 15 passed,
exit 0. Measurement/Numbers route tests: 83 passed, exit 0. Progress health and
Friends regressions: 32 passed, exit 0. Web and assistant-runtime typechecks:
exit 0. The diff selector also passed affected package typechecks, including
contracts, after building existing recap-video and assistant-engine artifacts.
Its broader package/app phase is waiting for the shared host slot; final
completion and exact-head CI evidence belongs in the PR.

Complexity, docs drift, focused Web lint and git diff checks: exit 0. Candidate
review found no added state or data fetches, no private output and no new
complexity hotspots. Product UX result: Ready for the backend boundary; native
rendering and deployed publication proof remain with the integrator.

Fresh checkout setup needed frozen dependency installation and Prisma client
generation. Two initial diff-selector attempts exited 1 because the existing
recap-video public exports lack source maps until built. Reused Frog entry
20261114220050-a-new-package; no new friction report or tooling changes.
No live assistant verification applies: the existing deterministic handler
remains model-free and no prompts, tools or provider inputs change. The lane follows the approved Height brief. Its consumer-first rollout differs
from the broader Progress plan section 5: About you adds a metric enum to an
existing cross-plane action, requiring Worker/runner before Web. No other
plan deviations or open product questions.
Completed: 2026-11-16
