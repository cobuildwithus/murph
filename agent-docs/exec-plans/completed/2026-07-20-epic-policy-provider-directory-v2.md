# Epic Policy And Provider Directory V2

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Outcome

Implement the literal PR 2 from the original ReviewGPT Epic clinical-history
migration guide: replace the repeated beta resource list with one checked-in,
validated Epic acquisition policy and move the provider artifact to directory
v2, where every Epic brand references that shared policy.

The policy describes the longitudinal query scopes, operation requirements,
slice policy, bounded dependency allow-list, and Epic registration API keys,
but only the existing Patient, laboratory Observation, and DiagnosticReport
queries remain active. This PR must not request or retrieve a new clinical
family.

## Protected invariants

- `apps/web` remains the sole Epic policy, credential, patient-context, and
  provider-egress owner.
- The active SMART scopes, retrieval plan, request URLs, and one-shot beta UX
  remain unchanged.
- Provider-directory v2 stores public endpoint/catalog configuration only: no
  discovery response, access token, patient identifier, or clinical data.
- Query and slice policy describe acquisition only and never alter canonical
  FHIR resource identity.
- Dependencies are explicit, purpose-bound, finite, and same-origin; there is
  no generic reference crawler.
- A directory entry references a checked-in policy. Provider-specific support
  is never inferred from endpoint presence and requires an explicit evidence
  override.
- The v1 directory remains readable for one compatibility window.

## Proven gap

Every current directory entry duplicates the same base SMART scopes and three
resource types. The beta policy is executable code rather than a complete,
validated acquisition contract, so the disabled longitudinal query catalog,
its registration requirements, slicing rules, and reference dependencies have
no single deterministic source of truth.

## Design

1. Replace `epic-beta-policy.ts` with `epic-policy.ts`, retaining compatibility
   exports/functions for the active beta while validating a full disabled
   longitudinal policy at module load.
2. Model sorted query templates, slicing policies, dependency policies, and
   registration APIs explicitly. Query scopes reference those definitions and
   declare required SMART operations. A separate active query-id list contains
   only the three beta scopes.
3. Add provider-directory v2 with a source-bundle SHA-256, one root Epic policy,
   and entries that carry `policyId` instead of repeated scopes/resource types.
   Parse v1 by validating its beta fields and normalizing it through the shared
   policy.
4. Make the Epic Brands importer deterministic under shuffled bundle order,
   hash the exact input bytes, emit v2, validate its own output, and support
   pure fixture-based tests.
5. Regenerate the checked-in directory from Epic's official current
   User-access Brands Bundle. Keep all expanded policy scopes disabled.

## Scope

- `apps/web/src/lib/clinical-records/epic-policy.ts`
- `apps/web/src/lib/clinical-records/provider-directory.ts`
- `apps/web/src/lib/clinical-records/provider-directory-store.ts`
- `apps/web/src/lib/clinical-records/provider-directory.v2.json`
- deletion of the replaced beta-policy source and v1 generated artifact
- `apps/web/scripts/import-epic-clinical-provider-directory.ts`
- focused policy, provider-directory, generator, SMART, control-plane, and
  retrieval tests
- the Clinical Records product spec and directly affected verification docs

## Out of scope

- Activating any longitudinal query or adding SMART permissions.
- Query-aware wire cutover, new provider requests, pagination behavior, or
  operational coverage UI.
- Canonical registry provenance or new FHIR-to-vault mappings.
- Refresh tokens, recurring sync, reconnect, retry, retention, or rollout.
- CareTeam/device canonical representation, claims, Coverage, and payer data.

## Verification

- Policy validation rejects duplicate/unsorted IDs, missing registration APIs,
  unknown query/template/slice/dependency references, unsafe operations, and an
  expanded active set.
- Directory validation covers duplicate IDs, private endpoints, unknown policy
  references, unsorted policy/query/API lists, and v1/v2 compatibility.
- Generator fixtures prove exact source-byte SHA-256, byte-identical output for
  fixed source bytes, and canonical policy/provider content under shuffled
  source entry order while retaining the truthful order-sensitive source hash.
- Existing SMART scope selection, active beta retrieval plan, URL construction,
  control-plane behavior, and provider search remain unchanged.
- Run focused Web tests, Web typecheck, `pnpm test:diff`, scenario integrity,
  diff/privacy/secret checks, required `coverage-write`, parent final review,
  exact-head ReviewGPT, PR CI, and clean merge-tree proof.

## Deployment compatibility

Directory v2 is an in-process generated artifact with a compatibility parser;
the policy's expanded catalog is inert. Vercel can deploy this PR independently
of Cloudflare and hosted runtime because emitted descriptors and provider
requests remain on the existing beta contract.

## Completion

- Close this plan with `scripts/finish-task` and a scoped commit.
- Push the task branch and open a PR with the required intent and change-shape
  contract.
- Run ReviewGPT concurrently with CI until the exact current head returns PASS
  with zero accepted findings.
Completed: 2026-07-20
