# Fix deploy-smoke retries and delete dead Codex config diagnostics

Status: completed
Created: 2026-10-05
Updated: 2026-10-05

## Goal

- The deploy-smoke Codex config matches its one-request egress fence, and
  constant or emitter-less Codex configuration diagnostics are removed.

## Evidence

- The deploy-smoke fence admits exactly one provider request
  (`readDeploySmokeLiveModelTurnFence` consumes it), and the June deploy-smoke
  plan required `request_max_retries=0` and `stream_max_retries=0`. A later
  config rewrite (#481) set 4 and 5, so any retry can only be refused and hides
  the original upstream failure.
- `codex-config.ts` redefined `"hosted-openai"` locally beside the imported
  `HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID`.
- `codex.prepare` logged four constant native-memory fields and a constant
  `codexProviderTransportMode`; only tests read them.
- `buildHostedCodexMemoryUsageRecord` had no production caller after #3590.
- App-server timing stages `shutdown` and `warm-abort-poisoned` have no emitter,
  and the transport classifier's `response stream disconnected` check is
  subsumed by `stream disconnected`.

## Success criteria

- Deploy-smoke config renders zero request and stream retries.
- Removed constants, fields, and branches have no remaining references.
- Focused tests and typechecks pass.

## Scope

- In scope: the items above and their tests.
- Out of scope: hosted Codex retry or timeout policy, the hosted-local model
  catalog generator, dev proxy environment handling, memory config flags.

## Risks and mitigations

1. Risk: a log reader depends on the removed constant fields.
   Mitigation: repository search finds only tests; values were constant.

## Tasks

1. Apply the fix and deletions with test updates.
2. Verify, review, commit, open the PR, and complete the review loop.

## Decisions

- Keep `HOSTED_CODEX_NATIVE_MEMORY_CONFIG`; it still renders disabled flags.

## Verification

- Assistant-runtime config, events, and startup suites: 164 passed, 8 skipped.
- Hosted-execution usage: 27 passed. Cloudflare container entrypoint: 67
  passed. Assistant-engine runtime turns: 50 passed.
- Typechecks passed for assistant-runtime, hosted-execution, assistant-engine,
  and Cloudflare. The complexity diff passed, with `assistant-codex.ts` debt
  going from 182 to 181.
Completed: 2026-10-05
