# Carry phone upload identifiers into canonical meals

Status: completed
Created: 2026-11-01
Updated: 2026-11-01

## Goal and scope

Preserve the existing Idempotency-Key through upload validation, encrypted capture wake, canonical meal import and Browser Vault list/detail responses. No image copy, new table, inferred association, backfill, member messages or production data reads.

## Decisions and rollout

- Reader prerequisite #4435 merged as 21f806eb67f01b1c346846b9eea2ab31f4f6e4e3. Its ReviewGPT round passed and exact-head CI passed 36 checks with two expected skips.
- Do not merge this writer until the reader Web and runtime are deployed and native distribution has converged. Retain the reader as the rollback floor.
- Manual uploadId is the existing lowercase UUID header; automatic uploadId is the existing capture ID header. Preserve server capture IDs and dedupe semantics unchanged.
- iOS sends both today. Manual saved thumbnails already use SHA256("manual:" + lowercase UUID); automatic thumbnails use the capture ID. No upload-request change. Plain tile for absent local data.

## Tasks

1. Add metadata to existing validation, ingestion and canonical import; keep old imports absent on retry.
2. Prove synthetic uploads through runtime import, enrichment, projection and list/detail; prove typed/texted null and removal still works.
3. Update the iOS contract, verify focused tests/typechecks/log and complexity guards, review candidate, ReviewGPT concurrently with exact-head CI.
4. After reader convergence, merge and verify Web plus runtime deployment from main.

## Product UX

Manual and automatic local thumbnails join server meals after a saved projection. Missing IDs or local thumbnails show plain tiles. Older history stays null. Server counts disappear only through canonical deletion; optimistic 202 handling remains unchanged.

## Evidence

Focused proof passed: 82 Web cases across upload validation/ingestion and Meals routes, 15 runtime cases across real import/enrichment/projection/retry and typed removal. Core, assistant-runtime and Web typechecks passed; raw-payload log guard, complexity guard, docs drift/gardening and diff whitespace checks passed. The linked canonical record is the exact record Murph enriches; no timestamp join. Existing Frog entry `20261020230541-built-contract-artifacts` covers the source-entrypoint issue encountered while attempting a monolithic Web/runtime test; no new entry or dependency configuration was needed. Proof stays at existing package boundaries with overlapping real owners.

Parent review: Ready for writer review, with reader deploy convergence still a hard merge gate. Changelog not applicable: the checked iOS feed still uses on-device history and does not consume Meals API records, so this is server groundwork for its pending API integration. No new provider prompts, tool definitions, logging, network calls or persistence owner. ReviewGPT, exact-head CI and deployed reader convergence remain shipping gates.
Completed: 2026-11-01
