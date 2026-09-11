# Environment PR verification and review

Status: completed

## Outcome

Prepare linked backend and iOS PRs for the Environment report, Home grade card
and native voice audit, establish local proof, and prepare the stable candidates
for ReviewGPT. The live PR ledgers own subsequent review and CI completion.
No merge or production deployment is requested.

## Existing lane and boundaries

Continue the owned Environment feature branches. Preserve the canonical Web
questions, grading, parser, mailbox saves, identity pinning and consent checks.
Native owns visible SwiftUI presentation; an invisible WebKit engine reuses the
existing realtime implementation. No new physical-device or production access
is implied by local tests. Do not claim simulated speech as provider proof.

## Work

- Reconcile current main without losing the Environment card or setup flow.
- Run backend report/auth/realtime/bridge tests, typecheck, lint and complexity.
- Run signed simulator tests, initial-setup regressions and Environment UI
  journeys; attach synthetic screenshots as exact-head PR evidence.
- Add the release note and complete linked PR descriptions with deployment
  order, proof limits, review baseline and native purpose trailer.
- Start ReviewGPT as soon as each stable head is pushed, alongside CI. Triage
  findings, apply authorized scoped corrections and reverify affected behavior.
- Finish with both PR links, exact review outcomes and local/hosted proof.

## Candidate evidence

Backend PR: cobuildwithus/murph#3015. Native PR: cobuildwithus/murph-ios#146.
The backend has 74 focused report, encrypted-core decode, auth, realtime,
transport and native-controller tests passing; 9 changelog tests also pass.
Prepared web typecheck, scoped ESLint and documentation drift pass. Complexity
is compared with the PR merge base using an explicit head, so unrelated newer
main changes are excluded. Existing capture/decoder hotspots retain their
owners; new Environment helpers stay below the threshold.

The native candidate reconciles current main and keeps the Environment card
behind the final notification setup step. Signed simulator verification runs
all native unit tests, Environment UI journeys and initial-setup UI journeys.
The iOS PR will retain synthetic screenshots and exact candidate metadata.
Physical-device live speech, background shutdown and hosted save-to-grade
convergence remain release evidence gaps. The website questions are displayed;
this feature does not introduce synthesized spoken questions.

ReviewGPT and CI results belong to the live PR ledgers, not this preparation
snapshot. No green review or release approval is claimed here. Local review
already examined presentation, trust boundaries and lifecycle; the user's
explicit ReviewGPT request authorizes the PR review now.
Updated: 2026-09-06
Completed: 2026-09-06
