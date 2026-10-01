# Skip control-key preparation for unchanged Linq routes

Status: completed
Created: 2026-09-21
Updated: 2026-09-21

## Goal

- Remove control-key preparation from ordinary, already-bound Linq direct
  messages so routing does less work before the runtime can start a turn.

## Success criteria

- An exact clean binding reaches mailbox append with ingress preparation only.
- Changed routing and competing pending bindings trigger the existing bounded
  retry, with required control preparation outside the transaction.
- Preserve current membership, access, participant, audience, and chat ownership
  checks; keep message payload encryption and durable mailbox semantics.
- Focused routing/dispatch tests and Web typecheck pass.

## Scope

- In scope: derive an unchanged route from provider-attested input and existing
  current-generation blind indexes; update the preparation and retry consumers.
- Out of scope: cross-request key caching, key hierarchy changes, Worker
  placement, typing indicators, model inputs, deployment, and PR publication.

## Constraints

- No provider operations inside database transactions; no new database state,
  cache, dependency, or runtime protocol.
- Preparation is speculative. Repeat live authority checks under existing locks.
- Keep all fixtures synthetic. Make a scoped local commit; publication is separate.

## Risks and mitigations

1. A preflight match becomes stale before admission.
   Mitigation: compare the complete raw routing record under existing locks and
   retry with full preparation on drift.
2. An unchanged home binding still needs pending-conflict repair.
   Mitigation: keep the existing pending-conflict check; retry with control
   preparation before any private routing mutation.
3. Private routing is needed by a different branch.
   Mitigation: exclude Family preflight, require active access and attested
   directness, and reprepare on an access or Family transition.

## Tasks

1. Trace ordinary preflight, locked admission, route binding, and mailbox append.
2. Reuse the existing exact-binding predicate to skip private projection.
3. Prove stable acceptance and bounded fallback through the real planner.
4. Update the architecture owner, review the full diff, and commit locally.

## Decisions

- The route marker carries only provider-attested chat/line values and the
  existing assignment timestamp. It is not a partial decrypted routing snapshot.
- Blind indexes can verify an exact incoming route without opening ciphertext.
  This does not authenticate or consume stored ciphertext; flows that consume
  private values retain their existing decryption.
- Ingress remains necessary to encrypt each new durable mailbox payload.
  Its request-local cache lifetime still causes a fresh unwrap on later requests;
  extending that lifetime is a separate change with rotation/expiry semantics.
- Model behavior proof is not applicable: no prompts, tools, model inputs, reply
  policy, or runtime payload shapes change.
- Changelog: a performance entry is appropriate when this candidate is published
  in a PR. No PR or release is part of this local task, and no measured end-to-end
  latency improvement or sub-three-second guarantee is claimed.
- Deployment: Web-only behavior change with unchanged schemas and wire formats.
  Existing Worker/runtime versions remain compatible; no migration or order needed.
- Final ReviewGPT and exact-head CI remain required before a future PR is ready;
  they are not claimed by this local verification.

## Product UX

- Outcome: remove unnecessary routing crypto before ordinary conversation turns.
- Reaches: active members sending to an unchanged, explicitly direct Linq home
  conversation. New bindings, route repair, and Family retain full preparation.
- Proof: synthetic webhook-to-planner acceptance, one mailbox append, no control
  unwrap on a stable route, and retries with provider work outside transactions.
- Verdict: Ready for the bounded local change. Production response timing and
  end-to-end model request timing remain unmeasured after this patch.

## Verification

- Focused Web Vitest suites: home-binding predicate, direct-mailbox preparation,
  and Linq dispatch. Stable routes must use one ingress unwrap and zero control
  unwraps; routing drift and pending conflicts must retry once with control.
- `pnpm --dir apps/web typecheck`.
- `pnpm complexity:diff`; inspect changed hotspots without expanding scope.

## Results

- Focused Vitest proof: 271 tests passed across the three suites. The final
  prewarm fixture correction was rerun separately (24 passed); dispatch and
  binding tests already passed against the final production source.
- Web typecheck passed.
- Complexity guard passed with unchanged total debt and maximum complexity in
  each changed source file. Extracted preparation eligibility and Family-root
  validation keep those decisions explicit without a new abstraction or state owner.
- Parent review covered the full diff, locked ownership and access checks,
  stable/no-control acceptance, drift and pending-conflict fallback, Family
  preparation, mailbox compatibility, and privacy. No new provider operations,
  database reads, or retries were added to stable routing.
- `git diff --check` and changed-file privacy scan passed.
- No production deployment, latency measurement of the patch, PR publication,
  or external final review was performed.
Completed: 2026-09-21
