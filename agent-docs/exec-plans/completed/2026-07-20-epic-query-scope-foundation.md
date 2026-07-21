# Epic Query-Scope Retrieval Foundation

Status: completed
Created: 2026-07-20
Updated: 2026-07-20

## Outcome

Prepare the existing one-shot Epic Clinical Records pipeline to represent more
than one query for the same FHIR resource type and to retrieve large histories
as deterministic bounded slices. The current Patient, laboratory Observation,
and DiagnosticReport beta must behave exactly as it does today.

This is PR 1 of the clinical-history expansion. It changes acquisition identity
and compatible runtime/vault contracts only. It does not authorize or import a
new clinical family.

## Protected invariants

- `apps/web` remains the sole Epic policy, credential, patient-context, and
  provider-egress owner.
- Raw FHIR remains encrypted vault evidence; PostgreSQL stores only bounded
  operational configuration and counts.
- A query scope or time slice is acquisition identity, never canonical clinical
  identity. Canonical resource convergence remains based on the FHIR source and
  resource identity.
- Provider pages stay finite, exact-origin/path-bound, generation-fenced, and
  page-idempotent.
- The existing beta request URLs, scopes, limits, and one-shot lifecycle do not
  change in this PR.
- No second queue, scheduler, clinical database, generic FHIR model, or parallel
  lifecycle owner is introduced.

## Proven gap

The current contract permits one retrieval scope per `resourceType`, stores raw
pages beneath only that type, sends only `resourceType` on page fetches, and
checkpoints a current resource index. Consequently laboratory, vital-sign, and
social-history Observation queries cannot coexist, nor can deterministic time
slices of one query be represented independently.

## Design

1. Add stable adapter-owned `queryScopeId` and deterministic `sliceId` to the
   shared retrieval-slice contract. Uniqueness is by query/slice identity, not
   resource type.
2. Add a versioned retrieval plan that freezes the exact query slices on a Web
   retrieval run. Existing rows without the plan remain readable through the
   current beta resource-type policy.
3. Add query-aware hosted run/page contracts and a v2 operational checkpoint.
   Readers accept the current format; writers use the new shape only when the
   Web descriptor explicitly selects it.
4. Add a v3 raw manifest whose page evidence and completion declarations are
   keyed by query/slice identity. Keep existing v2 manifests importable.
5. Keep Web's production runtime descriptor and page request on the current
   format in this PR. This is a deliberate readers-before-writers deployment
   seam; PR 2 may flip the wire after the compatible runtime has deployed.

## Scope

- `packages/clinical-records`: query/slice identifiers, v3 raw manifest, and
  compatibility parsing.
- `packages/hosted-execution`: versioned query-aware run and fetch contracts.
- `packages/vault-usecases`: compatible checkpoint/import composition.
- `packages/assistant-runtime`: execute either current resource-family work or
  explicit query slices without changing beta behavior.
- `apps/cloudflare`: transport the strict versioned contracts unchanged.
- `apps/web`: explicit Epic beta query-scope policy plus additive frozen-plan
  storage; do not emit the new wire format yet.
- Focused tests and the durable Clinical Records architecture, security,
  reliability, product, and verification docs affected by the contract.

## Out of scope

- New Epic SMART scopes, new resource families, and canonical mapping changes.
- Retry, reconnect, refresh tokens, recurring sync, and raw-evidence retention.
- Per-query member UI, clinical registry provenance, and new vault event kinds.
- Claims, Coverage, or payer data.

## Verification

- Focused contract tests for duplicate resource types with distinct query/slice
  identities, invalid/overlapping identity, and bounded-window ordering.
- Legacy v2 raw manifests and v1 checkpoints remain readable.
- Query-aware v3 manifests and v2 checkpoints survive replay and preemption.
- Current beta read-run and page request bodies remain byte-shape compatible.
- `pnpm test:diff` across every touched owner plus
  `pnpm test:scenario-integrity`.
- Additive Prisma migration inspection and focused hosted-web migration/control
  plane tests.
- Required `coverage-write`, parent final review, exact-head ReviewGPT, PR CI,
  and clean merge-tree proof.

## Deployment compatibility

The additive Web migration and new readers may deploy in any order because Web
continues emitting the current wire format. Deploy the compatible runner and
Cloudflare surfaces before PR 2 enables query-aware descriptors. Rollback of
this PR preserves the existing beta because no new descriptor has been emitted.

## Completion

- Close this plan with `scripts/finish-task` and a scoped commit.
- Push the task branch and open a PR with the required intent and change-shape
  contract.
- Run ReviewGPT concurrently with CI until the exact current head returns PASS
  with zero accepted findings.
Completed: 2026-07-20
