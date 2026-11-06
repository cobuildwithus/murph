# Frog verification follow-up

## Outcome and invariants

Make latency-query correctness proof selectable without the large stress fixture
(#2804), document the trusted compatibility-controller bootstrap (#2775), and
explain supported exact-metadata ReviewGPT capture recovery (#3213).
Keep production SQL, candidate limits, index assertions, local database guards,
and protected controller authority unchanged.

## Evidence and approach

The current candidate-query test combines five branch fixtures, 50,000 stale
rows per table, and 20,001 cap rows in one transaction. Reuse that fixture at two
scales; the small case proves hydration and classification, while the stress
case retains all plan and truncation assertions. Use the existing testing map
and Temporal reference for operational commands and bootstrap order.

## Verification and completion

- Run the small and full real-PostgreSQL file against an isolated loopback test database.
- Run Web typecheck, focused controller contract tests, complexity and docs checks.
- Review the exact diff, close the plan, open a draft PR, admit the stable head to CI.
- Merge after required checks, verify linked issue closures, and retire the worktree.

## Progress

- Confirmed the gaps in their current owners; no runtime change is needed.
- Added the existing exact-metadata export recovery command after inspecting the installed CLI and identity guards; no browser request or tool change is required.
- Small PostgreSQL case passed in 192 ms; full three-case file passed in 4.75 s of test time.
- Web typecheck and all 47 controller contract tests passed.
- Confirmed and closed already-shipped #3215 and #2755; closed superseded #2734.
- Eleven existing ReviewGPT identity and response-minimum regression tests passed.
- Complexity guard and docs drift passed; parent review confirmed preserved stress assertions and no production changes.
- Final ReviewGPT is not required for this isolated test/docs batch under completion-workflow.md. Required exact-head CI remains the merge gate.
Status: completed
Updated: 2026-09-11
Completed: 2026-09-11
