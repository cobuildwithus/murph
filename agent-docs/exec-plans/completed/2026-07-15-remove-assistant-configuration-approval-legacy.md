# Remove legacy assistant configuration approvals

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Remove the rollout-only approval-backed assistant model/reasoning update
  contract now that new runtimes use member-bound live-input authority, while
  preserving the generic secure-approval system for vault-file delivery.

## Success criteria

- The assistant-configuration control contract accepts only reads and updates
  carrying a valid `assistantInputId`.
- The web handler no longer imports, reconstructs, or consumes configuration
  approvals, and it still validates live-input authority before mutation.
- The configuration-specific approval helper module, package export, and
  approval-only tests are deleted; generic action approval and vault-file send
  behavior are unchanged.
- Current architecture, security, product, and testing docs describe the hard
  cut rather than the completed rollout bridge.
- Focused and routed verification, required coverage review, PR ReviewGPT, and
  CI complete with no unresolved accepted findings.

## Scope

- In scope: hosted-execution assistant-configuration request types/parsers and
  package exports; the web assistant-configuration handler and focused tests;
  current durable docs that still describe the temporary approval bridge.
- Out of scope: generic hosted action approvals, vault-file approval and
  delivery, settings-originated configuration updates, mailbox schemas, and
  any new authorization mechanism.

## Constraints

- Technical constraints: retain the signed active-runtime write fence, callback
  member binding, live mailbox-input proof, access/Sol entitlement revalidation,
  next-turn application semantics, and strict rejection of unknown request
  fields.
- Product/process constraints: this cleanup may deploy only after the merged
  direct-update runner bundle has passed protected-main deployment/smoke and
  old bundles have drained for at least the bounded 180-second assistant idle
  window. Use a separate PR and state the deploy precondition explicitly.

## Risks and mitigations

1. Risk: web deploys the hard cut while an old runner can still send the legacy
   approval shape.
   Mitigation: require successful immediate Cloudflare rollout and managed
   runner fingerprint smoke for the merged producer-removal build, then wait at
   least 180 seconds before this cleanup deploys.
2. Risk: deletion accidentally weakens or removes vault-file approval.
   Mitigation: delete only configuration-specific helpers and prove the generic
   action-approval and vault-file paths remain referenced and covered.
3. Risk: parser simplification admits an unauthenticated update shape.
   Mitigation: keep `assistantInputId` mandatory for every update and add exact
   rejection proof for the removed `approval`/`target` fields.

## Tasks

1. Inventory every configuration-specific approval symbol, export, parser
   branch, handler branch, test, and current durable-doc claim.
2. Hard-cut the runtime control contract and web handler to the live-input path;
   delete the approval helper module and export.
3. Remove approval-only tests and strengthen focused direct-path/rejection
   coverage.
4. Update current docs to record the completed hard cut and deployment
   precondition.
5. Run routed verification, required audits, final diff/privacy review, scoped
   commit, PR, ReviewGPT, CI, and merge-conflict proof.

## Decisions

- Treat this as a deletion-only protocol contraction. Do not add a replacement
  compatibility flag, migration state, allowlist, or second authority path.
- Keep the PR unmerged until protected-main Cloudflare deployment of the direct
  update producer has succeeded and the 180-second old-runner drain has elapsed.
- The deployment gate was satisfied on 2026-07-15: protected-main deployment
  run `29421111774` completed successfully for `9d53f7e87e`, which contains the
  producer-removal merge, and the required drain elapsed before cleanup handoff.

## Verification

- Commands to run: focused hosted-execution and web assistant-configuration
  tests during implementation; final `pnpm test:diff packages/hosted-execution
  apps/web` (expanded if the diff router selects more owners); stale-symbol and
  generic vault-approval reference checks; `git diff --check`.
- Expected outcomes: direct read/update parsing and live-input mutation pass;
  legacy approval/target payloads fail strict parsing; no
  `assistant-configuration-approval` export or source remains; generic
  action-approval/vault-file tests remain green.

## Completion evidence

- Focused hosted-execution and web assistant-configuration suites passed.
- `pnpm test:diff packages/hosted-execution apps/web` passed after preparing the
  runtime build artifacts required by the hosted-local reverse-dependent suite;
  this included package typechecks/tests, hosted-local package-boundary proof,
  hosted-web verification and production build, and Cloudflare verification.
- The required coverage-write audit reported no findings, no test edits, and no
  unresolved actionable coverage gaps.
- Stale configuration-approval symbol scans were empty, generic vault-file
  approval references remained present, `git diff --check` passed, and the
  privacy scan found no direct personal identifiers or secret patterns.
Completed: 2026-07-15
