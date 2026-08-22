# Remove Codex thread-start permission attestation

Status: active
Created: 2026-08-21
Updated: 2026-08-21

## Goal

- Restore reliable fresh Codex thread execution for attended, scheduled, and
  detached hosted turns by deleting Murph's response-based permission
  attestation, while preserving the named permission requests, OS-enforced
  permission profiles, container isolation, and stale-resume protection.

## Success criteria

- A fresh `thread/start` with a named permission profile proceeds to
  `turn/start` without inspecting echoed permission metadata.
- The deleted nonretryable
  `ASSISTANT_CODEX_APP_SERVER_PERMISSION_ATTESTATION_FAILED` path and its
  dedicated test are absent.
- Named permission profiles, runtime workspace roots, approval policy, and
  one-shot thread inputs are still sent unchanged.
- Linux/container smoke continues to prove real filesystem, environment, and
  network confinement without treating response metadata as enforcement.
- The separate stale-resume context check remains unchanged.
- Durable architecture, security, runtime, deploy, and product-spec claims no
  longer require thread-start attestation.
- Focused Assistant Engine and Cloudflare proof, package typechecks, exact-head
  CI, specialist review, and final ReviewGPT resolve without accepted findings.

## Scope

- In scope:
  - delete the fresh-thread response attestation call, helper, error, and
    dedicated regression expectation;
  - remove response-echo assertions from managed-container smoke while keeping
    behavior-based confinement checks;
  - update current owner docs and the public changelog for the reliability
    recovery;
  - preserve scheduled-turn retry/delivery ownership and all named-profile
    request construction.
- Out of scope:
  - changing or deleting any Codex permission profile;
  - changing container restore, filesystem mount, network, environment, or
    dynamic-tool authority;
  - changing `ASSISTANT_CODEX_RESUME_STALE` or warm-thread recovery;
  - repairing the separate Temporal worker standby incident.

## Constraints

- Technical constraints:
  - keep the App Server adapter thin and delete rather than replace the guard;
  - preserve Assistant Ask's OS-enforced read-only root invariant and
    production-like Linux smoke;
  - do not add a compatibility path, fallback profile, retry loop, or new
    observability owner.
- Product/process constraints:
  - Product UX Patch: scheduled and attended turns keep the same promise and
    destination; only avoidable fresh-thread failure is removed;
  - use an isolated PR worktree, focused local proof, exact-head CI,
    preliminary Product UX and coverage lenses, and the final sensitive
    ReviewGPT gate;
  - keep incident and production evidence out of public repository artifacts.

## Risks and mitigations

1. Risk: deleting the echo check could accidentally delete the actual named
   permission request or behavior smoke.
   Mitigation: retain request-shape tests and behavior-based Linux/container
   denial proof, and search the final diff for profile construction changes.
2. Risk: deleting permission comparisons from stale resume could permit a warm
   thread to rejoin under stale execution context.
   Mitigation: leave `assertCodexResumeContextMatches` and its regression tests
   untouched.
3. Risk: mixed Worker/container rollout could leave old warm bundles continuing
   to fail until recycled.
   Mitigation: deploy the Cloudflare runner with immediate container rollout,
   prove the new runner fingerprint, and monitor the bounded error aggregate.

## Tasks

1. Inventory the fresh-thread attestation code, tests, smoke, docs, and current
   overlapping PR/worktree ownership.
2. Delete the fresh-thread response gate and update focused tests to prove
   `turn/start` proceeds without attestation metadata.
3. Remove smoke response assertions while retaining concrete read/write,
   hidden-path, environment, and network confinement proof.
4. Update durable owner docs and add one privacy-safe reliability changelog
   item.
5. Run focused tests and typechecks, inspect the complete diff, then push the
   exact candidate and run the required specialist/final reviews with CI.
6. Resolve accepted findings, complete the Product UX walkthrough, archive this
   plan, and commit the final scoped task state.

## Decisions

- The actual permission profiles remain enforcement; the App Server's response
  echo is diagnostic metadata and is not an independent trust boundary.
- "Remove entirely" applies to the fresh-thread permission attestation. The
  separate warm resume-staleness check protects a different reuse failure and
  remains.
- Changelog applies because members can experience recovered scheduled and
  attended turns; public copy will describe the reliability outcome without
  exposing internal permission mechanics.

## Verification

- Commands to run:
  - focused Assistant Engine runtime tests around fresh named-permission thread
    start and stale resume;
  - focused Cloudflare smoke-child tests for named-profile confinement;
  - affected package typechecks;
  - `git diff --check`, stale-string searches, changelog fragment validation,
    and the routed PR review/CI gates.
- Expected outcomes:
  - fresh named-permission starts reach `turn/start` when response metadata is
    absent or drifted;
  - resume context drift still throws `ASSISTANT_CODEX_RESUME_STALE`;
  - behavior-based confinement checks remain green;
  - no fresh-thread attestation code or durable claim remains.
