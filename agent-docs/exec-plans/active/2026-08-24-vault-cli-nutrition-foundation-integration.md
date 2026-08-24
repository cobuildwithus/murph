# Vault CLI nutrition foundation integration

Status: active
Created: 2026-08-24
Updated: 2026-08-24

## Goal

- Integrate the finalized single-owner Vault CLI error foundation into the
  already-reviewed nutrition recovery branch without restoring the deleted
  repair abstraction or losing safe, actionable error classification.

## Success criteria

- The foundation commit is an ancestor of the branch and the only textual
  conflict retains both independent built-CLI tests.
- Validation producers use `VaultCliError.context.issues`; removed repair
  types, properties, fourth constructor arguments, and repair-only assertions
  are absent.
- Nutrition provider failures retain safe code, message, retryability, and
  allowlisted context; food, recipe, and protocol validation retains bounded
  value-free field guidance where supported by finalized foundation semantics.
- Focused foundation and nutrition tests, affected typechecks, package shape,
  workspace boundaries, privacy/diff checks, and production bundle/parity all
  pass before the Draft PR is handed back for the later shared-projector port.

## Scope

- In scope: merge conflict resolution, mechanical migration to the finalized
  error constructor/context contract, directly affected regression updates,
  bundle budget reconciliation if measured output requires it, and PR evidence.
- Out of scope: a replacement repair API, projector widening, new error state
  owners, unrelated CLI families, retries, or provider logging.

## Constraints

- Technical constraints: preserve the final foundation's one metadata owner;
  derive validation fields only from allowlisted Zod-like issues; never expose
  submitted values, provider bodies, credentials, input paths, or vault record
  paths.
- Product/process constraints: preserve the reviewed nutrition behavior to the
  extent supported by the finalized foundation, keep the PR Draft during
  mutation and handoff, and do not launch ReviewGPT while the later finalized
  shared-projector correction remains known work.

## Risks and mitigations

1. Risk: A clean textual merge can retain calls to the deleted repair API.
   Mitigation: scan the integrated tree for deleted symbols, `.repair`, and
   constructor arity, then run all affected typechecks.
2. Risk: Mechanical migration could silently make validation generic again.
   Mitigation: pass original Zod issues through `context.issues` and exercise
   registered CLI envelopes for food, recipe, and protocol failures.
3. Risk: Provider recovery could expose raw response or transport detail.
   Mitigation: retain only the existing allowlisted context and rerun the
   provider response-body and final-envelope privacy matrix.

## Tasks

1. Merge the finalized foundation and resolve the one adjacent-test conflict by
   retaining both tests.
2. Delete repair-only call-site machinery and migrate validation errors to
   context-owned issues while retaining provider classification.
3. Update focused tests to the finalized envelope and run local proof.
4. Inspect the integrated diff, reconcile bundle budget only if required, close
   the plan, commit, push, refresh the Draft PR evidence, and hand back for the
   later shared-projector correction.

## Decisions

- Product UX effort: Patch.
- Outcome: the assistant receives the finalized safe envelope with enough fixed
  constraint, retryability, or validation-field detail to recover without
  guessing from submitted data.
- Reaches: existing local and hosted turns that call nutrition label search,
  food/recipe mutations, or private-protocol imports.
- Proof: registered built/source CLI journeys cover provider, validation,
  stored-state, and no-write failures through final machine envelopes.
- Explicit hints and non-validation stages from the deleted repair channel are
  not recreated; stable codes, safe messages, retryability, and context issues
  are the finalized owners.

## Verification

- Focused foundation and nutrition Vitest suites; affected package typechecks;
  CLI package-shape and workspace-boundary checks; canonical production runner
  bundle/parity; deleted-API, privacy, unsafe-cast, and whitespace scans.
- Expected: all checks pass, registered error envelopes remain value-free and
  actionable under the finalized projection, and the pushed exact head is clean
  against the PR base.
- Result: nutrition matrix passed (8 files, 98 tests); foundation matrix passed
  (9 files, 254 tests, including 69 built-CLI smoke tests); all six affected
  package typechecks, CLI package shape, workspace boundaries, Frog inspection,
  production runner bundle/parity, and static scans passed.
