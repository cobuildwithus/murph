# PR 2210 current-main integration

Status: completed
Created: 2026-08-25
Updated: 2026-08-27

## Goal

Ship the event, document, intake, journal, assessment, manifest, and export
recovery slice on current `main` with finite owner-authored public paths,
truthful stages, and no duplicate projector, repair transport, or state owner.

## Evidence

- Exclusive ownership is proven at clean local, upstream, and PR head
  `f349677f66e1e0df11991c04b7f7aa51e6adaaf9`.
- ReviewGPT round two passed the complete domain slice on the historical
  foundation branch.
- Current `main` now owns the shared projector, CLI guidance, and generic
  recovery tests. Integration must retain only event/document domain mappings,
  their focused tests, authored plans, generated CLI artifacts, and measured
  lazy bundle allowance.
- Current `main` is merged through `b9f8de1f95dd3adfcc819240b98c1af9f0acffee`.
  The only manual composition keeps one shared bundle budget and adds the two
  measured lazy-graph allowances without changing entry or startup topology.
- Focused recovery proof passes 75 tests; the runner bundle guard passes 14
  tests; importers, Vault Usecases, and CLI typechecks pass; prepared runtime,
  package shape, docs drift, and docs gardening pass.
- Canonical hosted-runner assembly passes all eight CLI parity probes. The CLI
  measures 9,523,956 B total, 805 B entry, and 25,155 B static startup against
  the composed guard; the runner measures 11,353,283 B total.
- Final ReviewGPT round three required the size retrospective now recorded in
  the PR contract. The decision keeps one owner-complete slice because splitting
  it would duplicate the same mappings, bundle allowance, schemas, and tests;
  nested parser and duplicate projector machinery remain deleted.
- Parent review found one residual raw-detail channel: event and assessment
  contract mappings added sanitized issues but still retained the original
  `details.errors`. Both mappings now set `preserveDetails: false`, so the
  existing fixed stage, owner code, and safe issues are the complete context.
  Vault-usecase projection/formatter proof passes 8/8 and the affected built-CLI
  event/document recovery suite passes 10/10. Vault-usecases typecheck and
  `git diff --check` pass.
- ReviewGPT round four found that the finite event-contract field set admitted
  the unused input alias `eventId` but omitted the canonical schema path `id`,
  collapsing malformed identity recovery to the root. The accepted correction
  replaces only that finite entry; top-level parsing, root fallback,
  `preserveDetails: false`, and dynamic-key non-echo behavior remain unchanged.
  Prepared runtime verification passes, the focused built-CLI recovery suite
  passes 11/11, and CLI plus Vault Usecases typechecks pass. Product UX Patch
  walkthrough: malformed `id` and `eventId` inputs both return the canonical
  `id` field without echo or any ledger/audit mutation, and correcting either
  spelling revises the existing event with `created: false`; Ready.
- ReviewGPT round five found that Core collapsed explicitly supplied unusable
  `id` / `eventId` values to absence before the event contract ran, allowing a
  rejected edit-shaped request to mint a new event. The accepted owner-local
  correction keeps canonical `id` precedence over the legacy alias, treats
  only actual absence as permission to mint, and routes null, blank, or
  non-string identity through the existing canonical `id` contract recovery
  before any write. The unused `EVENT_ID_NOT_ALLOWED` CLI mapping is deleted:
  its sole Core producer is confined to bulk import, where per-row failures are
  always wrapped as `EVENT_BATCH_INVALID` before reaching the single-event
  projector. Focused Core and built-CLI proof covers both aliases, every invalid
  value class, canonical-alias precedence, bounded non-echo recovery, zero
  rejected writes, and corrected retries that revise the existing record. The
  two focused Core cases, all 11 event/document built-CLI recovery cases, and
  all 8 Vault-usecase helper seam cases pass; Core, Vault-usecases, and CLI
  typechecks plus `git diff --check` and the scoped identifier scan pass.
- Integrated current `main` through merged core-runtime recovery
  `bf4fb93d22` at merge candidate `2c8317be8f`. The obsolete absolute bundle
  cap was deleted in favor of `main`'s relative first-parent guard, generated
  CLI metadata was rebuilt canonically, and the two Vault-usecase import
  conflicts retained both existing owner-local recovery sets.
- A recovered final audit found that invalid stored event records were emitted
  as input `validation` failures. Stored-record validation now marks its source
  as `read`, while the existing projector preserves only that finite marker and
  otherwise defaults to `validation`. The 12-case built-CLI recovery suite
  proves the corrupted ledger is not written, private stored content is not
  echoed, storage repair makes the same import succeed, and input validation
  behavior remains unchanged. Core, Vault-usecases, and CLI typechecks pass.
- Exact-head ReviewGPT round six passed the full 20-file snapshot at
  `2281acce96ebe21d4a5110f2ddf40189bc1c2eb7`. It verified every prior accepted
  correction, the stored-record `read` classification, byte-for-byte zero-write
  behavior, bounded non-echo output, same-event recovery after storage repair,
  and the completed keep-one-slice size retrospective. It found no merge-veto
  issue or complexity collapse.

## Design

- Current `main` remains the sole generic error-projector and assistant-guidance
  owner.
- Event, document, file, manifest, assessment, and export owners retain only
  finite schema fields, safe indices, selected-file facts, and truthful stages
  they can prove.
- Add no repair object, nested-path parser, logging pipeline, retry manager,
  document index, compatibility path, second transport, or persisted state.

## Tasks

1. Merge current `main` and resolve duplicate foundation history by ownership.
2. Prove the resulting tree is current `main` plus only the domain slice,
   authored plans, generated CLI artifacts, and measured bundle allowance.
3. Run focused domain tests, affected typechecks, prepared/package-shape checks,
   docs gates, and canonical runner parity proof.
4. Push the exact candidate, retarget the PR to `main`, update the PR contract,
   and run a sensitive current-main final audit with the prior ledger.
5. Resolve accepted findings, close the plan, admit the exact head to required
   CI, prove a clean current-base merge, merge, and retire the worktree.
Completed: 2026-08-27
