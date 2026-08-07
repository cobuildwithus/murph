# Provider request and daemon wire boundaries

## Goal

Prevent structurally typed object composition from silently forwarding unsupported provider parameters or engine-internal authority fields across external and local HTTP boundaries.

## Proven risks

- Assistant daemon request parsing validates selected fields but forwards the original record into assistant-engine calls, allowing engine-only session-rebinding fields to cross the HTTP boundary.
- The shared OAuth token helper accepts an open parameter bag whose final spread can override required token-exchange fields.
- The Stripe guard rejects only recognized spread syntax and does not enforce official SDK typing for intermediate variables, adapters, or mocks.
- Equivalent conditional request spreads remain at several official provider SDK boundaries even though their current keys are valid.

## Success criteria

- Assistant daemon message and open-conversation routes accept only explicit wire fields, reject unknown top-level fields, and cannot receive engine-owned binding-rebind controls.
- Shared OAuth optional parameters cannot replace protocol-owned token fields.
- Provider request construction is mechanically guarded at registered official SDK boundaries without banning ordinary internal object composition.
- Known Stripe, Kernel, Linq, Retell, Temporal, OpenAI, and Junction request builders use explicit SDK-typed construction that the guard and TypeScript can verify.
- Relevant mocks derive their request types from official method signatures, and focused regressions prove both accepted and rejected shapes.
- Durable architecture and testing documentation describe the generalized boundary rule and its verification command.

## Implementation

1. Reconfirm every reported path against the current `origin/main` head and write focused failing regressions for daemon DTO exactness, OAuth reserved fields, and provider guard evasions.
2. Replace raw assistant-daemon request forwarding with explicit exact wire DTO projection at the parser boundary and mirror that projection in the CLI serializer.
3. Narrow shared OAuth optional token parameters to the supported contract.
4. Generalize the existing Stripe request guard into a provider-type-aware Babel guard with a small explicit SDK registry.
5. Migrate the known SDK request builders and mocks to explicit official types without changing provider behavior.
6. Run focused owner tests, typechecks, guard regressions, and direct boundary scenarios; inspect the complete diff for privacy and scope.
7. Push an exact candidate, open a PR, run the preliminary coverage ReviewGPT pass and the final sensitive ReviewGPT gate concurrently with CI, resolve accepted findings, then close this plan with the final scoped commit.

## Verification

- Assistantd HTTP tests passed with 13 cases proving unknown top-level and engine-only fields return 400 without reaching the service.
- Assistant CLI tests passed with 128 cases, including exact wire projection and local handling for engine-only input.
- Shared OAuth tests passed with 13 cases, including cross-grant dynamic attempts to replace protocol-owned fields before a provider call.
- The generalized provider guard passed with 19 regressions covering official SDK calls, typed and object-literal builders, aliases, factories, nested parameters, options, custom clients, and allowed internal spreads.
- Focused hosted web, operator, Pulse, Junction, and assistant package tests passed, together with the relevant typechecks and targeted lint checks.
- The final ReviewGPT gate passed with no findings after remediation of the preliminary specialist coverage finding and the final round-one verification gaps.
- All ordinary exact-head GitHub checks and the hermetic hosted billing proof passed. The secret-backed live Stripe job was canceled before setup on four attempts by churn in its repository-global concurrency group; no live test step failed, and the externally contended lane remains the only incomplete remote proof.

## Outcome

- Provider-bound object composition is now explicit and checked against official request types at the migrated Stripe, Kernel, Linq, Retell, Temporal, OpenAI, and Junction boundaries.
- The repository guard bans request spreads and `Object.assign` at registered provider calls while leaving internal object composition alone.
- Assistant daemon and OAuth boundaries now reject authority-bearing or protocol-owned fields that previously could pass through structural typing gaps.
- Pull request #1430 contains the implementation, regressions, documentation, and exact review evidence.
Status: completed
Updated: 2026-08-07
Completed: 2026-08-07
