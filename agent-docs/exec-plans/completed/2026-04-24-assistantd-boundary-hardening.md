# Assistantd vault-boundary and gateway error hardening

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Fix reported assistantd control-plane boundary issues so wrong-vault requests return typed client errors, daemon-triggered canonical automation requires explicit capability, gateway send domain failures preserve useful status/codes, gateway route forwarding has one shared vault-strip/assert path, and daemon client base URLs are origin-only.

## Success criteria

- Non-gateway assistantd routes return a non-500 typed vault mismatch response for mismatched `vault` values.
- `/automation/run-once` defaults away from canonical vault-service authority unless the caller explicitly opts into canonical writes.
- Gateway send missing-session and unsupported-operation failures map to non-500 statuses with preserved domain codes.
- README route inventory lists cron target routes and documents automation canonical-write capability semantics.
- Client base URL normalization rejects paths, queries, fragments, and credentials.
- Focused tests, package coverage/typecheck, required audits, and direct scenario checks are recorded before handoff.

## Scope

- In scope: `packages/assistantd/**`, directly coupled assistant-engine automation no-canonical-write flag plumbing, directly coupled gateway error mapping imports/constants if needed, active plan/ledger files.
- Out of scope: hosted gateway/runtime behavior, canonical core write ownership changes, broad assistant-engine automation redesign, unrelated dirty worktree cleanup.

## Constraints

- Technical constraints: keep assistantd loopback/bearer/vault-bound semantics; preserve gateway service input contracts; avoid dependency changes; do not weaken production invariants to satisfy tests.
- Product/process constraints: high-risk trust-boundary task, so follow security/reliability docs, keep the coordination ledger current, run required completion audits, and avoid committing unrelated dirty files.

## Risks and mitigations

1. Risk: tightening automation capability breaks existing daemon clients that expected canonical-write automation by default.
   Mitigation: make the capability explicit in protocol/client types and update tests/docs so callers can intentionally opt in.
2. Risk: gateway forwarding helper changes request shapes.
   Mitigation: strip only the optional daemon `vault` field and keep existing gateway schemas/results unchanged.

## Tasks

1. Inspect current assistantd service/http/protocol/client/tests and gateway error definitions.
2. Implement typed vault mismatch handling and HTTP status mapping.
3. Implement explicit `/automation/run-once` canonical-write capability, including engine support for explicit preview/no-canonical-write automation, and update service tests.
4. Refactor gateway forwarding/parsing helper and map gateway send domain errors.
5. Tighten client base URL normalization.
6. Update README and focused tests for reported routes/errors/client inputs.
7. Run verification, required audits, close plan, and commit scoped changes if safe.

## Decisions

- Treat canonical application by daemon-triggered automation as intended but privilege-gated: default requests omit `vaultServices`; callers must pass `allowCanonicalWrites: true` to opt in.
- Keep default daemon automation preview/runtime-only across scanner, routing, auto-reply recovery, and cron processing so canonical write-capable branches only run when the explicit capability is present.

## Verification

- Passed: `pnpm --dir packages/assistantd exec vitest run test/http.test.ts test/client.test.ts test/service-coverage.test.ts --config vitest.config.ts --no-coverage`.
- Passed: `pnpm --dir packages/assistant-engine exec vitest run test/assistant-automation-runtime.test.ts --config vitest.config.ts --no-coverage`.
- Passed: `pnpm --dir packages/assistantd typecheck`.
- Passed: `pnpm --dir packages/assistant-engine typecheck`.
- Passed: `pnpm --dir packages/assistantd test:coverage`.
- Passed: `pnpm --dir packages/assistant-engine test:coverage`.
- Passed: `git diff --check -- <task paths>`.
- Earlier unrelated `packages/assistant-runtime` typecheck blockers in the dirty tree cleared before handoff.
- Required coverage-write audit passed and added one client proof for rejecting loopback `https://` daemon URLs.
- Required final review audit found preview cursor advancement and raw vault path disclosure gaps; both were fixed with targeted tests.
- Passed after final-review fixes: `pnpm typecheck`.
- Blocked by unrelated dirty-tree failure after final-review fixes: `bash scripts/workspace-verify.sh test:diff <task paths>` fails in `packages/cli/test/vault-cli-wiring.test.ts` because the active CLI schema-index lane leaves a mocked CLI without `serve`.
Completed: 2026-04-24
