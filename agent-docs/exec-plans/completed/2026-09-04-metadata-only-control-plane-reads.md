# Bound metadata-only control-plane reads

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Stop mailbox high-water and companion SDK sign-in selection from loading
  encrypted payload or credential fields that those decisions do not use.

## Success criteria

- Mailbox high-water queries select only lane sequence and update time.
- Companion SDK sign-in selects bounded connection lifecycle metadata without
  opening any connection credential ciphertext.
- Connect, resume, legacy omitted-intent, terminal-state, and ambiguous-state
  behavior remains unchanged.
- Focused tests, hosted-Web typecheck, exact-head CI, and the required
  cross-cutting review gate pass.

## Scope

- In scope: the mailbox high-water projection, the existing bounded
  device-connection metadata projection, companion SDK sign-in selection,
  focused tests, and the directly affected reliability documentation.
- Out of scope: provider token writes, lifecycle mutation protocols, mailbox
  payload delivery, schemas, member-visible copy, and new runtime state.

## Constraints

- Keep reads bounded at the existing companion connection cap.
- Preserve the server-owned lifecycle rule: omitted intent may establish only
  when no provider row exists, and terminal or ambiguous state must fail.
- Reuse the existing connection-status projection rather than adding another
  query or lifecycle owner.

### Product UX Patch

- Outcome: Companion sign-in and hosted runtime wake decisions retain the same
  member-visible results with less database and encryption-key work.
- Reaches: native companion connect/resume/legacy sign-in, terminal reconnect
  recovery, ambiguous account recovery, and hosted mailbox wake snapshots.
- Proof: exact query-projection assertions, no-decryption assertions, and the
  existing lifecycle matrix exercised through the public ingress service.

## Risks and mitigations

1. Risk: A metadata projection omits setup phase and treats an incomplete
   connection as established.
   Mitigation: project setup phase explicitly and keep the shared
   `isEstablishedDeviceSyncConnection` predicate.
2. Risk: Filtering out disconnected rows permits an old client to recreate a
   terminal connection.
   Mitigation: request every provider row and apply lifecycle filtering only
   after the bounded metadata snapshot is complete.
3. Risk: The query replaces unbounded decryption with an unbounded metadata
   scan.
   Mitigation: preserve the existing limit-plus-one saturation check.

## Tasks

1. Characterize both existing read paths and their lifecycle/query contracts.
2. Narrow mailbox high-water fields and prove ciphertext is absent from the
   query projection.
3. Extend the existing bounded connection-status projection with setup phase
   and an all-status mode, then use it for SDK sign-in selection.
4. Exercise every sign-in lifecycle branch and prove credential decryption is
   not called.
5. Run focused tests, typecheck, complexity and diff/privacy checks; archive the
   plan, commit, and open the draft PR.
6. Push the exact candidate, run ReviewGPT concurrently with required CI, and
   resolve all required gates before handoff.

## Decisions

- Combine these two narrowly related reductions in one PR because both replace
  payload-bearing control-plane reads with metadata-only projections and share
  the same hosted-Web verification surface.
- Reuse the existing companion connection cap of 32 rather than introducing a
  second threshold.
- Do not change lifecycle semantics or decrypt a selected connection after the
  decision; subsequent mutation owners already revalidate exact authority.

## Verification

- Commands to run: focused mailbox-store, Prisma connection-store, and hosted
  public-ingress tests; hosted-Web typecheck; `pnpm complexity:diff`; scoped
  lint and privacy/diff review; exact PR-head CI; ReviewGPT.
- Expected outcomes: selected Prisma fields contain no mailbox ciphertext or
  device credentials, all existing companion outcomes remain unchanged, and a
  33rd connection fails closed before selection.
Completed: 2026-09-04
