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
5. [ ] Commit and push the corrected candidate, then retry the preliminary
   specialist pass, run final ReviewGPT correction verification, and prove the
   exact head in CI.
6. [ ] Resolve any remaining accepted findings, complete the parent final
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
- Return the committed withdrawal response before provider cleanup, terminate
  runtime work first in the deferred cleanup, and re-check consent so delayed
  cleanup cannot undo renewal.
- Keep the public design study fully inert by rendering the exported dialog
  bodies inline; preview-only state must not enter the production component or
  escape through a portal.

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
- The design catalog emitted an existing hydration mismatch from the unrelated
  Family billing recovery study. It did not involve or prevent the target
  consent studies from rendering and is outside this task's diff.
