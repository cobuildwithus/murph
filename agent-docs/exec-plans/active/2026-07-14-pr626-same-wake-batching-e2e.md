# PR 626 Same-Wake Batching E2E

## Goal

Prove that rapid replyable Linq messages exposed by one hosted wake are processed as one ordered assistant turn, including the empty-selection pre-scan race, and close modern and legacy terminal-evidence recovery gaps exposed by compound input groups.

## Constraints

- Preserve the existing same-conversation, same-reply-anchor, exact-successor batching boundary.
- Allow the required pre-scan refresh to acquire the same bounded batch only
  while selection is empty; freeze it as soon as it becomes nonempty.
- Leave causal gaps, legacy sequences, overflow, and post-freeze arrivals pending.
- Use the production hosted-local runtime path without test-only batching controls.
- Keep the new scenario in an existing CI matrix leg.
- Reset the runner static-closure ratchet only to the exact measured build
  after the intentional boot-path growth; keep its tolerance and total ceiling.
- Preserve unrelated working-tree and coordination-ledger changes.

## Plan

1. Compare current selection semantics with the pre-regression implementation and introducing commit.
2. Trace foreground, background, empty-selection refresh, accepted-input, and terminal-evidence recovery paths.
3. Add a repeated same-wake hosted-local E2E with exact provider-request and reply assertions.
4. Wire the scenario into the harness registry, aggregate suite, CI, and verification docs.
5. Run focused TypeScript 7 checks, unit suites, the direct hosted E2E, diff-aware verification, and final audits.
6. Push the exact PR head and complete the required ReviewGPT and CI gates.

## Verification

- `pnpm --dir packages/assistant-runtime build`
- Focused runner-bundle budget tests and hosted-local runner assembly
- Focused assistant-runtime and assistant-engine Vitest suites
- Serialized legacy evidence repair plus restart-idempotence proof
- Empty-selection refresh batching plus post-selection freeze proof
- Hosted-local harness typecheck and tests
- `pnpm exec tsc -p apps/cloudflare/tsconfig.json --noEmit --pretty false`
- `pnpm hosted-local e2e linq-same-wake-batching`
- `pnpm test:diff ...`
- `pnpm docs:drift`
- `git diff --check`

## State

Implementation and focused verification are complete. The repeated hosted-local
Linq E2E passed on the TypeScript 7 base, as did the full pre-audit assistant
automation suite plus the persisted modern and serialized legacy recovery cases, empty-selection
refresh batching, hosted maintenance capacity/classification, package
typechecks, harness tests, runner-bundle assembly/budget tests, docs drift, and
diff checks. The branch still needs rebasing onto the newest `main`, resolving
the docs-index conflict, then final exact-head focused/E2E verification,
ReviewGPT, and CI.
