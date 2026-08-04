# Price Venice-hosted assistant usage at Venice's documented rates

Status: active
Created: 2026-08-04
Updated: 2026-08-04

## Goal

- Count Venice-hosted Luna, Terra, and Sol usage against Murph allowances at
  Venice's current documented token rates instead of OpenAI's direct rates.
- Keep the rate selection auditable by binding each canonical product model to
  the matching fixed Venice GPT-5.6 provider model at deploy and egress time.

## Success criteria

- A Venice usage record resolves a Venice-specific pricing version, source,
  provider model, and exact input/cache-read/cache-write/output rates.
- OpenAI standard and Flex accounting remain unchanged.
- A configured Venice product-model mapping that differs from the priced
  official GPT-5.6 mapping is impossible because egress derives the code-owned
  mapping directly.
- Focused Web, hosted-execution, and Cloudflare tests cover all three models,
  direct mapping derivation, and unchanged OpenAI pricing.
- Settings discloses Venice's higher cost-weighted capacity use while selected
  and after save, with production-component catalog and regression coverage.
- Activation requires exact-candidate Venice proof for all three tiers across
  direct, tool-bearing, and compact requests before Web exposure.
- Durable architecture, security/reliability, deployment, and hosted-usage docs
  state the priced mapping invariant and current official source.
- The exact pushed PR head passes required ReviewGPT and CI gates.

## Scope

- In scope:
  - Provider-aware hosted token pricing in the existing Web allowance owner.
  - Fixed Venice GPT-5.6 provider-model contracts and Cloudflare derivation.
  - A concise provider-choice capacity disclosure in Settings.
  - Focused regression tests and durable documentation.
- Out of scope:
  - Rewriting historical immutable usage rows or allowance periods.
  - Fetching provider pricing dynamically at request time.
  - Changing plan allowances, customer prices, model eligibility, or the
    provider-selection flow.

## Constraints

- Technical constraints:
  - Web remains the sole allowance-accounting owner.
  - Cloudflare remains the sole Venice model-translation and credential owner.
  - Pricing must use integer USD-micro arithmetic and per-bucket ceiling.
  - Do not add a second pricing service, runtime fetch, database table, or env
    projection into Web.
- Product/process constraints:
  - This is billing-sensitive PR-lane work with an execution plan, preliminary
    completion-specialists ReviewGPT pass, final ReviewGPT gate, and exact-head
    CI.
  - Preserve existing accepted turns and allowance crossing behavior; only the
    cost assigned to Venice usage changes.

## Risks and mitigations

1. Risk: A mutable Venice model mapping drifts from the rate table.
   Mitigation: delete the redundant operator model vars and derive the exact
   priced provider model from one shared map at egress.
2. Risk: Provider detection changes OpenAI or member-credential accounting.
   Mitigation: select Venice pricing only for the exact normalized Venice
   provider id and retain the current OpenAI standard/Flex paths otherwise.
3. Risk: Decimal provider rates round inconsistently.
   Mitigation: represent published per-million rates as integer USD micros and
   reuse the existing per-bucket ceiling arithmetic.
4. Risk: Higher prospective accounting unexpectedly rewrites prior member
   state.
   Mitigation: apply the new pricing version only to newly accounted rows; keep
   historical immutable rows and periods unchanged.
5. Risk: A member selects Venice without seeing its higher capacity drawdown.
   Mitigation: show one direct disclosure in the provider choice and in pending
   or saved Venice summaries, backed by focused UI tests and design-catalog
   proof.

## Tasks

1. [x] Add shared fixed Venice GPT-5.6 provider-model ids.
2. [x] Add Venice model rates and provider-aware pricing snapshots in Web.
3. [x] Derive the priced mappings directly in Cloudflare egress and retire the
   duplicate deploy variables.
4. [x] Add focused regression coverage for rates, provider selection, and
   mapping failures.
5. [x] Update durable owner and deployment docs.
6. [x] Disclose higher Venice capacity use in pending and saved Settings states.
7. [ ] Run focused checks, review the diff, push a candidate, and complete
   ReviewGPT plus CI.

## Decisions

- 2026-08-04: Use Venice's official pricing page as the source of truth. Current
  rates per one million tokens are Luna 1.25/0.13/1.56/7.50, Terra
  3.13/0.31/3.91/18.75, and Sol 6.25/0.63/7.81/37.50 USD for
  input/cache-read/cache-write/output.
- 2026-08-04: Do not use one global multiplier. The relative uplift differs by
  product model and Venice publishes exact decimal rates.
- 2026-08-04: Final ReviewGPT correctly identified that retaining exact-value
  model variables creates fake configuration and an avoidable request failure
  path. Retire those variables and derive `openai-gpt-56-luna`,
  `openai-gpt-56-terra`, and `openai-gpt-56-sol` directly from one shared map.
- 2026-08-04: Treat the fixed regular GPT-5.6 provider mapping as a disclosed
  provider-visible change, not merely internal accounting. The mapping is
  inseparable from exact provider pricing because Web otherwise lacks evidence
  of which mutable upstream model received the turn.
- 2026-08-04: The preliminary specialist review correctly identified that
  provider-aware accounting changes the member's effective included capacity.
  Keep the provider flow unchanged, but disclose Venice's higher rate effect in
  its choice copy and in pending or saved Venice summaries.
- 2026-08-04: Treat representative Venice runtime validation as an activation
  gate rather than inventing a prompt-specific subsystem. The exact candidate
  must prove every tier with direct, tool-bearing, and compact requests before
  Web exposure.
- 2026-08-04: Parent product-purpose revalidation after merging current `main`
  found no remaining product-experience issue. The smallest complete journey is
  still the existing provider choice and single Save, with the higher-capacity
  drawdown disclosed in the Venice option, pending summary, and saved summary.
  The live all-tier runtime matrix remains an explicit activation evidence gap,
  not a reason to add another screen or prompt subsystem.

## Verification

- Commands to run:
  - Focused Vitest slices for hosted usage allowance, hosted model contracts,
    Cloudflare Venice egress, deploy preflight, egress interception, and the
    pending/saved provider-choice disclosure.
  - Focused typechecks for `@murphai/hosted-execution`, `apps/web`, and
    `apps/cloudflare` as routed by their package scripts.
  - Required exact-head GitHub Actions and ReviewGPT gates.
- Expected outcomes:
  - Venice rows use a Venice pricing version and exact documented rates.
  - OpenAI rows retain the existing standard or Flex pricing versions.
  - No operator mapping exists that can diverge from the priced provider model.
- Completed local proof after merging current `main`:
  - Web focused Vitest: 135 tests passed.
  - Cloudflare focused Vitest: 346 tests passed.
  - Hosted-execution focused Vitest: 3 tests passed.
  - Web, Cloudflare, and hosted-execution typechecks passed.
  - Scoped Web ESLint, docs drift/gardening, frontend design-proof policy, and
    `git diff --check` passed.
  - Desktop and mobile saved-Venice and provider-dialog images were inspected
    locally and through their hosted design-proof variants at native resolution.
  - The required second-model UI review was attempted but could not run because
    that service reported explicit usage-credit exhaustion.
