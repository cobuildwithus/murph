# Phase B PR 4 — Durable clinical change receipts

Status: completed
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

## Decisions

Core writes one append-only shard per run under `ledger/clinical-change-receipts/`. The canonical append planner supplies only rows that pass physical deduplication. The receipt classifies those rows against their prior canonical record. The run cursor is a byte offset into the shard. Enrichment hashes a manifest-attested attachment locator or structured resource locator and the frozen proposals.

Roll out the reader commit before the import writer. Older runners retain the shard in the encrypted snapshot. Imports completed by older code have no change proof. Review and merge belong to the parent session.

## Verification

- Hydrated the fresh checkout and built workspace declarations, Health Commons artifacts and the Prisma client.
- The six focused Core, vault-usecases and hosted clinical test files passed all 201 tests. They include a strict replay digest conflict, legacy facet skip counts, attachment/resource collisions, revision semantics and recovery of a prepared enrichment page.
- The encrypted cold-restore test passed. It restored to a separate vault root and retrieved the original nonempty receipt through an empty retry.
- Core, vault-usecases, assistant-runtime and Cloudflare typechecks passed. The complexity diff passed with no added over-threshold debt. Documentation drift and gardening checks passed.
- Full Core suite: 1,173 passed and one skipped. Full vault-usecases suite: 542 passed.
- Mixed-version proof used Core from the branch base to validate the new vault, replay a receipt-backed fact, and import another fact. The new reader returned just the original receipt. Reading a legacy-only vault returned no receipts.
Completed: 2026-11-25
