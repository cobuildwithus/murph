# Preserve provider follow-ups through hosted recovery

Status: active
Created: 2026-09-07
Updated: 2026-09-07

## Goal and evidence

A hosted pass executes at most 100 jobs, but a completed provider job can enqueue multiple follow-ups. Recovery currently rejects more than 100 pending rows, preventing checkpoint publication after legitimate queue growth. Prove the failure with synthetic service execution and cold reconstruction, then fix the existing queue export boundary.

## Design and scope

Keep execution and dirty admission bounded at 100. Recovery must preserve every already accepted job, including exact payload, identity, timing, and remaining attempts. Reuse the local queue and existing mailbox continuation; add no durable state or scheduling mechanism. Stream account-scoped pending rows through the existing SQLite query and retain only the required retry hints. Reuse the existing workspace snapshot byte envelope. One synchronous statement, no decryption, writes, external calls, or concurrent work during export.

## Work and verification

1. Reproduce 100 accepted jobs becoming 101 through provider completion.
2. Correct recovery export and prove cold reconstruction, retry timing, bounded drain, account isolation, and terminal-row exclusion.
3. Run relevant tests, typechecks, complexity and parent review. Update the reliability owner and changelog decision.
4. Commit, open a draft PR, run exact-head CI and required ReviewGPT, then merge and deploy within existing authorization. Inspect production recovery without copying private evidence into artifacts.

## Product UX

Connected-device sync must retain accepted work across runtime replacement and allow newer data to progress. No prompt, tool, reply, UI, credential, or provider request contract changes are planned. Recovery is Ready only after the composed restart proof passes.

## Candidate evidence and parent review

- The synthetic provider completed one of 100 accepted jobs and created two future follow-ups. Baseline recovery threw the per-pass durable-limit error with 101 pending jobs. The corrected recovery preserves all 101 through mailbox recording, disk readback, wire parsing, and fresh-service reconstruction. No job runs before its retry; subsequent drains execute 100 then 1.
- All 359 relevant tests passed: 123 runtime sync, 176 mailbox/entrypoint/preemption, and 60 device store. The existing maximum dirty-input proof now asserts one bounded admission read plus one account-scoped recovery iterator. Iterator coverage includes 200 pending rows, running work, terminal exclusion, independent accounts, and interrupted iteration.
- Both package typechecks and diff whitespace checks passed. Complexity guard passed; runtime-source debt decreases 145 to 143, maximum stays 75. The changed recovery hotspot decreases 29 to 27; the other pre-existing hotspots remain unchanged.
- Parent review confirmed one existing query owner, unchanged execution/admission limits, identical manifest shaping, and no credential or provider-input changes. Product UX: Ready for the scoped connected-device restart recovery journey.
- Remaining release gates: changelog fragment, final pushed-head CI and ReviewGPT, merge, managed deployment, and read-only production outcome inspection.
