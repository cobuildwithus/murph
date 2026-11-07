# First-day priority processing at standard member pricing

Status: completed
Created: 2026-09-23

## Outcome and architecture

Managed OpenAI conversation replies receive Priority processing for the first
24 elapsed hours after the personal HostedMember.createdAt timestamp. Normal
member allowance pricing stays unchanged; Murph absorbs the premium, including
the existing instant first reply. Existing Flex requests, custom inference,
Venice, group-container identities, and established members retain their policy.

The current gap is deterministic: the turn selector supports only Flex or null,
and instant-first-turn usage explicitly selects the Priority allowance rate.
Reuse the existing member configuration read, workspace response, trusted runtime
environment, native Codex serviceTier override, and standard usage accounting.
Derive an expiry; add no persisted state, timer, extra query, or provider retry.
Codex local source confirms fast maps to provider priority and accepts priority.

## Work

1. Add an optional expiry to the existing workspace configuration response and
   runtime environment; evaluate it on each conversation provider attempt.
2. Preserve Flex deadlines and pricing, standard-price the onboarding boost,
   and accept native fast/priority metadata for child usage accounting.
3. Prove timestamp boundaries, provider exclusions, warm expiry, native request
   serialization, and equivalent standard member allowance costs.
4. Update the durable owner and changelog; run focused tests, typechecks,
   complexity review, privacy review, and commit the scoped change.

## Product UX and deployment

Patch: new personal members get faster managed replies without a setting or
extra allowance cost. Existing members, background Flex jobs, and custom-provider
members keep their current behavior. Tests will replay each distinction.
No model, prompt, tool, consent, channel, or reply-content change is intended.
Optional response field supports both old and new readers: old runtimes ignore
it and new runtimes without it retain standard processing. Rollout benefit
requires both Web and runner updates; no migration or irreversible state.

## Verification

All local implementation steps completed; Product UX review: Ready.

- Assistant Engine: 144 tests passed across final-coverage, runtime-config, and
  runtime-events. Includes exact 24-hour boundaries, future/malformed/missing
  expiry, local/custom/Venice exclusions, unsupported catalog, preserved Flex,
  scheduled Standard retry, native Priority-to-null reset and late child usage.
- Web: 213 tests passed across assistant-model-preference, Linq instant first
  turn, and hosted runtime internal routes. Includes signup derivation, all
  personal plan tiers and Family seats, group exclusion, and the actual allowance
  pricer proving positive Standard cost versus the higher Priority rate.
- Hosted Execution: 45 runtime-control tests passed, including optional-field
  backward compatibility and standard pricing for fast/priority.
- Assistant Runtime: three focused tests passed for expiry projection through
  the real workspace entrypoint and rejection of producer/member env overrides.
- Changelog generation and ten rendered archive tests passed.
- Relevant package typechecks (Hosted Execution, Assistant Engine, Assistant
  Runtime), Web typecheck, docs drift, and diff whitespace checks passed.
- Complexity guard passed; existing hotspots unchanged or reduced. The signup
  projection remains in the configuration-read owner, and eligibility stays in
  the existing turn-tier selector. No extra abstraction or dependency.
- Parent reviewed the full scoped diff, privacy, native Codex tier mapping,
  deployed GPT-6 catalog Priority support, no added network/database calls,
  expiry behavior, provider exclusions and unchanged billing limits.

No prompt, tools, model choice, or reply-content contract changed, so deterministic
provider-request and accounting evidence is the applicable proof. No paid live
provider call or production mutation was performed. Actual response latency has
not been benchmarked. Local implementation is complete; PR/CI, external final
ReviewGPT and deployment remain later delivery gates when that scope is requested.

Updated: 2026-09-23
Completed: 2026-09-23
