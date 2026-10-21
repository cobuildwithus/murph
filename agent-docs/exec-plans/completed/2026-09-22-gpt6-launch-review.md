# Finalize GPT-6 launch pricing and automation compatibility

Status: completed
Created: 2026-09-22
Updated: 2026-09-22

## Goal

Make GPT-6 Sol the hosted default, retire active Terra selections, apply published Sol/Luna pricing, and resolve PR #3649 ReviewGPT findings.

## Scope and constraints

Keep historical Terra usage pricing readable. Resolve saved Terra preferences at existing read/routing owners without a production database mutation. Keep explicit supported model choices and custom inference. Venice is disabled and its rollout is deferred. Preserve native catalog validation; do not fabricate model metadata.

## Tasks

1. Prove and fix the accepted round-one automation provider compatibility finding in the existing resolver.
2. Replace provisional pricing with official standard, cache, Flex, priority, and long-context rates.
3. Remove Terra from active choices/catalogs and resolve saved Terra preferences to Sol.
4. Verify focused owner tests and typechecks, inspect the final diff, commit, and rerun ReviewGPT on Eragon.

## Decisions

- Round-one High ORIGINAL_PR finding accepted: a saved GPT-6 automation override can reach Venice egress without a supported mapping. Suppress incompatible inherited preferences without changing providers or stored automation state.
- Published model pages confirm Sol $2/$10 and Luna $0.10/$0.50 per million input/output tokens, 10% cache reads, 1.25x cache writes, half-price Flex, and double-price priority.
- Latest stable Codex CLI remains 0.155.1.

## Verification

- Web preference/pricing/Settings: 229 pass. Shared hosted contracts: 53 pass. Assistant routing/configuration/image/personalization/scheduled authority: 72 pass.
- Cloudflare catalog, egress, smoke and identity: 56 pass; native CLI loads the composed pinned catalog with all GPT-6 entries at 272K and Terra excluded.
- Hosted-local harness: 85 pass. Hosted runtime lifecycle/collapse/scheduling: 81 pass.
- Runtime configuration and durable follow-ups: 59 pass. Final real App Server scripted-provider/tool-contract/WebSocket/idle suite: 147 pass, 20 opt-in skips. Generic scripted tests use supported legacy Sol; the dedicated GPT-6 Sol deferred-tool journey uses the exact launch catalog.
- Live Sol and Luna configuration journeys each pass with one update and truthful confirmation, preserving provider/reasoning. Earlier auth/quota/startup failures occurred before provider actions; both successful journeys reuse the same authorized subscription home.
- Phone and desktop production-component rendering passes at 390px and 1280px; screenshots inspected. Terra is absent and GPT-6 Sol is checked.
- Typechecks pass: Web, Cloudflare, assistant-engine, assistant-runtime, hosted-execution, hosted-local-harness, operator-config, CLI. Dependency policy, docs drift, complexity, and whitespace checks pass.

## Outcome

The candidate removes active Terra choices/defaults, preserves historical usage readers, supplies authentic pinned launch metadata, and fixes the accepted ReviewGPT provider-compatibility finding. Publish to existing draft PR #3649 and continue the same Eragon conversation with a full round-two snapshot. No production mutation, deployment, or merge. Exact initial-input comparison, full Linux image/hosted continuity, and required CI remain merge-admission evidence, separate from the requested code-review result.
Completed: 2026-09-22
