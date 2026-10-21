# Make public image attachment failures recoverable

Status: active
Created: 2026-10-21
Updated: 2026-10-21

## Goal and scope

Give rejected public image URLs an actionable direct-attachment recovery path,
and complete review of the common-media secure-delivery change. Preserve the
public URL restrictions, approval authority, and existing provider adapters.
No production sends or deployment are included.

## Decisions and risks

- Query-bearing optimizer URLs fail the existing preview validation. Keep that
  boundary and explain retrying the original public source or saving the image
  for secure file delivery. Do not silently strip parameters or rewrite URLs.
- Error text is fixed and must never echo submitted URLs, filenames, or tokens.
- Older runners cannot read or retain newly supported secure-file extensions.
  Split a reader-only prerequisite PR from the writer PR. The reader release
  preserves the existing send allowlist while accepting new descriptors on
  verified read and cleanup. Remove that temporary writer gate only after
  reader convergence; retain the reader release as the rollback floor.
- Product UX: users who need an attachment get a retry path, not only a website
  link. Secure file fallback still requires approval and channel availability.

## Tasks and success criteria

1. Prove missing recovery guidance with deterministic dynamic-tool tests.
2. Update the existing validation error and owning delivery contract.
3. Replay a real-Codex optimizer rejection and original-source retry; assert one
   accepted media item, no link-only fallback, and no invented delivery receipt.
4. Run focused tests, typechecks, complexity review, and privacy review.
5. Prepare the reviewed PR and explicitly gate deployment on reader convergence.

## Verification

- Dynamic-tool error privacy/recovery and existing runtime RPC expectations.
- Operator-config public URL validation, including signed/local/IP rejection.
- Focused live local-subscription recovery journey and inspected reply.
- Existing common-media preparation, provider dispatch, cleanup and approval
  proof is recorded in the preceding completed secure-media-files plan.

## Results

- Before the fix, both HTTP and optimizer-URL recovery regressions failed because
  the tool returned only the generic public-URL validation message.
- Recovery proof: 65 dynamic-tool/runtime tests and 23 operator-contract tests
  passed; operator-config and assistant-engine typechecks passed.
- Live local-subscription journey with gpt-6.1-sol passed: two attachment attempts
  (optimizer rejected, original accepted), exactly one media item, concise reply,
  no website-link fallback. Provider receipt remains outside this synthetic proof.
- Rollout correction: prerequisite PR #4286 keeps the original send allowlist
  while expanding verified readers and cleanup. The writer change removes that
  temporary gate. Merge/deploy the prerequisite alone and prove native reader
  convergence before merging/deploying the writer; no deployment is authorized.
- After integrating the prerequisite and removing its writer gate, 75 focused
  request/read tests and assistant-engine typecheck passed. Independent persisted
  descriptor hash tests remain after removing reader-only rejection assertions.
