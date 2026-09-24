# Use GPT-6 for managed inference defaults

Status: active
Created: 2026-09-23
Updated: 2026-09-23

## Goal

- Use GPT-6 Luna for lightweight managed replies and GPT-6 Sol for contextual
  automation work. Preserve canonical effects and explicit provider/model choices.

## Success criteria

- Production builders and recipes select current models; older OpenAI automation
  pins upgrade through the existing execution resolver. Focused tests, typechecks,
  real-model proof, review, exact-head CI, and deployment verification pass.

## Scope

- In scope: Web opening replies, managed recipes, generic automation guidance,
  verification defaults, and current operational documentation.
- Out of scope: rewriting explicit member choices, Venice/custom-provider model
  IDs, specialized audio/image models, historical records, and unreviewed future
  model discovery. The third Web opening reply is a separate follow-up, contingent
  on reply quality and reliable canonical identity persistence.

## Constraints

- Reuse the existing scheduled-target replacement map and recipe reconciliation.
  No new service, dependency, scheduler, database migration, or deploy-time scan.
- Product UX: existing/new scheduled work and direct opening replies preserve
  their effects, safety, privacy, and silence decisions. No added foreground calls.

## Risks and mitigations

1. Different model behavior: prove exact production request bodies and instructions,
   then run focused synthetic real-model journeys.
2. Provider skew: preserve supported Venice/custom targets and explicit reasoning.
   GPT-6 catalog/pricing support already ships; old/new runtimes accept these IDs.

## Tasks

1. Inventory active defaults and classify retained compatibility references.
2. Update defaults and contradictory guidance without duplicating old-pin resolution.
3. Run deterministic tests/typechecks, input-impact measurement, and live proof.
4. Complete scoped PR, applicable review, CI, authorized release, and verification.

## Decisions

- The existing resolver already maps old OpenAI Luna to GPT-6 Luna and old Sol/Terra
  to GPT-6 Sol at execution. Preserve canonical saved pins and reuse that owner.

## Verification

- Pending: Web opening request/usage tests, managed recipe reconciliation,
  generic automation selection, existing-pin/provider boundary tests, relevant
  typechecks, and production-derived live journeys.
