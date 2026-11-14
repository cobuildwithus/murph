# A finished recap show survives a network failure behind its save

Status: completed
Created: 2026-11-14
Updated: 2026-11-14

## Goal

- A finished pair recap show is not replaced by the plain fallback because one
  outbound request behind its save lost a connection.

## Evidence (production, 2026-11-14)

- A show with three scenes and a song was generated and uploaded. Its final
  `write_recap` returned `400 INVALID_REQUEST` in under a second. The Web log
  for that request recorded a `TypeError: fetch failed` with cause
  `read ECONNRESET`. The JSON error mapper answers every `TypeError` with 400,
  the runner does not replay a 400, and the turn ended in the plain fallback.

## Success criteria

- A failed outbound fetch behind a Web JSON route returns a retryable 503.
- Recap group-tool requests replay once on a 5xx or transport failure.

## Scope

- In scope: `apps/web/src/lib/http.ts`, the runner group-tool replay list,
  their tests, and `agent-docs/RELIABILITY.md`.
- Out of scope: the TypeError-means-invalid convention; the recap media tools
  and what `read_game` returns, which are a separate change.

## Decisions

- One retry, in the existing seam. The runner already replays listed group-tool
  requests once; recap requests join that list. No retry is added inside Web's
  save path, the control client, or the tool handlers.
- The fetch-failure test is the exact message `fetch failed`, the same test two
  other Web modules already use. It is not broadened and does not inspect
  `cause`.

## Risks and mitigations

1. Risk: a replayed recap request runs twice on Web.
   Mitigation: the save and the fallback first return an already-sealed recap;
   uploads reuse a content-addressed key and skip duplicate asset rows; reads
   have no effects. Replay tests cover each request shape and fresh callback
   auth.
2. Risk: routes that returned 400 for a network failure now return 503.
   Mitigation: 503 is the truthful, retryable answer; domain matchers still run
   first, so wrapped provider failures keep their mappings.
3. Risk: deploy skew between Web and the runtime.
   Mitigation: each change is independently safe. An old runner surfaces the
   503 as it surfaced the 400; a new runner replays only on a real 5xx.

## Verification

- Focused: `apps/web/test/http.test.ts` (36 passed) and
  `apps/cloudflare/test/group-tool-port-replay.test.ts` (37 passed).
- `pnpm test:diff`: Web and Cloudflare package lanes passed for these files.
- Independent read-only deep review: no blocker or should-fix finding.
- After deploy: regenerate the affected recap and confirm a sealed show.
Completed: 2026-11-14
