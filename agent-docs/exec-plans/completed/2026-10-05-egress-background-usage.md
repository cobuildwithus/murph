# Keep egress usage and alert recording as background work

Status: completed
Created: 2026-10-05
Updated: 2026-10-05

## Goal

- Off-path Gemini and xAI usage recordings and the OpenAI authorization alert
  report stay attached to their Worker invocation in production instead of
  floating as promises that can be canceled with it.

## Evidence

- Production container interception supplies no `ctx.waitUntil`. Gemini and
  xAI usage recording then used `void`, so a recording still pending when the
  response finished could be canceled and its usage row lost.
- The OpenAI 401/403 alert report was awaited before the failure response in
  production, although it is only an alert.
- `waitUntil` from `cloudflare:workers` is already imported by the module, and
  the deleted relay used it as the production fallback.

## Success criteria

- Without `ctx.waitUntil`, Gemini and xAI accounting and the alert report are
  registered background work, and responses still do not wait for them.
- Transcription and ElevenLabs recordings keep awaiting. Their denial must
  revoke platform usage before another paid call.

## Scope

- In scope: one scheduling helper, the three call sites, and tests.
- Out of scope: the OpenAI request diagnostic (#4036) and the awaited
  billing-ordering recordings.

## Risks and mitigations

1. Risk: background accounting leaks across unit tests.
   Mitigation: the stub records registrations and tests settle them, matching
   #4036 byte for byte so both PRs merge cleanly.

## Tasks

1. Add the helper and convert the call sites; add registration tests.
2. Verify, review, commit, open the PR, and complete the review loop.

## Decisions

- If scheduling fails, keep the existing fallback: Gemini and xAI stay
  unawaited, and the alert report is awaited.

## Verification

- Intercept suite: 230 passed, including a new production-shape alert-report
  test and registration assertions for Gemini and xAI. A mutation check that
  restored the floating Gemini promise failed the Gemini test.
- Cloudflare suites that import the intercept or workers stub: 684 passed, 2
  skipped. Workerd pool: 17 passed. The Cloudflare typecheck and complexity
  diff passed.
Completed: 2026-10-05
