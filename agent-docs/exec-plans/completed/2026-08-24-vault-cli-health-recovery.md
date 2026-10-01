# Vault CLI clinical and health error recovery

Status: completed
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Restore the existing Vault CLI promise that malformed clinical and health
  inputs fail before canonical writes and return bounded, value-free repair
  guidance that lets the calling model correct the exact field.

## Success criteria

- Invalid clinical assertion and diagnostic dates use native option-validation
  envelopes with the exact option path instead of escaping as `UNKNOWN`.
- Clinical, encounter, registry-health, and blood-test payload failures attach
  the foundation's explicit repair contract without serializing raw payloads or
  arbitrary validation context.
- Immunization imports reject unknown keys before writes and expose a strict
  payload schema through the existing descriptor-owned `payload-schema` route.
- Goal, condition, allergy, blood-test, and genetics list status filters reject
  misspellings against their existing canonical enum owners.
- Focused unit and final CLI-envelope tests prove repairability, non-echo, and
  rejection-before-write behavior; touched packages typecheck.

## Scope

- In scope: VCE-004 clinical date option parsing; VCE-001 repair metadata for
  clinical/health imports and blood-test typed options; strict immunization
  import schema/descriptor exposure; descriptor-owned list-status validation
  for goal, condition, allergy, blood-test, and genetics.
- Out of scope: shared CLI transport/foundation changes; unrelated Vault CLI
  command families; new telemetry or log storage; broad schema or error
  abstraction; pushing, opening a PR, or running ReviewGPT.

## Constraints

- Technical constraints: build on the exact foundation commit; retain canonical
  schema and enum owners; preserve package dependency direction; reject invalid
  inputs before any core mutation; never echo submitted health values.
- Product/process constraints: Product UX Patch only; use a sanctioned isolated
  worktree and active plan; preserve unrelated work; finish with one scoped
  commit through `scripts/finish-task`.

## Risks and mitigations

1. Risk: repair fields could leak submitted health values through Zod messages.
   Mitigation: derive only path, stable code, safe expected type, and fixed
   value-free guidance; add sentinel non-echo assertions at final envelopes.
2. Risk: strict immunization parsing could occur after a partial write.
   Mitigation: parse the whole payload through the shared strict schema before
   invoking the canonical core owner and assert no write on failure.
3. Risk: generic status validation could reject families without supported
   enums or drift from contracts.
   Mitigation: make status schema optional on each descriptor and attach only
   the five requested contract-owned enums.

## Tasks

1. Inspect the foundation API, current descriptors/contracts, producer paths,
   tests, and open ownership state.
2. Add the smallest shared schema/descriptor extensions for immunization and
   per-family list statuses.
3. Migrate clinical/health producer failures to explicit bounded repair fields
   and move clinical date validation to command option schemas.
4. Add focused owner tests and exact built-CLI envelope/privacy scenarios.
5. Run focused tests, touched-package typechecks, diff/privacy review, Product
   UX walkthrough, and finish the plan with one scoped commit.

## Decisions

- Product UX classification: Patch.
- Outcome: the model receives the field, allowed shape, and recovery action for
  malformed existing health commands instead of a generic error or false empty.
- Reaches: clinical assertion/diagnostic saves; clinical, encounter, registry,
  and blood-test imports; immunization imports/schema discovery; five existing
  health list filters.
- Proof: exact machine envelopes plus canonical-write spies and value sentinels.
- Keep the repair metadata producer-authored; arbitrary contexts remain private
  and the foundation transport remains untouched.
- The parent integration package owns the consolidated changelog and PR
  description so parallel recovery shards do not publish duplicate entries.

## Verification

- Commands to run: focused Vitest files for clinical imports, health tail,
  encounter import, and blood-test save; focused vault-usecases tests; package
  typechecks for contracts, vault-usecases, and CLI; `git diff --check` and
  privacy-sensitive final diff inspection.
- Expected outcomes: every invalid case returns a stable field-specific
  envelope, contains no submitted sentinel value, and leaves mutation spies at
  zero; valid behavior remains unchanged.

## Progress

- Clinical assertion and diagnostic dates now fail in native option validation
  with their exact camel-case paths.
- Clinical, encounter, registry-health, and blood-test producers now attach the
  bounded repair contract and no longer serialize raw Zod issue context.
- Immunization imports validate through a strict shared contract before loading
  the write runtime, and the exact schema is discoverable through
  `immunization payload-schema`.
- The five requested list-status surfaces now use their contract-owned enums.
- Contracts, vault-usecases, and CLI typechecks pass. Focused contract tests
  pass with 27 tests, focused usecase tests pass with 38 tests, and focused CLI
  final-envelope tests pass with 59 tests. Contract artifacts and CLI package
  shape also verify cleanly.

Completed: 2026-08-24
Completed: 2026-08-24
