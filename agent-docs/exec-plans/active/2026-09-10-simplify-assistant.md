# Remove redundant assistant parsing and discovery

## Outcome and invariants

Reuse the current dynamic-tool parser, explicitly launch the built CLI for contract generation, and derive the zero-or-one current model catalog. Preserve tool transformations, validation feedback, model selection, CLI subprocess bounds, and generated guidance.

## Evidence and owners

The CLI generator already supplies its built entry and runtime reads the artifact. Only tests use discovery. Static model catalogs are empty outside mocks. Straightforward tool parsers repeat the existing wrapper; specialized response-card normalization and diagnostic paths remain local.

## Plan

- Remove discovery APIs/helpers and migrate fixture callers.
- Delete empty static catalog plumbing; keep UI exports and current model capabilities.
- Reuse parseDynamicToolArguments only where input and diagnostic semantics agree.
- Run focused tests, engine typecheck, a synthetic live journey, complexity review, CI, and ReviewGPT.

## State and rollout

No new state, dependencies, schemas, provider advertisements, network calls, or deployment ordering. Existing CLI execution failure, timeout, output validation and redaction remain authoritative.

## Progress

Implementation complete. The 11-file focused suite passed 333 tests; the final four-file parser rerun passed 156 tests. Engine typecheck and complexity guard passed. Parent reviewed the complete source/test diff and confirmed no remaining removed-symbol callers. The focused live schema-recovery journey, exact-head CI, and ReviewGPT remain pending.
