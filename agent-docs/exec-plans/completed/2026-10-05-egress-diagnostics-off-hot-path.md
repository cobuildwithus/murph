# Keep OpenAI egress diagnostics off the reply path

Status: completed
Created: 2026-10-05
Updated: 2026-10-05

## Goal

- Hosted OpenAI HTTPS responses never wait for provider-request diagnostics,
  and dead OpenAI/Venice egress routes and diagnostic branches are removed.

## Evidence

- Production container interception supplies no `ctx.waitUntil`, so the Worker
  awaited the diagnostic runtime-log write (a signed Web call with a 30-second
  budget) after OpenAI's headers arrived and before returning the response.
  Every HTTPS `POST /v1/responses` paid that write, including native fallback.
- The diagnostic cloned the upstream request and re-read the whole body even
  though the image gate had already buffered the same bytes.
- Pinned Codex 0.160.0 never calls `/responses/compact` outside tests. In 14
  days every production egress diagnostic had `endpointKind: responses`;
  remote compaction v2 uses `/v1/responses`. Venice is a custom provider and
  uses local compaction.
- #3590 removed the relay and memory callers but left the Venice diagnostic
  branch, the header-derived write-fence fallback, and stale relay/memory docs.

## Success criteria

- An HTTPS Responses request returns its provider response while the
  diagnostic write is pending, in Node and real workerd tests.
- Diagnostics reuse admitted bytes and start after the provider request.
- `/v1/responses/compact` (OpenAI) and `/responses/compact` (Venice) are denied.
- Docs describe only current egress and diagnostic behavior.

## Scope

- In scope: OpenAI diagnostic scheduling, dead compact routes, Venice and
  header-fallback diagnostic leftovers, related tests and docs.
- Out of scope: authorization field cleanup, route-table refactoring, usage
  recording scheduling for other providers, diagnostic sampling.

## Risks and mitigations

1. Risk: module-level `waitUntil` is unavailable in some context.
   Mitigation: it is wrapped so failure never changes forwarding; the relay
   used the same fallback in production before #3590.
2. Risk: background diagnostics leak across unit tests.
   Mitigation: the workers stub records registrations and tests settle them.

## Tasks

1. Reorder and schedule the diagnostic; delete dead routes and branches.
2. Update unit, Venice, and workerd tests; update docs.
3. Verify, review, commit, open the PR, and complete the review loop.

## Decisions

- Keep diagnostic content unchanged; only its scheduling and inputs change.

## Verification

- Intercept, diagnostics, and Venice suites: 252 passed. These include a new
  test that returns the OpenAI body while the runtime-log write is pending, plus
  compact-route rejection.
- All Cloudflare Node suites that import the intercept: 706 passed, 2 skipped,
  across 15 files.
- Workerd pool: 18 passed across 6 files. The new real-workerd test returns the
  provider body before the pending write, then persists a valid diagnostic with
  the exact admitted byte count.
- `pnpm --dir apps/cloudflare typecheck` passed after generating the web Prisma
  client (friction logged). The complexity diff showed no change, and the docs
  drift check passed.
Completed: 2026-10-05
