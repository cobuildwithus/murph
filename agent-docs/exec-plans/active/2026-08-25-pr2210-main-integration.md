# PR 2210 current-main integration

Status: active
Created: 2026-08-25
Updated: 2026-08-26

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
