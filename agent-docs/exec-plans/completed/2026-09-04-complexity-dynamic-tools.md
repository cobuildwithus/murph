# Collapse repeated dynamic-tool dispatch mechanics

Status: completed

## Outcome and protected invariants

Reduce repeated parser probing and group request preparation inside the existing
dynamic-tool owner. Preserve first-match parsing, contextual parser inputs,
fresh-input authority, preflight-before-generation ordering, capture identities,
usage accounting, response payloads, and model-visible errors.

## Evidence and architecture

The dispatcher repeats ten parser call/return blocks after automation parsing.
The group executor repeats avatar preparation result handling and private direct
authority checks for ask and handoff. Collapse these at the existing owner;
introduce no state, dependency, framework, transport, or deployment contract.
Existing PRs 2485 and 2629 touch other device and response-card sections.

## Product UX

Internal refactor with no intended product change. Preserve private ask/handoff,
contact-card publication, group-avatar preflight denial, and parser recovery.
Focused deterministic proof covers admitted and denied authority plus exact
request identity. A synthetic real-Codex handoff journey supplements it; inspect
the actual reply for truthful queued-versus-delivered status.

## Tasks

- [x] Collapse parser and group executor duplication.
- [x] Run focused boundary suites, package typecheck, and complexity diff.
- [x] Extend and run focused real-Codex proof; inspect reply.
- [x] Prepare the scoped implementation candidate for parent review.

Exact-head CI and ReviewGPT remain external PR gates and are tracked in the PR.

## Failure and rollout

No changed retries, request counts, storage, wire contracts, or rollout order.
Keep action-specific authority and preflights before expensive work. Preserve
the task worktree while its PR remains open.

## Verification and review evidence

- Group/domain/parser/clinical suites: 139 passing tests across four files.
- Eight additional parser-owner suites: 135 passing tests.
- Assistant Engine package typecheck and diff whitespace check passed.
- Complexity guard passed: file debt 553 to 538; parser 88 to 80 and group
  executor 174 to 167. Production source deletes 105 net lines; no new owner.
- Focused real Codex handoff recovery uses production instructions and tools,
  a synthetic hosted port, gpt-5.6-terra, and local subscription authentication.
  The selected-route failure made exactly two calls with trusted origin, no
  queued result, and a concise truthful manual fallback. The unavailable-inventory
  case made only one inventory call and offered truthful no-queue recovery.
  Both actual replies were inspected. Reply review: Ready.
- Earlier subscription homes failed before any action, including explicit usage
  limits. An authorized alternate completed the journey; no auth was copied,
  production boundary weakened, or model changed. Temporary metadata diagnostics
  were removed from the candidate.
- Parent review inspected parser input preservation and merged avatar result,
  usage, preflight and identity handling; final candidate review follows the
  scoped commit and exact evidence.
- Internal refactor: no changelog item or deployment ordering requirement.
Updated: 2026-09-04
Completed: 2026-09-04
