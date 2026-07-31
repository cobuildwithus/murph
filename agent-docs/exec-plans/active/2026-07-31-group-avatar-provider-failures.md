# Fix hosted group-avatar provider failures

Status: active
Created: 2026-07-31
Updated: 2026-07-31

## Goal

- Preserve privacy-safe Linq failure diagnostics for `set_chat_avatar` while
  making private avatar capability URLs compatible with provider image fetchers.

## Success criteria

- Non-2xx Linq avatar updates expose only an allowlisted provider code and its
  fixed first-party recovery message; transport and timeout failures remain generic.
- Strict hosted-execution parsing and the model-visible group-tool result carry
  the optional diagnostics without exposing provider bodies or private data.
- Private-media staging mints an extension-bearing URL while the Worker and
  Web/runtime validators continue to accept the shipped extensionless shape.
- GET and HEAD return matching successful status/content headers, HEAD has no
  body, and extension mismatch, tampering, and extra query parameters fail closed.
- Focused tests, direct scenario proof, exact-head CI, and required ReviewGPT
  gates pass.

## Scope

- In scope: the Linq avatar client/error projection, hosted-execution response
  contracts and model projection, private-media staging/serving/validation,
  focused regression tests, and the owning cross-deploy security/reliability docs.
- Out of scope: new dependencies, persisted state, retries, provider-specific
  queues, unrelated media routes, and production data changes.

## Constraints

- Preserve `provider_unavailable` as the failure classification.
- Parse only bounded documented structured error fields; never expose raw bodies,
  trace IDs, identifiers, capability URLs, credentials, or headers.
- Keep both URL generations valid for the capability lifetime and warm-container
  drain window; compatibility remains legacy-facing only.
- Preserve existing group-avatar success and delivery flows.

## Risks and mitigations

1. Risk: provider messages contain private or secret-bearing text.
   Mitigation: ignore provider prose and map only known avatar failure codes to
   fixed first-party recovery text after bounding the response body.
2. Risk: Web/Worker or Worker/container deploy skew rejects valid avatar fetches.
   Mitigation: consumers accept both shapes before canonical minting begins, and
   the Worker serves both throughout the compatibility window.
3. Risk: extension validation trusts the request instead of decrypted metadata.
   Mitigation: derive the allowed extension from the decrypted MIME type and fail
   closed on mismatch before returning private bytes.

## Tasks

1. Trace the current Linq failure, hosted response, model projection, media mint,
   Worker route, and consumer validation paths.
2. Implement the smallest explicit bounded diagnostics and dual-shape media changes.
3. Add focused package, Web, runtime, and Worker regressions.
4. Update only the durable docs that own privacy and rollout compatibility.
5. Run focused verification and direct scenarios, then inspect the complete diff.
6. Commit/push the candidate, open a PR, run specialist/final ReviewGPT with CI,
   resolve findings, and close this plan through the final scoped commit.

## Decisions

- Keep provider diagnostics as optional fields on the existing failure result,
  not a new error type or durable store.
- Use one canonical filename per MIME type and keep the legacy extensionless route
  as the only compatibility branch.
- Treat the retained ChatGPT response as behavioral intent; reconstruct and prove
  the change against the current repository rather than assuming hidden edits.
- Accept the specialist privacy finding by discarding provider prose entirely
  and allowlisting fixed first-party messages for Linq codes 5006 and 5007.
- Accept the specialist JPEG/WebP and extensionless-HEAD coverage patch after
  test-only path/hunk inspection. Keep a real Linq fetch-and-apply mutation as
  an explicit post-deploy smoke because this task has no authorized isolated
  provider group or production mutation scope.
- Accept final ReviewGPT's complexity-collapse finding: transport only the
  allowlisted code across Web-to-runtime, then derive its fixed recovery text
  once in the strict runtime parser for the model-visible result.

## Verification

- Commands to select after tracing: focused Vitest files for each touched owner,
  relevant package/app typechecks, `git diff --check`, direct GET/HEAD parity and
  provider-prose exclusion scenarios, required ReviewGPT gates, and exact-head
  GitHub Actions.
- Expected outcomes: allowlisted diagnostics only on HTTP provider failures; generic
  transport/timeout results; both URL generations accepted; strict tamper rejection;
  matching GET/HEAD metadata; no capability value in route logs; green required gates.
