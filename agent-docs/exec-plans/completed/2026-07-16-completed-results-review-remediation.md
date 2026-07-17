# Completed results ReviewGPT remediation

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Correct PR 759 so completed Results render the canonical saved outcome and supported early-stop runs stay partial, bounded to their actual end date.

## Success criteria

- The encrypted browser-vault replica includes only outcome records reached through a safe, schema-valid, run-bound `outcomeRef`, and its source hash covers those referenced bytes.
- A completed run renders the persisted headline, plain-language conclusion, caveats, confidence, confounders, windows, metric results, and protocol references without recomputing a final conclusion from expiring browser metric rows.
- A canonical `status: completed` run with `endedOn` before `runPlan.interventionEnd` projects as stopped/partial, excludes evidence after `endedOn`, never shows 100% completion, and emits no final conclusion.
- Focused production-faithful tests cover valid, missing, escaping, mismatched, schema-invalid, aged-out, and canonical stop paths; required verification, audits, CI, and ReviewGPT correction round are green.

## Scope

- In scope: browser-vault replica outcome projection and parsing, hosted replica source hashing/reader, browser experiment result selection and early-stop window clamping, Results mapping/copy, focused tests, and matching durable docs.
- Out of scope: new persisted state, a second outcome owner, changes to the canonical stop representation, multi-run history selection, public outcome sharing, and broad generic query access to reserved outcome JSON.

## Constraints

- Technical constraints: keep generic query/assistant readers excluded from `bank/experiments/outcomes/*.json`; dereference only direct canonical outcome paths at the hosted browser-replica boundary; fail closed for invalid associations without disabling unrelated browser-vault flows.
- Product/process constraints: preserve member-private encryption and exact protocol/run identity; use ReviewGPT as the sole cross-cutting gate; keep the original completed execution plan immutable.

## Risks and mitigations

1. Risk: web and hosted runtime deploy at different times.
   Mitigation: the web parser accepts replicas without the new optional outcome array as an empty legacy projection, while old web parsers ignore the new field; document the refresh window and deploy runtime before web when possible.
2. Risk: a bad outcome reference blocks unrelated private dashboard data.
   Mitigation: omit only the invalid outcome from the projection, preserve the frontmatter reference, and render an unavailable/pending saved-analysis state.
3. Risk: early-stop detection changes normal completed runs.
   Mitigation: derive it only from canonical `status === completed && endedOn < planned interventionEnd`; prove equality remains finished.

## Tasks

1. Add narrow validated outcome dereferencing and referenced-byte hashing to the hosted browser-replica build boundary.
2. Carry canonical outcomes through replica build/parse/query and use them for completed Results.
3. Derive canonical early stops, clamp all derived windows/evidence to `endedOn`, and remove synthetic stopped fixtures.
4. Add production-faithful regression coverage and update the product/runtime docs.
5. Run required audits and verification, commit/push, update the PR contract, run ReviewGPT round 2 with CI, and prove mergeability.

## Decisions

- Accept both ReviewGPT round-1 findings as production-reachable after tracing the canonical outcome writer and `stopExperiment` owner.
- Project the existing canonical outcome record into the encrypted member-bound replica; do not copy outcome fields into experiment frontmatter or recompute a second durable result.
- Keep canonical stop persistence unchanged and derive early termination at read time from existing fields.

## Verification

- Commands to run: focused query/assistant-runtime/web tests; truthful `pnpm test:diff` for touched owners; prepared web smoke and production build as selected by the diff lane; CI; ReviewGPT correction round.
- Expected outcomes: exact persisted outcome survives with raw metric rows absent and after the browser lookback; invalid references project no outcome; early stops exclude post-stop evidence and remain incomplete; all required checks pass.
Completed: 2026-07-16
