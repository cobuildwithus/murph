# Consolidate runtime completion callbacks

## Outcome and invariant

Reduce successful invocation completion from six Web requests to three while
preserving exact attempt/generation/target authority, native settlement proof,
and pending upload drains. The process callback must never release a still
running outer invocation.

## Owner and evidence

`runtime-owner-completion.ts` currently retires, optionally releases, then calls
the separate owner-released endpoint. The early callback also reads the owner
for native target routing. Web/Postgres already owns all conditional mutations;
Temporal owns scheduling. Keep the routing read and combine completion through
the existing owner command endpoint. No schema, queue, cache, or state owner.

## Implementation and evolution

- Add one complete command that composes existing conditional retirement and
  optional native-settlement release, then sends the advisory hint outside DB
  transactions. Keep legacy commands and owner-released for deployed callers.
- Reuse the existing actionability decision and bounded best-effort hint.
- Switch Worker completion to one command per stage. Lost responses and stale
  retries cannot change a successor; native receipts remain authoritative.
- Add actual-parser completion evidence to existing live Web protocol admission;
  require Web consumer convergence before Worker activation. Roll Worker back
  before removing its Web reader floor. Warm containers keep the same callback.

## Verification

Focused contract, Web command/Postgres, Worker completion/native lifecycle and
protocol-admission proof; relevant Web/Worker/shared typechecks; complexity diff;
parent review followed by exact-head CI and final ReviewGPT. Internal cost and
coordination-only change, no product copy or public changelog change.

## Progress

- Traced the six-call flow and current conditional mutation semantics.
- Implemented one completion command per stage; removed separate Worker
  retirement/release/hint orchestration. The native callback and receipt remain.
- Focused Cloudflare proof: 438 tests across completion, native lifecycle,
  outbound routing, processing recovery, and deploy admission.
- Focused Web proof: 166 tests including 44 real PostgreSQL owner cases in an
  isolated local test database. Early retirement, exact-target settlement,
  multipart obligations, response loss, and successor fencing passed.
- Shared hosted-execution, Cloudflare and Web typechecks passed. Focused Web
  ESLint, docs drift, and complexity diff passed. The existing complexity-25
  automation timing function is unchanged; no changed function exceeds 20.
- No new repository friction. No public changelog: internal request-count
  consolidation preserves member behavior and provider inputs.
- Parent owns candidate review, draft-to-ready, final ReviewGPT, exact-head CI,
  and current-base mergeability. No merge or deployment is authorized here.
Status: completed
Updated: 2026-09-20
Completed: 2026-09-20
