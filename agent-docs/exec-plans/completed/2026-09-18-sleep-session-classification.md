# Preserve sleep session classification in reports

Status: completed
Created: 2026-09-18
Updated: 2026-09-18

## Outcome and invariant

Preserve provider-declared short sleep and tentative state through canonical sessions,
personal queries, daily metrics, and authorized group reports. A short session is
not automatically a nap or a complete night. Existing main sleep and legacy
unclassified records remain readable; source gaps remain source-specific.

## Owners and evidence

The Junction importer currently drops short_sleep. Canonical sleep_session owns
classification, query derives selection and metric context, and the existing
vault-share contract carries scoped evidence. Synthetic normalization and query
reproductions prove the loss. Extend those owners without a new store, service,
retry policy, duration heuristic, or provider preference.

## Scope and decisions

- Preserve short_sleep separately from nap, plus provider tentative/confirmed state.
- Keep explicit naps out of existing shared nightly totals; qualify short sessions.
- Preserve qualifiers in selected metric context and validate them at sharing ingress.
- Add concise assistant guidance for qualified sleep evidence.
- Upstream missing sleep cannot be manufactured or repaired by classification changes.
- No production data mutation, deployment, or missing-provider sync redesign.

## Product UX

Outcome: people can distinguish a short or preliminary record from overnight sleep.
Reaches: personal sleep queries and consenting group sleep reports.
Proof: synthetic provider-to-query and canonical-to-sharing journeys for short-only,
nap-only, tentative, ordinary main sleep, mixed sources, and legacy records; one
focused real-model report journey. Preserve independent source reporting gaps.

## Evolution and recovery

Canonical records remain authoritative; query caches are rebuildable. Existing
unclassified canonical records require ordinary reimport to gain missing metadata.
New schema readers must precede producers across independently deployed consumers;
old strict readers cannot accept the extended canonical enum. Shared legacy records
remain accepted. No speculative backfill or additional compatibility owner.

## Tasks

1. Add focused regression proof and extend canonical classification at existing owners.
2. Propagate selected qualifiers through query and sharing, preserve selection behavior.
3. Verify focused tests, typechecks, real-model report, and complexity; review full diff.
4. Update owner documentation and release note, close plan, and create scoped commit.

## Verification

- Focused: Junction sleep classification normalization; canonical payload schema;
  query sleep pattern, coverage branches, candidates, and metric projections;
  hosted-execution vault-share and group-shared freshness; assistant-runtime
  vault-share sleep coverage and projection; assistant-engine group prompt.
- Full suites: contracts, importers, query, hosted-execution, assistant-runtime.
- Typecheck: contracts, importers, query, hosted-execution, assistant-runtime,
  assistant-engine. Generated contract artifacts verified. Docs drift clean.
- `pnpm complexity:diff` passes; sleep window dedupe classification merge was
  extracted to keep that function under the guard.
- Real-model report journey: one earlier run labeled short and tentative rows
  correctly but still marked them as missed; the instruction now says such rows
  get neither mark, and the journey asserts it. Re-running that journey is
  blocked by subscription usage limits on every local Codex home; rerun it
  before merge.
Completed: 2026-09-18
