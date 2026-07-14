# PR 610 final ReviewGPT and CI fixes

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Preserve terminal Clinical Records page-size handling across the signed
  Cloudflare transport and restore the intentional hosted runner size ratchet.

## Success criteria

- Every page body accepted by the shared string contract fits through the
  bounded response envelope, including three-byte UTF-8 content.
- Oversized raw pages still reach the runtime-owned `page_size_exceeded`
  classification instead of entering mailbox retry state.
- The runner static-closure baseline matches the exact intentional PR growth
  without loosening its tolerance or total ceiling.
- Focused tests, affected typechecks, repository guards, CI, and final
  exact-head ReviewGPT are green.

## Scope

- In scope: the shared Clinical Records response-envelope constant, Cloudflare
  adapter usage and focused regression, and the measured runner baseline.
- Out of scope: SMART OAuth producers, UI, retention/pruning machinery, queues,
  schedulers, new persisted state, or unrelated runtime changes.

## Constraints

- Keep the wire limit owned by the dependency-free hosted-execution boundary.
- Keep exact raw-page byte classification in assistant-runtime.
- Do not add a cross-package test dependency that reverses package ownership.
- Preserve the dormant-consumer deployment order; the later producer remains
  gated on bounded raw-run retention.

## Tasks

1. Add the worst-case serialized response bound to the shared wire contract.
2. Prove a valid three-byte UTF-8 FHIR page crosses the real Cloudflare port
   and remains larger than the raw-page byte cap.
3. Ratchet the runner static-closure baseline to the exact CI measurement.
4. Run focused verification, affected typechecks, guards, and privacy scans.
5. Commit, push, update the PR, run one final exact-head ReviewGPT audit, and
   reconcile CI and review state.

## Decisions

- The serialized string envelope reserves six bytes per UTF-16 code unit,
  covering `JSON.stringify`'s worst-case `\uXXXX` expansion rather than fixing
  only the reported three-byte example.
- ReviewGPT round 5's raw-retention candidate is not accepted for this dormant
  consumer PR because no production producer can enqueue repeated retrievals.
  The durable file-count contract and deploy order already make bounded
  retention a prerequisite of the later producer; adding pruning or a second
  lifecycle owner here would be speculative complexity without a reachable
  production path.
- CI measured a 7,062,178-byte static boot closure against the existing
  7,057,087-byte budget. Advance the baseline by only that exact 5,091-byte
  overage while preserving the separate 96,000-byte noise band and fixed
  9,300,000-byte total ceiling.

## Verification

- Cloudflare Clinical Records port and runner-bundle budget tests.
- Assistant-runtime Clinical Records terminal page-size regression.
- Hosted-execution, assistant-runtime, and Cloudflare typechecks.
- Dependency, boundary, cycle, diff, privacy, secret-shape, unsafe-logging, and
  prohibited-cast guards.

## Results

- ReviewGPT round 5 completed on the prior exact head after more than ten
  minutes with `MODEL_CONFIRMATION: UNKNOWN`. Its three-byte UTF-8 envelope
  finding was accepted and fixed at the shared wire owner.
- The raw-retrieval retention candidate was rejected for this dormant-consumer
  PR: no production enqueue path exists, and both the frozen file-count
  contract and PR deployment plan require bounded retention before the later
  producer lands.
- Cloudflare Clinical Records and runner-budget tests passed: 38 tests total,
  including a real-port CJK-heavy FHIR response that exceeded the former
  two-byte envelope and the raw-page byte cap.
- Assistant-runtime Clinical Records passed after the final three-byte test
  update: 26 tests.
- Hosted-execution, assistant-runtime, and Cloudflare typechecks passed.
- Dependency policy, workspace boundaries, package cycles, raw-health logging,
  diff, private-identifier, secret-shape, prohibited-cast, and unsafe-logging
  checks passed.
- Full local runner assembly reached an unrelated assistant CLI-manifest
  prerequisite twice and timed out at its fixed 60-second load bound before
  esbuild ran. The exact budget unit proof passed; hosted Linux CI remains the
  authoritative bundle measurement.

### Results so far

- Cloudflare focused Clinical Records port and runner-bundle tests: 38/38.
- Assistant-runtime package run: 1,632 passed and 2 skipped; four unrelated
  host-pressure failures remained in unchanged files (three 60-second timeouts
  and one idle-checkpoint temporary-directory race). The changed Clinical
  Records test did not fail; rerun it exactly in isolation after the host
  pressure guard clears.
Completed: 2026-07-14
