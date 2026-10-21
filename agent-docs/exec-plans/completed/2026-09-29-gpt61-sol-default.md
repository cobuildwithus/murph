# GPT-6.1 Sol defaults and scheduled model upgrades

## Outcome and ownership

Use GPT-6.1 Sol for managed OpenAI defaults and every saved or inherited GPT-6 Sol automation target at execution. Reuse hosted-execution model contracts, the provider-aware automation replacement map, Web pricing, and the existing native catalog builder. Canonical reminder schedules and authored pins remain intact; no database scan or mutation is needed.

## Product UX

- Outcome: New default conversations and contextual reminders use GPT-6.1 Sol.
- Reaches: Personal/group defaults, new recipes, existing OpenAI reminders, explicit reasoning, provider transitions, and Flex retries. Existing custom-provider model IDs remain literal.
- Proof: Model-selection, composed reminder routing, catalog, billing, and focused real-Codex reminder tests; relevant typechecks.

## Implementation and rollout

- Add the new model while retaining GPT-6 Sol for historical billing and saved conversation preferences.
- Update the reviewed automation map directly from all prior Sol/Terra pins to GPT-6.1 Sol.
- Upgrade the pinned Codex CLI to 0.159.1, which includes GPT-6.1 Sol natively; keep the existing 272K hosted context cap and supported effort bounds.
- Add published standard/Flex/priority rates, including 5% cached-input pricing and long-context handling.
- Deployment requires a compatibility stage: Web allowance/model readers and runner catalogs must accept GPT-6.1 Sol while producers still use GPT-6 Sol. Then activate the new Web defaults and scheduled replacement map together. Deploying either full app ahead of incompatible consumers is unsafe; the final commit alone is not a staged rollout artifact. Existing warm processes require replacement.
- Build the native base and app image together. Keep the full prior runner artifact; after new preferences are saved, a rollback must retain readers/catalogs for GPT-6.1 Sol. No production deployment, state mutation, or convergence verification is included in this task.

## Verification

Completed local implementation and parent diff review. Migration UX: Ready for the tested boundary; deployment remains separate.

- `pnpm build:test-runtime` passed. Relevant hosted-execution, assistant-engine, setup-cli, hosted-local-harness, Web, and Cloudflare typechecks passed; assistant-engine was repeated after the final live-test extension.
- Focused Vitest coverage passed for model preferences/settings, pricing (standard/Flex/priority and long context), composed automation continuity/fresh routing, managed recipes/follow-ups/onboarding, setup defaults, native catalogs/egress, and live-helper selection. Final routing run: 54 tests; final preference run: 59 tests; pricing: 144 tests.
- `pnpm --dir apps/cloudflare verify:codex-upstream-source` passed for Codex 0.159.1 and its pinned source tree. The native voice patch's runtime source changes are identical; only the upstream README context and compressed generated schema were rebased. Upstream `cargo test -p codex-app-server-protocol --lib precomputed_exports` passed 4 tests, and `cargo test -p codex-api --lib public_live` passed 6 tests.
- `pnpm test:assistant:live -- --test 'runs a saved gpt-6-sol reminder on the current OpenAI model without rewriting it' --model gpt-6.1-sol` passed with local subscription authentication. It used one real provider request, resolved the saved pin to GPT-6.1 Sol, returned the requested reminder, performed no mutation, and proved the saved canonical record unchanged. Reply review: Ready. Production delivery was not exercised.
- The broader `real model canonical reminder create fire and cancel` journey is Hold: its fixture omits the hosted automation port required by current reminder creation. Recorded in the task-owned Frog entry. The migration proof above uses the existing saved-reminder journey and does not weaken the failing test.
- The full hosted-local stack suite had one failure in the existing cloudflared configuration-path expectation (87 passed); the focused catalog/provider cases passed. No tunnel behavior changed.
- `pnpm complexity:diff` passed without added complexity debt; existing hotspots are unchanged. The provider-aware inherited replacement reuses the current route owner and adds no network/database work. `pnpm docs:drift`, diff whitespace, and authored-identifier checks passed.
- Full Linux runner image/continuity proof, staged production rollout, and PR-bound CI/final ReviewGPT are not performed in this local change task.
Status: completed
Updated: 2026-09-29
Completed: 2026-09-29
