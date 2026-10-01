# Simplify Linq mailbox envelope construction

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

- Build the common Linq mailbox identity once, preserving serialized output and all
  routing, privacy, omission and lazy fallback behavior.

## Success criteria

- Exact base/head serialized-wake equality, focused dispatch/thread-route tests,
  Web typecheck, complexity guard and parent review.

## Scope

- In scope: one private wake builder, identical nullable-string primitive reuse,
  and synthetic serialized-byte fallback tests.
- Out of scope: new modules, exports, policy, state, deployment protocols or UI.

## Constraints

- The Web planner remains the mailbox preparation owner; the hosted-execution
  builder still validates targets and clones inputs on each of its three calls.
- Preserve object property order and explicit null/undefined/truthiness behavior.
- Both callers create ordinary records; no async work or mutation occurs between
  fallback attempts. Keep normal, compact and minimal part construction lazy.
- Concurrent Linq cap PRs do not edit this builder; overlapping test edits only
  remove unrelated deprecated fixture fields.

## Risks and mitigations

1. A fallback might accidentally lose routing authority or disclose attachment URLs.
   Mitigation: exercise actual byte-limit fallback branches with synthetic payloads
   and compare exact base/head serialized output.

## Tasks

1. Add deterministic actual compact/minimal fallback coverage.
2. Hoist one typed wake input and reuse the existing string normalizer.
3. Run focused proof, review the full diff/privacy and archive the plan.
4. Commit and open a draft PR; parent owns Ready, ReviewGPT and CI.

## Decisions

- Reuse existing owners instead of adding a helper module or new public API.
- Initial Frog list requires a frozen dependency install in the new worktree.

## Verification

- Passed: hosted-Web dispatch/thread-route Vitest, 372 tests with two workers.
- Passed: an AST-selected base/head execution harness compared 18 cases across
  normal/compact/minimal staging, phone/email contacts and omitted/null/group
  optional fields. Exact JSON, property order, canonical-builder call counts
  (one/two/three), input immutability and signed URL exclusion matched.
- Representative serialized UTF-8 bytes were 20,301 / 127,878 / 121,045 for the
  three staging modes. Full input capture was unnecessary because wakes match.
- Passed: complexity guard (wake builder 21 to 9; file debt 279 to 278) and
  workspace boundaries. Nine unchanged admission/transaction hotspots remain;
  their tightly coupled authority decisions are outside this bounded change.
- Parent candidate review passed the complete source and test diff.
- Passed: hosted-Web typecheck after canonical generated-input preparation.
  The first run identified a test-only channel-narrowing omission; an explicit
  Linq discriminator check fixed it, and the prepared typecheck passed.
- Live assistant proof is not needed for unchanged deterministic ingress assembly.
Completed: 2026-09-10
