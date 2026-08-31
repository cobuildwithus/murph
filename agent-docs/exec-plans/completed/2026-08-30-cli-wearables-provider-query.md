# Separate wearable query providers from preferences

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Let agents filter every wearable read surface by the public provider identity
  already present in vault evidence, without coupling query behavior to the
  four onboarding preference choices.
- Keep the filter predictable and safe: normalize connector aliases, reject
  the internal `junction` transport and invalid slug input, and treat a valid
  provider with no matching evidence as an ordinary empty query.

## Success criteria

- `--provider fitbit` and `--provider withings` reach the real query service and
  select matching Junction-origin evidence.
- Current public aliases such as `google_health`, `apple_health_kit`, and
  `whoop_v2` canonicalize to the same identity used by query projections.
- Blank, control-character, malformed, overlong, and internal `junction`
  values fail before a vault query with a privacy-safe, actionable error.
- A well-formed provider slug not yet present in the vault succeeds with an
  empty result, so connector growth does not require a copied CLI allowlist.
- Focused contract, query, projection, and real in-process CLI tests pass along
  with affected package typechecks and diff/privacy checks.

## Scope

- In scope:
  - Public wearable query-provider normalization owned by `health-metrics`.
  - Wearable query/projection filter normalization and wearable CLI validation.
  - Agent-facing help/error copy that points discovery to an unfiltered
    `wearables sources list` query.
  - Focused regression coverage for connector identities and aliases.
- Out of scope:
  - Onboarding wearable preference choices.
  - Device connect, route, and provider command families.
  - Adding or changing connector availability or source-priority policy.

## Constraints

- Technical constraints:
  - Keep workspace dependencies one-way; the shared provider-query contract
    must live below both CLI and query.
  - Do not add another finite connector allowlist to the CLI.
  - Preserve the existing 80-character device-origin slug grammar.
- Product/process constraints:
  - Product UX effort: Patch. This restores the existing promise that a source
    visible in wearable evidence can be used as a filter.
  - The parent lane authorized a scoped commit and draft PR after focused proof;
    it retains ownership of ReviewGPT and merge decisions.

## Risks and mitigations

1. Risk: An open provider contract could accidentally accept a transport or
   unsafe text.
   Mitigation: Centralize strict slug parsing, explicitly reject `junction`,
   bound length, and cover malformed/control/blank inputs.
2. Risk: CLI and projection aliases could produce different cache keys.
   Mitigation: Reuse the same canonicalizer in direct query collection and
   projection scope normalization, with alias tests at both boundaries.
3. Risk: A canonicalization change could alter source selection priority.
   Mitigation: Add only query-input normalization; leave provider descriptors
   and source-priority policy unchanged.

## Tasks

1. Add and test the public wearable query-provider contract.
2. Route direct query and projection filters through that contract.
3. Replace the CLI preference-enum check with contract validation and
   actionable source-discovery guidance.
4. Add focused query and real CLI regressions for Fitbit, Withings, aliases,
   valid-empty behavior, and rejected input.
5. Run focused tests, affected package typechecks/builds, diff, and privacy
   checks; commit the candidate and open the requested draft PR.

## Decisions

- Query providers are an open public-source slug contract, not a connector
  catalog. This avoids reproducing a stale provider list and lets valid future
  source identities return no matches until data exists.
- Canonical identities use hyphens. Existing underscore connector forms are
  accepted, and known descriptor aliases (notably `whoop_v2`) resolve through
  the provider catalog before generic underscore normalization.
- `junction` remains an implementation transport, never a public filter.
- Workout-stream feature filters and their source-provider projection use the
  same public normalizer. This prevents an already-normalized filter from
  silently missing an underscored public or future provider source, while
  invalid and internal source identities fail closed.
- Product UX reaches:
  - An agent filtering a known connected source gets the expected data.
  - An agent using a documented connector alias gets the canonical result.
  - An agent probing a valid source absent from this vault gets a successful
    empty result and can discover present sources without a filter.
  - An agent passing unsafe or internal input gets a recoverable local error
    without echoing the supplied value.

## Verification

- Commands to run:
  - Focused Vitest files for `health-metrics`, query provider scope/surfaces,
    and wearable CLI commands.
  - Affected package typechecks and the `health-metrics` public-package build.
  - Repository diff checks plus the privacy guard required for this patch.
- Expected outcomes:
  - All checks pass; real CLI fixtures prove Fitbit/Withings filtering and
    invalid inputs never invoke the query service.
- Results:
  - Five focused Vitest files passed (106 tests before the workout follow-up),
    then the two affected query suites passed with the workout regression
    included (38 tests).
  - `health-metrics`, `query`, and CLI typechecks passed, as did the public
    `health-metrics` build and scenario-integrity check.
  - Repository guard phases reached by the canonical diff check passed before
    its broad reverse-dependent typechecks were intentionally stopped for the
    superseded candidate. The final workout follow-up was re-proven with its
    affected query suites and query typecheck.
Completed: 2026-08-30
