# Log privacy-safe assistant reply skip reasons

Status: completed
Created: 2026-09-17
Updated: 2026-09-17

## Goal and invariant

Populate existing reply-skip event diagnostics with bounded reason codes without
changing reply decisions or exposing input, provider, or error text.

## Ownership and evidence

The engine emits skip reasons in unrestricted event details. Hosted maintenance
intentionally omits those details but already forwards safeDetails to runtime
logs. Classify exact known static reasons at the existing engine event boundary;
reuse safeDetails and the existing log transport. Unknown reasons produce only
reply_skip:unclassified. No state, protocol field, queue, or dependency is added.
The typing-alert classification is independently owned by PR #3529.

## Scope and risks

- Change only skip-event diagnostics, focused engine/runtime tests, and the log owner doc.
- Preserve private unrestricted reasons in their existing local owner; never copy
  them into hosted diagnostics. Prefix/suffix and unknown inputs must fail closed.
- New or changed prose defaults to the generic code; tests bind known decisions
  to their codes. Non-skip diagnostics and all reply behavior remain unchanged.
- Existing consumers accept safeDetails already. A runtime rollout enables new
  codes; no Web deploy order or migration is needed. Revert removes new codes.

## Tasks and verification

1. Prove known skip, deferred, and private unknown reasons through actual outcome emission.
2. Prove hosted logging forwards the code and omits unrestricted details.
3. Run focused suites, engine/runtime typechecks, complexity and docs checks.
4. Inspect privacy and full diff, close plan, commit, open PR, run ReviewGPT and CI.

## Product and changelog

Internal observability only. No member-visible behavior, provider input, tools,
reply policy, or new foreground I/O; no live-model proof or public changelog needed.

## Candidate evidence and review

- Engine automation suite: 194 tests passed, including existing channel/self-authored
  decisions, deferred evidence, and private/unknown exact-match fallback cases.
- Hosted maintenance: 130 tests passed; private event details are absent from logs.
- Workspace diagnostics: 4 tests passed, including durable log-port propagation.
- Engine and runtime package typechecks passed.
- Complexity: passed; source debt remains 107 and maximum 47. All eight existing
  hotspots are unchanged; the edited event emitter remains below threshold.
- Parent review: one bounded in-memory map lookup at existing event emission;
  no additional await, database/network call, log event, state, or authority.
  New static reasons default safely to unclassified until explicitly mapped.
- Docs drift/gardening, raw-log guard, and diff checks passed. Web ESLint does
  not cover package files (outside its base path); package typechecks, focused
  tests, complexity analysis, and CI are the relevant validation here.
Completed: 2026-09-17
