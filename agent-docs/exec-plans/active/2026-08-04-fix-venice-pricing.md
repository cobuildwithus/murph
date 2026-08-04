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
  official GPT-5.6 mapping fails before provider egress.
- Focused Web, hosted-execution, and Cloudflare tests cover all three models,
  mapping rejection, and unchanged OpenAI pricing.
- Durable architecture, security/reliability, deployment, and hosted-usage docs
  state the priced mapping invariant and current official source.
- The exact pushed PR head passes required ReviewGPT and CI gates.

## Scope

- In scope:
  - Provider-aware hosted token pricing in the existing Web allowance owner.
  - Fixed Venice GPT-5.6 provider-model contracts and Cloudflare validation.
  - Focused regression tests and durable documentation.
- Out of scope:
  - Rewriting historical immutable usage rows or allowance periods.
  - Fetching provider pricing dynamically at request time.
  - Changing plan allowances, customer prices, model eligibility, or provider
    selection UX.

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
   Mitigation: keep the operator vars for deploy compatibility but require the
   exact priced provider model in deploy preflight and at egress.
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

## Tasks

1. [x] Add shared fixed Venice GPT-5.6 provider-model ids.
2. [x] Add Venice model rates and provider-aware pricing snapshots in Web.
3. [x] Enforce the priced mappings in Cloudflare preflight and egress.
4. [x] Add focused regression coverage for rates, provider selection, and
   mapping failures.
5. [x] Update durable owner and deployment docs.
6. [ ] Run focused checks, review the diff, push a candidate, and complete
   ReviewGPT plus CI.

## Decisions

- 2026-08-04: Use Venice's official pricing page as the source of truth. Current
  rates per one million tokens are Luna 1.25/0.13/1.56/7.50, Terra
  3.13/0.31/3.91/18.75, and Sol 6.25/0.63/7.81/37.50 USD for
  input/cache-read/cache-write/output.
- 2026-08-04: Do not use one global multiplier. The relative uplift differs by
  product model and Venice publishes exact decimal rates.
- 2026-08-04: Keep the existing deploy variables for compatibility, but bind
  them to `openai-gpt-56-luna`, `openai-gpt-56-terra`, and
  `openai-gpt-56-sol`. This preserves the current owner split while proving the
  Web rate table matches the actual egress model.

## Verification

- Commands to run:
  - Focused Vitest slices for hosted usage allowance, hosted model contracts,
    Cloudflare Venice egress, deploy preflight, and egress interception.
  - Focused typechecks for `@murphai/hosted-execution`, `apps/web`, and
    `apps/cloudflare` as routed by their package scripts.
  - Required exact-head GitHub Actions and ReviewGPT gates.
- Expected outcomes:
  - Venice rows use a Venice pricing version and exact documented rates.
  - OpenAI rows retain the existing standard or Flex pricing versions.
  - Any mismatched Venice mapping is rejected before provider entry.
