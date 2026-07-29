# Progress card private delivery

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Make a requested experiment progress card reach the member through the
  existing private media path, or produce an explicit recoverable response
  instead of accidental silence.

## Success criteria

- The production integrity failure is reproduced at the
  `progress-card -> vault_image -> provider delivery` boundary and reduced to
  the exact owner violation even though production deliberately does not log
  private descriptor values or identify the mismatched field.
- The existing owner derives one stable attachment descriptor from the
  immutable saved capture without adding a new queue, state owner, or public
  media path.
- Retries remain private, idempotent, and capable of completing the accepted
  member request.
- Focused regression coverage, canonical verification, product-experience
  review, preliminary ReviewGPT, final ReviewGPT, CI, mergeability, and
  deployment/runtime proof pass with no unresolved accepted finding.

## Scope

- In scope: experiment progress-card capture metadata; assistant private-image
  verification and hosted provider handoff; focused integration coverage;
  directly affected owner documentation.
- Out of scope: public image hosting, generated-image job architecture,
  experiment card visual design, unrelated messaging latency, and broad outbox
  redesign.

## Constraints

- Keep raw capture bytes private and immutable.
- Preserve the foreground reply critical path and the existing bounded outbox
  retry contract.
- Do not weaken integrity checks or silently drop accepted replies.
- Prefer deletion, derivation, or correction at the current owner boundary over
  new abstractions or persisted state.

## Risks and mitigations

1. Risk: treating a generic integrity error as proof of one specific mismatch.
   Mitigation: reproduce the full boundary and expose only a structured,
   content-free mismatch category in tests or diagnostics if current evidence
   is insufficient.
2. Risk: fixing one rendering command while leaving other private images
   vulnerable to the same descriptor drift.
   Mitigation: locate the actual owner violation and keep the correction at the
   narrowest shared boundary justified by the reproduction.
3. Risk: a safety fix converts failure into silence or an unverified send.
   Mitigation: retain exact-byte verification and prove explicit terminal
   delivery or recoverable failure behavior.
4. Risk: independently deployed web and Worker versions disagree.
   Mitigation: state the compatibility window, safe deploy order, rollback
   floor, and post-deploy proof before merge.

## Tasks

1. Reproduce the production failure with a private synthetic experiment and
   trace every descriptor field from capture creation through provider preload.
2. Ask ReviewGPT to audit the evidence and owner boundaries before choosing the
   correction.
3. Implement the smallest owner-correct fix and focused regression coverage.
4. Run direct proof, canonical diff-aware verification, acceptance,
   product-experience review, and the preliminary specialist ReviewGPT pass.
5. Complete parent final review, close the plan with a scoped commit, run final
   ReviewGPT with CI, prove mergeability, and verify the deployed runtime.

## Decisions

- Treat this as high-risk hosted-runtime work because it crosses private media,
  external provider delivery, retries, and a user-visible recovery path.
- Use the final ReviewGPT PR gate because the user explicitly requested it and
  the change touches a trust boundary; do not also run local deep-review.
- Keep diagnosis and implementation local. Send ReviewGPT only redacted code
  and synthetic evidence, never the private conversation or member identity.
- Production evidence proves three identical pre-provider integrity failures
  with no provider ID while text-only replies on the same route succeeded. The
  progress-card producer's exact-byte test and the final verifier both pass,
  isolating the defect to the intervening attachment handoff.
- Treat model-relayed hash, size, filename, and MIME as untrusted selection
  hints. The existing attachment owner reloads the selected private ref and
  derives the one descriptor allowed into the outbox; final delivery retains
  its second read to detect any later byte change.
- A private-image preparation failure sets the existing `reply-required` turn
  state and returns no media patch, so `finish_without_reply` cannot convert the
  recovery into accidental silence. This uses the current final-action owner
  rather than a new retry or delivery lifecycle.
- ReviewGPT independently traced the late identity binding and recommended
  deriving metadata from a post-commit vault snapshot before response-media
  persistence while preserving the final verifier. The shared attachment
  boundary is the smaller existing owner and covers every private image without
  a new experiment-specific dynamic tool.
- Do not fold ReviewGPT's hosted child-process receipt finding into this fix.
  It is a broader pre-existing CLI mutation concern and cannot produce the
  observed integrity code by itself. The capture and outbox remain in the same
  restored workspace and neither becomes a durable workspace snapshot without
  the other; replacing the CLI with a new hosted experiment tool would widen
  this correction without proving the reported failure.
- Do not forbid all fresh automation attempts after
  `ASSISTANT_VAULT_IMAGE_CHANGED_AFTER_CAPTURE`. After early canonicalization,
  that code means the bytes changed later; a fresh attachment read is the
  existing recovery path and may succeed. Globally terminalizing it would
  convert a repairable change into silence.

## Verification

- Focused pre-fix reproduction covering
  `vault-cli experiment progress-card -> attach_response_media -> provider
  preload`.
- `pnpm test:diff` over every touched owner.
- `pnpm verify:acceptance`.
- Product-experience review over request, progress, failure, retry, and terminal
  delivery.
- Preliminary `completion-specialists` ReviewGPT and final exact-head
  ReviewGPT/CI gate.
- Post-deploy synthetic private-card request showing one verified provider
  attachment and no integrity failure.

## Evidence

- Pre-fix synthetic reproduction: a schema-valid wrong hash survived
  `attach_response_media` and caused the existing final verifier to reject the
  unchanged capture.
- Post-fix focused private-media suite: 26 tests passed, including canonical
  attachment derivation and unreadable-ref rejection with no media patch.
- Adjacent Codex/runtime suites: 252 tests passed.
- CLI progress-card producer test and CLI/assistant-engine typechecks passed.
- Local `product-experience-review`: `NO FINDINGS`; it confirmed the existing
  CLI, attachment owner, outbox, and same-thread route are the smallest complete
  experience and requested full hosted success/recovery proof before handoff.
- Assembled-runner hosted-local E2E: 3/3 passed. A corrupted relayed hash was
  canonicalized and delivered through one Linq attachment; a missing ref
  rejected `finish_without_reply`, sent a same-thread text recovery, uploaded
  no attachment, and ended with no runtime error or mailbox lag.
- Product-experience re-audit after that proof: `NO FINDINGS`, no material
  evidence gaps.
- Canonical affected-owner verification passed: assistant engine 2,821 tests,
  assistant CLI 128 tests, assistant runtime 1,953 tests, assistantd 40 tests,
  CLI 1,084 tests, setup CLI 124 tests, Cloudflare 2,055 tests across its node
  and Worker projects, plus the selected guards and typechecks.
- The first acceptance run completed all package coverage, the production web
  build, and the other workspace gates before one unrelated Cloudflare
  clinical-records cancellation test hit its exact 60-second timeout under
  concurrent load. Its immediate isolated rerun passed all 13 tests in 1.8
  seconds, proving the failure was suite contention rather than the private
  media change.
