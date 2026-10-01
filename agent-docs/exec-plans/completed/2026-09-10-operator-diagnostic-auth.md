# Preserve hosted operator authentication

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Outcome and invariant

Restore authenticated Sol execution for private operator diagnostics and the existing operator-message path. Preserve read-only diagnostic permissions, task expiry, member-bound callbacks, operator usage accounting, and ordinary member provider selection.

## Evidence and owner

Operator tasks overwrite the prepared hosted provider id with the built-in OpenAI id. A synthetic local HTTP probe with an environment-only credential confirms that the built-in provider sends unauthenticated requests while the hosted provider attaches the credential. Runtime Codex configuration owns provider registration; the existing operator execution boundaries own model selection.

## Product UX

Effort: Patch.
Outcome: An authorized private diagnostic can produce its operator-only answer.
Reaches: OpenAI, alternate member providers, local subscription and local test transports; the adjacent operator-message override has the same defect.
Proof: Provider configuration and composed operator dispatch tests, real Codex against a local synthetic HTTP endpoint, and the existing focused synthetic diagnostic journey. No production submission or message delivery.

## Implementation

1. Derive the operator OpenAI provider alias from the existing prepared provider mode and register its credential configuration when the member uses another provider.
2. Use that alias in both operator execution paths while keeping Sol and all authority checks.
3. Cover provider modes, task completion and accounting, and the real outbound authorization header without real secrets or inference.
4. Run focused checks, update the protocol owner, review the candidate, and open a PR. Run required ReviewGPT concurrently with CI on the stable pushed head.

## Failure and rollout

No schema, wire, queue, or persisted-state change. Existing authentication failures remain fail-closed. Runtime configuration and its consumers ship in one runner image; old runners remain affected until replaced. Deploy verification must use a fresh authorized private diagnostic after rollout; expired tasks are not replayed.

## Verification

- Focused runtime configuration, diagnostic dispatch, and operator notification tests: 92 passed; 7 opt-in skipped.
- Native Codex 0.153.4 with local synthetic credentials: both OpenAI and Venice member configurations authenticated and produced one Sol model request plus the expected diagnostic answer. WebSocket probes also carried the correct credential.
- Assistant Runtime and Assistant Engine typechecks, complexity guard, docs drift, and diff whitespace checks passed.
- Focused real Sol diagnostic through local subscription: passed after pre-inference local authentication failures. Confirmed provider usage, expected synthetic evidence, no workspace MCP startup, and unchanged canonical/runtime/session evidence. The journey now explicitly requires provider usage and prints its synthetic answer for review.
- Parent candidate review: checked registration, both consumers, member-provider preservation, authority/accounting assertions, unchanged foreground awaits, and privacy. No broader refactor required; complexity debt is unchanged.

## Handoff

Implementation and focused verification complete. Required exact-head CI and ReviewGPT remain PR completion gates; their results belong in PR evidence. Production rollout and a fresh authorized private diagnostic remain separate actions. No production diagnostic was submitted and no member message was sent.
Completed: 2026-09-10
