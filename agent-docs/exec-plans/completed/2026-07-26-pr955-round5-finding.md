# PR 955 round 5 finding

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Prevent a stale Pulse continuation page from submitting a different action
  that replaced its shared browser claim in another tab.
- Prevent an older continuation response from clearing a newer tab's claim.
- Preserve server-owned action authority, exact start-now confirmation, and
  mutation-free continue-at-trial-end checks without adding persisted state.

## Success criteria

- Every continuation POST carries the server-rendered action as compare-only
  request metadata.
- The route rejects an absent or mismatched rendered action before either
  billing service and still selects the operation solely from the signed
  session cookie.
- A changed-choice notice remains visible until acknowledgment.
- Continuation responses do not clear the shared cookie and therefore cannot
  erase a newer return installed while an older request is in flight.
- Focused regression tests prove both action orderings and the response-time
  cookie race.
- Canonical diff verification, acceptance verification, parent review,
  preliminary specialist status, CI, and the cap retrospective are complete
  before requesting an explicit round-six decision.

## Scope

- In scope: continuation request header contract, client request, route
  comparison and response behavior, changed-choice presentation, focused
  tests, current Pulse product specs, and PR evidence.
- Out of scope: durable intent state, nonces, queues, webhook recovery,
  migrations, reconciliation, and a second billing owner.

## Tasks

1. Add a failing route/client regression that reproduces action substitution
   and newer-claim deletion.
2. Add one exact compare-only action header and reject mismatches before
   service dispatch.
3. Keep the claim bounded by its existing expiry and make ordinary completion
   inert by removing the public marker, not by clearing a shared cookie.
4. Show a concise changed-choice notice and retain it until dismissal.
5. Run focused and canonical verification, push, update the cap retrospective,
   and wait for CI before requesting the explicit round-six decision.

## Decisions

- The cookie remains the only authority and the route remains the only action
  dispatcher. The header can only prove that the action being submitted is the
  action that page rendered; it cannot select an operation.
- Delete shared response-time cookie clearing because it cannot distinguish the
  claim read at request start from a newer same-name claim installed before the
  response reaches the browser.

## Verification

- Reproduced the finding before the fix: the client omitted the rendered
  action, mismatched claims returned success, stale requests dispatched the
  replacement action, and successful responses emitted a deleting cookie.
- Focused web regression suite: 6 files and 113 tests passed.
- `pnpm --filter @murphai/hosted-web typecheck`: passed.
- `pnpm test:frontend-design-proof`: passed (10/10).
- `MURPH_VERIFY_EXECUTOR=crabbox pnpm test:diff apps/web agent-docs/product-specs`:
  passed in Blacksmith Testbox `tbx_01kyg77a5xqj0dwp63bpwemwb4`.
- `MURPH_VERIFY_EXECUTOR=crabbox pnpm verify:acceptance`: passed in Blacksmith
  Testbox `tbx_01kyg7bkpjzsv6r8bj1qervz4p`.
- Desktop and narrow-width design studies show all five continuation states
  without horizontal overflow.
- The preliminary completion-specialists pass for this PR was already clean.
  Parent review confirmed the cookie remains the sole operation authority,
  both replacement orderings are covered, and no continuation response can
  clear the shared claim.
- `git diff --check` and the staged privacy scan passed.

## Five-round cap retrospective

- Original requirement: preserve a signed-out Pulse return through hosted
  authentication, require fresh exact confirmation for start-now, and let an
  active trial continue without a billing mutation.
- The first final-gate baseline changed 383 source lines and deleted 10. Before
  this remediation, the PR changed 556 source lines and deleted 51.
- The repeated failure mechanism was temporal: the browser rendered consent
  from one cookie claim while the route later dispatched from a replacement
  claim, and an older response could delete that newer shared claim.
- The smallest owning-boundary correction is the compare-only rendered-action
  header plus rejection before billing dispatch and deletion of response-time
  cookie clearing. It adds no persisted state, nonce service, queue, or second
  billing owner.
- After this remediation, the PR changes 627 source lines and deletes 76.
  Round six remains pending an explicit user decision after the remediation
  commit and CI are green.

## Outcome

- Continuation requests now identify the action rendered by the page, while
  the signed cookie remains the sole authority for the operation.
- Missing or changed rendered actions fail before either billing service, and
  the UI retains a changed-choice notice until acknowledgment.
- No success response clears the shared continuation cookie. Public-marker
  removal makes a completed claim inert, and the existing 15-minute expiry
  keeps it bounded.
- Both cross-tab replacement orderings and in-flight response behavior have
  focused regression coverage.
Completed: 2026-07-26
