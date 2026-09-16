# Complete Junction validation recovery and PR review

Status: active
Created: 2026-09-16
Updated: 2026-09-16

## Goal

Publish and review the SpO2/ECG diagnostics and recovery change while preserving every currently collected resource, complete-day authority, and ECG source binding.

## Success criteria

- Add evidence-backed fixes without filtering samples, guessing units, shrinking collection windows, or accepting incomplete results.
- Preserve retained validation retries through ordinary restart and expired-lease reclaim, with disconnect authority intact.
- Open an owned PR; obtain a validated ReviewGPT result and green required exact-head CI.

## Scope

- Existing importer, Junction client, service, SQLite queue, and hosted log owners; synthetic regressions and required PR evidence.
- No production mutation, deployment, provider payload retention, data repair, or schema migration.

## Decisions and evidence

- Junction documents blood oxygen as percentages and ECG voltage as grouped timeseries. Current normalization supports the documented SpO2 representation. The live invalid value remains unknown; changing the range or scale has no sufficient evidence.
- Existing ECG source and sample completeness requirements remain authoritative. Empty or mismatched responses remain pending rather than being certified as successful imports.
- New red tests reproduced retained retry loss at the expired-lease dedupe boundary. The lease/dead-letter/claim/dedupe paths now share one SQL predicate for persisted matching validation failures, preserving the original job and payload.
- A second regression exposed SQL NULL propagation from absent calendar metadata. Coalescing absent keys prevents ordinary resource jobs from becoming unreclaimable, nonterminal rows and preserves disconnect cleanup. This grants no credential-independent import authority.
- No new persisted state, queries, requests per attempt, or foreground work. Existing queue, hints, checkpointing, redacted errors, and finite log fields remain the owners.

## Tasks

1. Verify provider contracts and reproduce the remaining retry gaps.
2. Apply the smallest queue corrections and run focused tests/typechecks.
3. Review and commit the candidate, open a draft PR, complete its evidence, then mark Ready.
4. Run final ReviewGPT alongside CI; disposition results, close the plan, and verify the final head.

## Verification

- Existing implementation: 103 distinct focused tests and importers, device-syncd, assistant-runtime, and Web typechecks passed before this follow-up.
- Follow-up passed: all 63 SQLite store tests, nine targeted service retention/disconnect tests, two hosted cold-continuation tests, and device-syncd typecheck. The new two-case regression failed before the fix at retained dedupe ownership. Complexity guard passed; final privacy/diff review found no private evidence in artifacts.
- PR CI owns broad proof; production recovery remains unverified until deployment and normal replay of already terminal jobs.

## Sources

- https://docs.junction.com/api-reference/data/timeseries/blood-oxygen
- https://docs.junction.com/api-reference/data/timeseries/electrocardiogram-voltage
- https://docs.junction.com/wearables/providers/data-attributions
