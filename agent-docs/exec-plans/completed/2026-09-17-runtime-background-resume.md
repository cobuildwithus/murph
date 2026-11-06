# Unblock independent clinical enrichment jobs

Status: completed
Created: 2026-09-17
Updated: 2026-09-17

## Goal

Outcome: ready clinical document results can apply while a different import waits for extraction or completion.
Reaches: hosted system mailbox selection and wake projection for clinical enrichment.
Proof: real extraction-state, mailbox, application, and canonical-readback regression with independent queue orders; focused tests, typechecks, ReviewGPT, and CI.

## Scope and constraints

Scope serialization by the existing enrichment job identity. Preserve exact-job claims, foreground priority, bounded units, canonical writer safeguards, and checkpoint handoff. No new state, queue, schema, provider input, deployment, or production mutation. Use synthetic fixtures only.

## Cause and decision

The extraction queue returns its prepared head until application advances it. The mailbox has an independent order, but previously serialized every enrichment job under one route key. If its head awaits extraction, the delayed retry hides the prepared job behind it; neither owner can advance. Three selector regressions fail for pending, sending, and recording predecessors. The real import-to-query regression also fails: the second mailbox attempt returns null while the extractor remains at prepared work.

Current checkpoint handoff already has newer fixes than the initially investigated runtime. An exploratory retained-work test completed on the current base, so this PR does not modify the controller lifecycle.

## Tasks

1. [x] Reproduce queue blockage against the current base.
2. [x] Derive serialization from each existing job identity.
3. [x] Verify successful application, preserved other-job state, and continued extraction.
4. [x] Update architecture and public changelog; run focused tests, typechecks, complexity, and parent review.
5. [x] Open draft PR #3554 and prepare the final candidate for ReviewGPT and required CI.

## Risks and mitigations

Different jobs may become eligible independently; exact mailbox claims, the clinical state lock, canonical writer locks, and parent-revision validation remain authoritative. Verify existing clinical flow, mailbox selection, retry, foreground yield, and checkpoint tests. No provider prompt/tool surface changes; deterministic lifecycle and data-path proof is appropriate.

## Verification

Baseline: three queue-selection cases and the real import-to-query regression fail at the expected blocked wake/selection assertion. Corrected-head proof: 31 clinical tests and 52 shared mailbox/checkpoint tests pass. Assistant-runtime and Web typechecks pass. Changelog rendering passes (10 tests). Complexity guard passes with unchanged debt; the unchanged record parser remains at complexity 25 and does not warrant unrelated restructuring. Parent review verified exact-job claim ownership, canonical locking, foreground yielding, and absence of provider-input changes. The documented Web test command used the wrong working directory; existing Frog entries cover it, and running Vitest from repository root passes.

## Candidate handoff

Implementation and local proof are complete. PR #3554 owns the external gates: start exact-head ReviewGPT concurrently with CI after this candidate is pushed and marked Ready. At plan closure those external results are pending; neither merge nor deployment is authorized.
Completed: 2026-09-17
