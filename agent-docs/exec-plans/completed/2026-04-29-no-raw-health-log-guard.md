# Add static guard for raw health data logging

Status: completed
Created: 2026-04-29
Updated: 2026-04-29

## Goal

- Add a static CI-enforced guard that blocks raw logging of high-risk health/model/vault payload variables unless the logged expression is explicitly passed through a redaction or summarization helper.

## Success criteria

- A repo-owned static check rejects direct `console.*`, `logger.*`, or plain `log(...)` calls containing raw variables named `prompt`, `messages`, `input`, `output`, `response`, `body`, `transcript`, `vault`, `finalRequest`, `fileText`, or `labReport`.
- The guard allows those names only when the logged expression flows through an approved redaction/sanitization/summarization helper or a safe count/length/boolean expression.
- The guard is wired into existing CI/static verification.
- Focused tests prove block and allow cases.

## Scope

- In scope: repo tooling scripts, tests, verification wiring, durable security/verification docs for the logging rule, and direct current logging violations exposed by the guard.
- Out of scope: rewriting existing logging sites unless the new guard exposes a direct current violation in touched verification scope.

## Constraints

- Technical constraints: avoid dependency changes; keep the scanner AST-based or otherwise precise enough to avoid blocking ordinary domain fields such as `summary`.
- Product/process constraints: preserve unrelated dirty work and active ledger rows; do not print secrets or raw health payload examples.

## Risks and mitigations

1. Risk: A broad string scanner creates noisy false positives in tests, docs, or structured non-log code.
   Mitigation: Limit enforcement to log-call arguments and add focused fixture coverage for safe and unsafe patterns.
2. Risk: The allowlist becomes an escape hatch for raw payload logging.
   Mitigation: Allow only explicit safe helper names or metadata-only accessors such as counts and booleans.

## Tasks

1. Inspect existing repo verification guard patterns and logging/redaction helpers.
2. Implement the static guard and fixture tests.
3. Wire the guard into typecheck/static verification.
4. Update durable docs for the no raw health/log payload invariant.
5. Fix any current raw-log call site exposed by the strengthened rule.
6. Run focused verification and required completion reviews.

## Decisions

- Prefer a repo-local static guard over a runtime wrapper so CI blocks newly introduced raw logging across packages and apps.
- Current hosted-runner debug payload logging should use the existing hosted-runtime diagnostic redaction helper instead of relying on debug-only conventions.

## Verification

- Commands to run: focused guard tests, direct guard command, `pnpm typecheck`, and the highest-signal diff-aware verification available for the touched paths.
- Expected outcomes: unsafe raw payload logging examples fail; safe redacted/summarized/count-only examples pass; existing verification wiring invokes the guard.
- Results:
  - `pnpm logs:guard` passed.
  - `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/check-raw-health-log-payloads.test.ts` passed.
  - `pnpm exec tsc -p tsconfig.tools.json --pretty false` passed.
  - `pnpm --dir apps/cloudflare typecheck` passed.
  - `pnpm --dir apps/cloudflare test -- --runInBand test/node-runner-child.test.ts` passed the app Node suite.
  - `pnpm typecheck` proved the new guard preflight, then failed later on unrelated hosted-web experiment CTA type work: `apps/web/src/components/experiments/experiment-detail/start-experiment-button.tsx` passes `initialLinkedAccounts`, which is not in `ExperimentStartContactOptionsInput`.
  - `bash scripts/workspace-verify.sh test:diff ...` proved the new guard and repo tools typecheck, then failed in unrelated repo-tooling research packaging coverage: `scripts/research-init.test.ts` expected a Health Commons protocol entry absent from the ZIP fixture.
Completed: 2026-04-29
