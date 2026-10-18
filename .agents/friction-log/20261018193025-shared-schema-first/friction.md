---
title: 'Shared-schema first-input equality digest differs between identical runs'
severity: 'minor'
---

## Expected Behavior

The opt-in `shared schema: complete first provider input` measurement's `equality` digest (decoded request with identity and timestamp fields normalized) should be identical across two runs of unchanged source, so it can prove whether a change leaves the complete first provider input unchanged.

## Current Behavior

Two consecutive runs on the same working tree report identical `raw` and `completeWire` UTF-8 byte counts for all four direct/group by native/code-only pairs, but different `raw.*.sha256` and `equality.*Sha256` values. The equality digest therefore cannot distinguish a real first-input change from run-varying content; only byte counts were comparable.

## Possible Solution

Identify the remaining run-varying fields in the decoded request (for example temporary paths or per-run identifiers) and add them to the enumerated normalization, or log a per-field diff when equality digests differ.

## Minimal Reproducible Example

Run twice without changing any file:

    MURPH_MEASURE_SHARED_SCHEMA_INPUT=1 pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-scripted-runtime.test.ts -t 'shared schema: complete first provider input'

Compare the `[shared-schema-first-input]` lines: byte counts match, `equality.candidateSha256` differs.

## Context

Encountered while verifying that a lazily loaded skill-body edit does not change the first provider input. Matching byte counts, unchanged on-demand skill loading and prompt sources, and the deterministic planner characterization digests were used instead; matching counts do not prove byte identity.
