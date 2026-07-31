# Implement health-data consent withdrawal

Status: active
Created: 2026-07-30
Updated: 2026-07-31

## Goal

- Let an authenticated member explicitly withdraw health-data processing
  consent, immediately stop all governed processing and source admission, and
  later resume only after accepting the current health-data consent documents.

## Success criteria

- Settings exposes a separate withdrawal control, an accurate confirmation
  flow, and a current-document re-consent path.
- Explicit withdrawal revokes `launch.health-data` without mutating immutable
  `launch.legal` acceptance history.
- AI, messaging, source connection, webhook, scheduled-sync, and companion
  health-processing boundaries fail closed for explicit withdrawal while legacy
  accounts without a historical grant retain their existing compatibility.
- Withdrawal starts bounded best-effort cleanup for wearable sources, meal-photo
  authorization, and hosted runtime execution without blocking the canonical
  consent event.
- Settings, account export, and account deletion remain available; export uses
  the latest available vault replica while processing is paused.
- Focused tests, hosted-web typecheck, direct behavior proof, design-catalog
  desktop/mobile proof, required specialist/UI/ReviewGPT review, and exact-head
  CI all pass.

## Scope

- In scope: hosted-web consent parsing and routes, runtime admission gates,
  messaging/source/webhook/sync/companion admission, cleanup orchestration,
  vault export, Settings UI and design catalog, focused tests, and durable legal
  consent documentation.
- Out of scope: account/data/subscription deletion, retroactive reinterpretation
  of absent legacy grants, a new persisted consent owner, or guaranteed
  synchronous provider disconnection.

## Constraints

- Technical constraints: reuse the legal consent registry/event owners and
  existing source/runtime cleanup primitives; keep explicit withdrawal distinct
  from missing historical consent; preserve fail-closed behavior at every
  provider or health-processing boundary.
- Product/process constraints: use the smallest complete Settings interaction,
  preserve export/deletion recovery, keep private evidence out of artifacts,
  update the design catalog, and complete the PR-lane review gates.

## Risks and mitigations

1. Risk: a single ungated ingress or scheduled path processes health data after
   explicit withdrawal.
   Mitigation: inventory all shared admission owners, centralize the explicit
   withdrawal predicate, and add focused boundary tests.
2. Risk: provider cleanup fails after the consent event commits.
   Mitigation: make the canonical revocation authoritative and cleanup
   best-effort, bounded, independently observable, and retry-safe where existing
   owners already support it.
3. Risk: legacy accounts are accidentally treated as withdrawn.
   Mitigation: model only an explicit revoked event as withdrawal and lock the
   distinction with parsing and admission tests.
4. Risk: re-consent or export bypasses the paused-processing boundary.
   Mitigation: allow only the narrow legal/settings/export/deletion surfaces and
   read the existing replica without restarting processing.

## Tasks

1. [x] Inventory current legal consent, admission, cleanup, export, and Settings
   owners; compare every supplied patch hunk against current `main`.
2. [x] Implement the smallest current-owner correction and update durable docs.
3. [x] Add or rebase focused unit, route, rendering, and orchestration coverage.
4. [x] Run focused verification and direct desktop/mobile design-catalog proof.
5. [ ] Commit and push the corrected candidate, run final ReviewGPT round 3,
   and prove the exact head in CI.
6. [x] Replace the repeated consent-snapshot race with one serialized execution
   barrier at the existing Cloudflare write-fence owner and add interleaving
   proof for withdrawal and renewal.
7. [ ] Resolve any remaining accepted findings, complete the parent final
   review, archive this plan, and prove mergeability.

## Decisions

- Treat the supplied patch as behavioral intent because it does not apply to
  current `main`.
- Use existing legal-consent events as the sole persisted source of truth; do
  not add a second withdrawal state owner.
- Commit explicit revocation before best-effort cleanup, and recheck that state
  before queued model usage and after the slow export-authorization boundary.
- Serialize consent grant/revocation and health-processing admission on the
  hosted member row; acquire connection locks only after that authority read.
- Wait for the serialized Cloudflare barrier before acknowledging withdrawal;
  clear the active write fence, stop the exact runner container, and let every
  later ensure re-read current Web-owned consent. Keep only source and
  meal-photo cleanup deferred and best effort, with authority rechecks in those
  existing owners.
- Keep the public design study fully inert by rendering the exported dialog
  bodies inline; preview-only state must not enter the production component or
  escape through a portal.
- Keep export authorization and retained-replica selection route-owned. The
  Settings page must not project consent into the export control, and missing
  retained data must not wake a withdrawn runtime.

## Review anomaly retrospective

- Trigger: final ReviewGPT correction round 2 found that runtime reconciliation
  and deferred workflow termination repeated the same check-then-act consent
  snapshot mechanism addressed by the earlier device and meal admission fixes.
  The next substantive run is also round 3. Current authored-source churn is
  1,508 additions and 208 deletions versus 1,041 additions and 74 deletions at
  the immutable first-reviewed head.
- Original requirement: withdrawal success must mean that no new health-data
  processing can start, while renewal success must mean that withdrawal work
  can no longer affect the restored processing authority. Provider cleanup may
  remain best-effort, but neither API may acknowledge a state its execution
  boundary has not reached.
- Repeated mechanism: member-row serialization made database admissions linear
  with consent mutations, but runtime reconciliation still handed a snapshot to
  a later Cloudflare execution call and deferred termination used another
  snapshot before acting on a fixed workflow identity.
- Decision: continue with a boundary redesign. Keep the hosted consent grant as
  the sole product truth, reuse the existing per-user Cloudflare write-fence
  owner as the execution barrier, and serialize ensure-processing plus consent
  reconciliation there. The barrier re-reads current Web-owned consent under
  signed callback authority. Withdrawal success waits for that owner to stop
  the active fence/container; renewal success waits behind any earlier stop and
  then signals the existing Temporal workflow to re-read current facts. Delete
  deferred fixed-workflow termination instead of adding a new durable consent
  owner, state machine, queue, lease, or reconciliation loop.
- Linearization promise: work already running before withdrawal may be
  interrupted by the barrier, but the withdrawal endpoint does not return
  success until the active runner is stopped and every later ensure must re-read
  the revoked grant. Renewal does not return success until the same serialized
  owner has observed the current grant after all earlier stop work, so an old
  withdrawal cannot terminate the renewed runtime.
- Required proof: pause an ensure immediately after its consent read, commit
  withdrawal, release it, and prove the later withdrawal barrier leaves no
  active processing; pause withdrawal reconciliation, commit renewal, release
  it, and prove the renewal barrier wins; prove renewal signals processing
  without an unrelated inbound event.

## Verification

- Commands to run: focused hosted-web Vitest slices for every touched boundary;
  hosted-web typecheck; direct route/render scenarios; repository design-proof
  guard; desktop/mobile browser proof; exact-head GitHub Actions.
- Expected outcomes: explicit withdrawal is enforced immediately and
  compatibly, re-consent restores only after current documents are accepted,
  cleanup failures do not undo revocation, and all required checks/reviews pass.
- Completed local proof:
  - the original candidate regression command passed 22 files and 624 tests;
  - the review-remediation regression command covers 11 focused files and more
    than 400 consent, messaging, runtime, group, device, and Settings tests;
  - hosted-web, hosted-execution, and device-syncd typechecks passed;
  - the focused device-syncd public-ingress suite passed 67 tests;
  - hosted-web ESLint passed with existing warnings only, and focused changed
    paths passed without new warnings;
  - the real production dialog focused Cancel first, and every target
    desktop/mobile design element had equal client and scroll widths;
  - the Claude Code UI double-check found and verified fixes for the public
    preview portal escape, destructive initial focus, mobile row rhythm, and
    hidden withdrawal failure feedback, ending with no findings.
- Final ReviewGPT round 1 found five accepted authority, ordering, cleanup, and
  Settings-gate issues. The corrected candidate now enforces exact Linq sender
  and grantor consent, transaction-local source and meal admission, unconditional
  runtime reconciliation denial, response-independent cleanup, and the narrow
  explicit-withdrawal Settings exception. Final correction verification and a
  valid preliminary specialist retry remain pending on the pushed exact head.
- Final ReviewGPT round 2 required the anomaly retrospective above before a
  third substantive round because the runtime and cleanup corrections retained
  a consent-snapshot check-then-act race. The finding is accepted; merge and
  completion remain paused until the redesigned boundary and concurrency proof
  pass.
- The serialized Cloudflare barrier is implemented and covered by direct
  revoked admission plus withdrawal/renewal interleaving tests. The focused
  Cloudflare owner run passed 201 tests; hosted-execution and
  cloudflare-hosted-control contract/parser runs passed 41 and 51 tests.
- The substantive preliminary specialist pass returned five findings, all
  accepted and resolved: unavailable Settings status now has a direct retry;
  export authority is route-owned and retained-export copy is truthful; source
  disconnection copy is explicitly best effort with a review/reconnect path;
  re-consent cannot be dismissed while its legal mutation is pending; and the
  owner-level route, Settings, export, and cleanup tests cover those states.
- Corrected-head product-purpose revalidation: the irreducible purpose is to
  let a member stop Murph health-data processing without losing their account,
  retained data, or subscription, then knowingly resume under current consent.
  One Settings row, one consequential confirmation, one paused/recovery state,
  the existing consent card, and the existing export control are the smallest
  complete journey. No product-experience finding remains after the specialist
  corrections. The remaining evidence gap is visual only: both isolated
  Turbopack and Webpack attempts reached `/design` compilation but did not
  return the route within five minutes; Webpack also exposed an unrelated eager
  components-tab `node:crypto` import before a bounded lazy-loading diagnostic
  removed that error without completing the route. All owned dev processes
  were stopped, the diagnostic design-loader change was reverted, and the
  earlier desktop/mobile layout evidence remains available while corrected
  semantic states are proved by the real-component tests.
- Latest focused Web proof passed 144 assertions across the selected files
  after a single loaded-host import hook exceeded its default 60-second budget;
  the isolated browser-vault rerun passed all 33 assertions. Changed-path
  ESLint and hosted-Web typecheck pass. Cloudflare, hosted-execution, and both
  shared control packages typecheck.
- The required Fable UI double-check found and verified focused fixes for the
  export study's dialog context, source-review link hit geometry, retry-failure
  emphasis and focus retention, and missing ready/error/pending catalog states.
  Its correction-only final pass returned `NO FINDINGS`; the stale rendered
  screenshot gap above remains explicitly recorded as evidence, not a defect.
- The design catalog emitted an existing hydration mismatch from the unrelated
  Family billing recovery study. It did not involve or prevent the target
  consent studies from rendering and is outside this task's diff.
