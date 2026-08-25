# Junction workout stream live capability remediation

Status: active
Created: 2026-08-25
Updated: 2026-08-25

## Goal

- Preserve historical and current workout-detail sync for capable Junction
  sources even when the Web capability projection has not caught up, while
  keeping disconnected or live-incapable sources free of workout egress.

## Success criteria

- Web/control-plane source state remains the current-import admission authority.
- Current Junction provider inventory remains the workout-stream capability
  authority, intersected at the existing provider-local seam.
- An unscoped full-job workout continuation loads current provider inventory;
  no new state, replay, queue, service, schema, or compatibility path exists.
- Focused stale-capability, disconnected, live-incapable, mixed, and scoped
  regressions pass, followed by full provider/service tests and typecheck.
- The corrected pushed head resolves the accepted ReviewGPT finding, receives
  its required full-patch follow-up review, and has green exact-head CI plus a
  clean current-base merge-tree proof.

## Scope

- In scope: Junction workout-stream admission, the full-job continuation's
  existing provider-inventory read, focused provider/service regressions,
  matching reliability documentation if its capability wording changes, PR
  evidence, verification, and required review follow-up.
- Out of scope: replay design, new persisted state, queues, services, schemas,
  availability publication changes, other Junction resources, and merging.

## Constraints

- Technical constraints: reuse `projectJunctionSourcesByProviderSlug` and the
  current resource-availability helper; keep collection bounded and source
  authority fail-closed; preserve cursor, retry, yield, and partial-progress
  behavior.
- Product/process constraints: keep the PR draft until the corrected candidate
  and review gates are resolved; retain the immutable first-reviewed head;
  return any substantive finding for disposition; do not merge this PR.

## Risks and mitigations

1. Risk: live provider capability could bypass a user disconnect.
   Mitigation: intersect it with the current control-plane connected-source
   listing and retain scoped-source membership checks before workout egress.
2. Risk: unscoped continuations could add unbounded provider work.
   Mitigation: perform the existing bounded provider-inventory read once only
   when the active continuation resource is `workout_stream`.
3. Risk: changing capability authority could regress mixed-source filtering.
   Mitigation: retain existing mixed, unknown, disconnected, incapable, and
   unsupported-response regressions and add the stale-Web/current-live case.

## Tasks

1. Add a failing regression for a connected source whose Web summary is empty
   while current Junction inventory advertises workout-stream support.
2. Derive eligible sources by intersecting connected source listings with the
   current Junction provider projection and load inventory for unscoped full
   workout continuations.
3. Run focused and full provider/service tests, typechecks, diff/privacy checks,
   and inspect the complete corrected diff.
4. Commit and push the corrected candidate, update PR evidence, capture the
   outstanding specialist result, and run the required full-patch final review.
5. Resolve review/CI findings, close the plan through the scoped commit path,
   and prove a clean merge against the current base without merging.

## Decisions

- Accepted the final round-one finding that asynchronously published Web
  capability can lag the runner's current Junction inventory.
- Keep Web source status as authorization and use live provider inventory only
  for current resource capability; do not overlay or republish capability in a
  second owner.
- Accepted the final round-two finding that a feature-local `connected` check
  contradicted the existing non-disconnected import owner during historical
  reconnect recovery. Reuse that owner so disconnect fences remain terminal
  while authorized current ingestion continues.
- Accepted the preliminary specialist finding that the raw workout-index cap
  ran before source eligibility. Delete that premature override so existing
  generic collection safety remains separate from the existing 32-eligible
  candidate selector.
- Accepted the locally proven source-authority progress finding: route the
  per-day eligibility read through the existing workout progress handler so a
  retryable failure or cancellation after a completed day resumes at the next
  day. Add no checkpoint, cursor owner, retry mechanism, or abstraction.
- Rejected a separate hosted listed-only service fixture as duplicate proof:
  existing service wiring, generic listed-only admission, and workout zero-
  egress tests already cover its unchanged owner composition.

## Verification

- Commands to run: focused Junction workout-stream Vitest filters; full
  `junction-provider.test.ts`; full `service.test.ts`; device-syncd typecheck;
  relevant assistant-runtime proof if an existing production-composed harness
  can express the yielded ordering without new machinery; changelog checks if
  its artifact changes; `git diff --check`; privacy scan; exact-head GitHub
  checks; ReviewGPT follow-up; `git merge-tree --write-tree` against current
  `origin/main`.
- Expected outcomes: current live-capable connected sources import workout
  streams despite an empty Web capability summary; disconnected or live-
  incapable sources make zero workout egress; all required checks and reviews
  resolve on the exact pushed head.
