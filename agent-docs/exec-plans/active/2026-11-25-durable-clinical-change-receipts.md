# Phase B PR 4 — Durable clinical change receipts

Status: active
Created: 2026-11-25
Updated: 2026-11-25

## Goal

Give each completed clinical retrieval batch and prepared enrichment page private, durable evidence of the canonical revisions it published. PR 4 runs alongside PR 1 (Epic authentication) and precedes PR 5 (daily notification integration).

## Success criteria

Replay returns the original changes after canonical publication, including explicit empty results. Existing wire counters retain their meanings. A run can be enumerated in bounded pages inside its vault.

## Scope and constraints

Core owns the receipt format and commits it with its existing write batch. Retrieval and enrichment bind immutable inputs before consulting mutable canonical state. Keep Web, messaging, credentials and physical write recovery outside this change. Use synthetic fixtures.

## Risks and mitigations

Use attested source identity for enrichment pages whose numbering restarts. Classify actual appends at reconciliation, excluding cleanup, marker maintenance and the retired half of a replacement. Store receipts in the canonical ledger, independently of disposable job state. Exercise reader compatibility and cold readback.

## Tasks

1. Add the private reader, stable run reference and versioned receipt at Core.
2. Stage meaningful changes or an explicit empty result with the canonical commit.
3. Bind retrieval and enrichment calls and preserve retry counts.
4. Exercise crash, collision, conflict and restore cases. Update the intake contract and prepare a draft for parent review.

## Verification

Run both owner suites and typechecks, hosted retrieval integration checks, workspace hydration and the complexity diff. Record outcomes at closeout.
