# Codex stall diagnostics and recovery proof

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Goal and invariant

Prove where a quiet Responses connection stops progressing and design faster
recovery without duplicating Codex retry, turn, or delivery ownership. Diagnostic
failures must never affect forwarding, authorization, accounting, or delivery.

## Owners and evidence

Codex owns provider transport and HTTPS fallback. The Cloudflare egress relay
owns the two WebSocket legs; assistant-engine owns exact process/turn authority;
assistant-runtime projects bounded metadata to the existing runtime log owner.
The pinned 0.153.4, released 0.154.0, and inspected upstream main share the same
Responses WebSocket implementation: native idle timeout, no active pong deadline.
Murph config selects 90 seconds and zero stream retries. Existing traces preserve
native fallback warnings but lack WebSocket frame forwarding evidence.

## Scope and design approach

- Add bounded content-free relay milestones and precise native timeout causes.
- Reproduce a warm silent socket with the real pinned binary and local fixtures.
- Compare the existing idle timeout with a shorter native configuration and
  explicit connection failure; preserve slow healthy streams and native reuse.
- Document a minimal recovery design, including the limit of relay-local pong
  evidence and remaining production confirmation. Do not change the deployed
  timeout, replace Codex, add a scheduler, or run member/provider traffic.
- Keep state ephemeral diagnostic counters only; no new durable state or queue.

## Proof and completion

1. Add deterministic privacy, relay ordering/failure isolation, and diagnostic
   classification regressions.
2. Run a synthetic pinned-Codex stall and faster-recovery comparison with exact
   WebSocket/HTTP attempt counts and recovery-warning assertions.
3. Run affected typechecks and focused tests; inspect complexity and full diff.
4. Record recovery design and evidence in the observability owner, complete
   required review/PR workflow, and close this plan in a scoped commit.

## Product and deployment

Diagnostics and local proof only: no prompt, tools, reply policy, or timeout
change; no new awaited network/database calls on the reply path. Existing log
storage accepts additive fields; old workers simply omit them. New rows remain
best effort. No secrets, raw frames, identifiers, paths, or error prose persist.

## Verification

- Real pinned Codex full reproduction passed: silent warm socket fallback at
  90,006 ms; five-second native idle at 5,021 ms; five-second first-frame
  prototype at 5,010 ms with native idle still 90 seconds. Exactly one HTTPS
  fallback completed the answer; the next resumed turn stayed on HTTPS.
- Five short native cases pass, including an acknowledged healthy delayed
  response and a stall after acknowledgement. The latter still needs native
  idle recovery, proving the first-frame prototype's limit.
- Cloudflare relay: 29 Node tests and nine real Worker tests pass. The Worker
  proof validates the actual runtime-log parser and caps four held writes while
  forwarding continues. Initial parser rejection exposed incompatible field
  names; corrected metadata names pass without changing the shared parser.
- Assistant transport classification: six focused tests pass. Runtime projection:
  70 tests pass, including allowed, unknown, and absent timeout-phase fields.
- Assistant-engine, assistant-runtime, and Cloudflare typechecks pass.
- Complexity guard passes with no increase in existing debt. Existing large
  transport/runtime dispatch functions retain their owners; changes are additive
  diagnostics only. No unrelated refactoring is justified.
- Parent candidate review covers relay admission/accounting/close ordering,
  bounded logging, metadata privacy, native retry ownership, and synthetic-only
  proof. Existing Workers fixture shutdown warnings remain visible; no deployed
  Cloudflare or production incident attribution is claimed.

## Recovery decision and completion

The proposed first production change is a 20-second native idle budget with
existing zero stream retries and native HTTPS fallback, subject to adoption and
quiet-response/effect replay proof documented in the observability owner.
Five seconds works mechanically but is not a model-health threshold. The
first-frame timer remains a fixture-only comparison, not a second recovery
owner or a complete post-acknowledgement solution. Production stays unchanged.

Final ReviewGPT passed on candidate
`7e641d64f74663bf39576df8caf7a96558b63a94`, with no qualifying findings.
The reviewer inspected all 17 changed files and independently ran eight relay
smoke cases; native/Workers timing evidence remains the local author's proof.
Parent final review found no required remediation. The final commit only closes
this plan; exact-head CI completion is recorded in PR #3440.
Internal-only changelog disposition: observability and local transport proof;
no member-visible response or recovery policy change ships here.
Completed: 2026-09-14
