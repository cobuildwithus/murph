# Murph Age Canonical Input Report Proof

## Goal

Prove that saved canonical vault inputs can feed the `murph age report` command through the query projection, without hand-inserting metric rows.

## Scope

- Add a focused CLI regression that writes representative blood-test and body/vitals measurements through existing vault commands.
- Rebuild the query projection and run `age report --mode research` against the existing public report boundary.
- Keep outputs minimized: no raw values, point IDs, participant identifiers, or product claims.

## Out of Scope

- New Murph Age model science, product promotion, recommendations, or ReviewGPT gating.
- New wearable importer implementation.
- Changes to source-rights policy or research dataset ingestion.

## Verification

- Focused CLI test for the new report path.
- CLI package typecheck/test selection as appropriate.
- Required repo checks/audits per workflow.

## Status

Active.
Status: completed
Updated: 2026-05-11
Completed: 2026-05-11
