# Classify direct runtime wake failures

Status: completed
Created: 2026-11-02
Updated: 2026-11-02

## Outcome and protected invariant

Distinguish a documented transport cause from an otherwise unknown failure in
existing direct ensure warnings. Temporal remains the durable wake owner; direct
wake admission, deadlines, retry decisions, request shape, and delivery behavior
are unchanged. No new awaited work, external calls, state, or log events.

## Owner and evidence

`direct-runtime-wake.ts` catches rejected control requests and logs only the
outer error name. Distinct synthetic fetch TypeErrors therefore discard useful
cause codes. Successful-response timing cannot answer a rejected request's
cause. Extend the existing warning with a small closed category; do not infer
that a particular production timeout or network failure occurred.

Undici documents stable error codes and wrapped fetch causes:
https://github.com/nodejs/undici/blob/main/docs/docs/api/Errors.md.
Use only finite source-defined categories. Never log arbitrary cause codes,
messages, stacks, URLs, socket details, identifiers, headers, or payloads.

## Decisions and boundaries

- ReviewGPT authors the localized implementation and composed regression tests.
- Prefer a private bounded extractor in the existing direct-wake owner; no
  dependency, public API, generic error framework, schema, or monitoring owner.
- Inspect own data properties only; do not invoke accessors. Bound cause-chain
  inspection and fail closed for unsupported shapes, cycles, and reflective errors.
- Preserve warning frequency and severity, successful timing callbacks, canonical
  signal acceptance, and asynchronous failure isolation.
- Existing readers ignore additive console fields. Web-only deployment is safe
  with old and new Workers; there is no persisted format or migration.
- No member-visible behavior change; changelog and assistant journey are not
  applicable. Existing composed wake tests cover handoff and bounded failure.

## Verification and completion

- Run the current focused wake suite as baseline.
- Apply new tests without implementation and prove diagnostic assertions fail.
- Apply the authored implementation and prove the focused suite passes, including
  success, synchronous/asynchronous rejection, privacy, and preserved handoff.
- Run Web typecheck/lint, docs drift, complexity, and parent diff review.
- Final exact-head ReviewGPT and required CI precede merge and canonical deploy.
- Verify serving revision and observe bounded outcomes for four hours; retain
  unresolved cause and unexercised-path gaps honestly.

## Progress

- Current base1491685a;15open PR file inventories show no collision with this path.
- Fresh isolated worktree and source-only synthetic author packet prepared.
- Baseline:47composed wake tests pass. Native loopback fetch after listener close
  yields TypeError with own data cause.code=ECONNREFUSED, confirming the
  structured cause shape without external provider access.
- ReviewGPT authored the two-file patch; parent reviewed the complete diff for
  correctness, privacy, bounded work, and preserved admission/failure behavior.
- Tests alone:31new diagnostic cases fail,45preserved cases pass. With the
  implementation:108tests pass across composed wake, direct wake, control
  client, and safe logging suites.
- Web typecheck and lint pass; lint has existing unrelated warnings. Local
  Node24.14.1 is below the manifest24.22.1 minimum; supported exact-head CI
  remains required before merge.
- `pnpm docs:drift` passes. An initial nonexistent check alias was corrected to
  the declared command. `pnpm complexity:diff --base 1491685af1ae94cb0b4328a05c1ee219a5fbc9a5` passes: one
  changed source file, maximum complexity15to20, no hotspot above20.
- The existing warning receives one finite field. Inspection is at most four
  objects/eight own descriptors; no getters, string coercion, enumeration,
  prototype traversal, extra log event, I/O, dependency, or state is added.
- Implementation is complete. Exact-head final review, required CI, canonical
  deployment, and observation are tracked in the PR and operational handoff.

Completed: 2026-11-02
