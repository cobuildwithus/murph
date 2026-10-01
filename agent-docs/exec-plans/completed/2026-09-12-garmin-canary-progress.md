# Diagnose stalled Garmin canary execution

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Goal

Restore useful execution evidence for the live Garmin journey so its remaining failure can be located and corrected. Canonical ingestion and complete owned cleanup remain mandatory for success.

## Evidence and design

The browser subprocess buffers output until exit; its only incremental parent observation is the canonical-data control marker. A stalled navigation or cleanup therefore supplies no intermediate execution boundary. Reproduce this with a synthetic browser whose cleanup promise remains pending.

Extend that existing stdout pipe with an exact allowlisted stage vocabulary. The parent forwards only recognized fixed messages. A separately owned 30-second host heartbeat reports numeric memory and CPU-load measurements while the live scenario runs. Neither observation reads browser content, credentials, identities, URLs, environment values, or provider data. No new state owner, network call, retry, timeout extension, dependency, or receipt format is needed.

## Tasks

1. Prove progress survives pending browser cleanup and reject arbitrary child output.
2. Add stage forwarding and a live-only host heartbeat with explicit teardown.
3. Run focused browser/harness tests, affected typechecks, privacy and complexity checks.
4. Complete scoped PR review and exact-head CI; inspect the next protected live execution and continue any evidence-backed Garmin correction.

## Verification

- The synthetic pending-cleanup regression failed without stage emission and passed with it.
- Web wearable and real headed Chromium smoke suites: 78 tests passed; the changed pending-cleanup case also passed after replacing an unsupported TypeScript library helper.
- Harness privacy and heartbeat lifecycle: 2 tests passed.
- Web, Cloudflare, and harness typechecks passed.
- Complexity guard passed: existing browser hotspots and debt unchanged; new helper maximum complexity 2. Those existing authorization/configuration branches are outside this diagnostic change.
- Logging guard, docs gardening, docs drift, and whitespace checks passed.
- Parent review: progress is observational, the parent forwards only complete allowlisted messages, and the heartbeat reads numeric OS measurements only. Browser failures, data proof, and cleanup receipts keep their existing authority.

## Remaining acceptance

Exact-head CI and final ReviewGPT gate the diagnostic PR. The subsequent protected live execution must establish where Garmin stalls; hermetic diagnostic proof does not establish successful connection or canonical ingestion. Continue the broader Garmin repair from that execution evidence.
Completed: 2026-09-12
