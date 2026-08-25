# Vault CLI nutrition cancellation recovery

Status: active
Created: 2026-08-24
Updated: 2026-08-25

## Goal

- Keep an aborted hosted label request terminal while preserving retryable
  recovery for actual timeouts and transport failures.

## Success criteria

- Request-boundary `AbortError` failures use a stable cancellation code,
  `stage: transport`, and `retryable: false`.
- Hosted-runtime and credential configuration failures explicitly remain
  terminal at `stage: configuration`.
- `TimeoutError`, ordinary network failures, and response-body acquisition
  failures retain their existing recovery behavior.
- Focused source and prepared-artifact tests, CLI typecheck, and runner bundle
  proof pass.

## Scope

- In scope: the shared hosted food/supplement label request classifier, focused
  regression coverage, exact-head PR evidence, and review preparation.
- Out of scope: an internal retry loop, new error abstractions, or other CLI
  families.

## Risks and mitigations

1. Risk: treating cancellation as transient could prompt a pointless unchanged
   retry. Mitigation: classify only request-boundary `AbortError` as terminal.
2. Risk: collapsing body-read aborts could lose the branch's proven transient
   recovery. Mitigation: leave response-body acquisition classification intact;
   the shared request creates no caller-controlled signal for that phase.

## Tasks

1. Correct request-boundary cancellation classification without discarding its
   bounded transport name/code, and align configuration-stage metadata.
2. Add focused coverage proving cancellation is terminal and private exception
   text/query input do not enter the model-facing error.
3. Run source, prepared-runtime, typecheck, documentation, and bundle proof.
4. Inspect, commit, push, refresh the Draft PR, and review the exact candidate.

## Decisions

- Keep the existing owner-local classifier and metadata channel; no new state or
  retry machinery is warranted.
- Preserve safe error name/code diagnostics. Only exception messages, query
  values, provider bodies, and concrete credentials stay outside the envelope.
- Integrate the final shared foundation by retaining one typed request owner and
  deleting the downstream raw-response parser. Provider-schema failures remain
  fieldless because they are not model-correctable inputs; the nutrition branch
  continues to add only bounded transport name/code diagnostics.
- Keep one food payload validation-path owner. The typed CLI command constructs
  the payload and the Vault use-case parser validates it before any Vault write;
  the duplicate CLI field allowlist and schema parse were deleted.

## Round-three retrospective

### Growth attribution

- The immutable first-reviewed head changed 17 files and 922 lines, with 396
  lines of authored source churn. Before this retrospective, the current head
  changed 26 files and 2,231 lines, with 612 lines of authored source churn.
- The accepted response-body correction consolidated header, body, JSON, and
  schema handling into the existing hosted-label request owner. Its additional
  tests distinguish retryable body acquisition from terminal completed-body
  validation for single and batch food and supplement lookups.
- The accepted protocol correction added submitted-candidate versus
  stored-vault-state provenance in Core, mapped that provenance once in the
  explicit protocol use case, and added no-write regression coverage for the
  public constraints.
- Foundation integration removed the raw `Response` handoff and both downstream
  response parsers, migrated producers to the shared context/issues envelope,
  and retained one shared projector. The accompanying config hash and runner
  budget changes are generated or measured release-shape updates, not new
  runtime concepts.
- The protocol privacy follow-up made Core discard submitted unknown key names
  while retaining their fixed structural parent path. The cancellation
  follow-up distinguishes terminal request cancellation from retryable body
  timeout or transport failure inside the same hosted-label owner.
- The initial public-path work covered food, recipe, protocol, and meal timezone
  recovery. This retrospective deletes the duplicated food allowlist and parse
  from the typed CLI command, removing 74 production lines while retaining the
  authoritative Vault use-case path.

### Production owner inventory

- Contract schemas own accepted food and recipe payload shapes. CLI command
  schemas own only their public flags and argument types; their builders do not
  own a second payload-validation policy.
- `parseFoodPayload` and `parseRecipePayload` are the authoritative pre-write
  payload parsers and public field-path owners for imports, typed saves, and
  edits.
- Core protocol validation owns constraint metadata and validation provenance.
  The explicit protocol use case owns the single mapping from that metadata to
  `VaultCliError`; unknown submitted keys never become public paths.
- The meal edit command reuses the existing IANA timezone schema at its command
  boundary.
- The hosted-label client owns request construction, fetch, status
  classification, body acquisition, JSON/schema validation, and typed return.
  There is no downstream raw-response parser or internal retry loop.
- The operator-config projector owns the final model-facing envelope. The
  Cloudflare bundle script and generated CLI skill hash describe release shape
  only and own no error behavior.

### Direction

- Direction: delete and continue. Delete the duplicate typed-food payload parse
  and allowlist; retain the existing use-case parser, shared projector, Core
  protocol validator, and hosted-label request owner. Splitting or redesigning
  these owners would add indirection without removing another demonstrated
  duplication.
- This keeps package dependencies one-way: CLI constructs public command input,
  Vault use-cases validate and orchestrate writes, Core supplies protocol facts,
  and operator-config projects the common envelope.

### Retained regression proof

- Food and recipe failures retain bounded nested field paths; protocol failures
  retain safe public constraints and distinguish submitted input from stored
  corruption.
- Provider queries, credentials, bodies, exception messages, submitted values,
  unknown protocol keys, local paths, and Vault record paths remain absent.
- Request cancellation remains terminal. Timeouts, disconnects, throttling, and
  server failures remain truthfully retryable; completed malformed provider
  responses remain terminal and fieldless.
- Invalid food and protocol mutations are rejected before any Vault or audit
  write. The focused food suite passes through the single use-case validation
  owner after deletion.

## Verification

- `pnpm exec vitest run packages/cli/test/food-labels.test.ts packages/cli/test/supplement-labels.test.ts`
  passed: 2 files, 42 tests.
- `pnpm --filter @murphai/murph typecheck` passed.
- `pnpm --dir packages/cli verify:prepared-runtime` and
  `pnpm --dir packages/cli verify:package-shape` passed.
- A direct import of the prepared `dist` food and supplement clients passed
  terminal cancellation and configuration-stage classification: 4/4.
- `pnpm docs:drift && pnpm docs:gardening` passed.
- `pnpm --dir apps/cloudflare runner:bundle` passed all eight unbundled/bundled
  parity probes. Vault CLI: 9,465,853 / 9,477,676 bytes total, 805 / 20,000
  bytes entry, 25,155 / 33,200 bytes static closure. Runner: 11,277,964 /
  11,393,617 bytes total, 1,740,666 bytes entry, 8,598,164 bytes static closure.
- Final-foundation integration focused proof passed 73 source tests across the
  food, supplement, and shared provider-recovery suites (29 prepared-runtime
  cases skipped); CLI typecheck passed.
- Prepared-runtime construction and the same three compiled suites passed all
  102 cases. CLI package shape, docs, workspace boundaries, and package-cycle
  checks passed.
- Production bundle assembly and all eight parity probes passed after the
  integration. Vault CLI is 9,467,768 of 9,477,676 bytes; the runner is
  11,277,949 of 11,393,617 bytes.
- After the owner deletion, `pnpm exec vitest run
  packages/cli/test/food-save-typed-parity.test.ts` passed all 18 tests,
  including nested repair paths and no-write behavior. The same run exposed and
  corrected a stale assertion so provider schema failures match their retained
  fieldless runtime contract.
- Current-main integration retained nutrition's domain owners while accepting
  the foundation's post-merge prompt ceiling. The nutrition/provider/protocol
  matrix passed 85 tests; assistant model behavior passed 74 tests; the bundle
  boundary passed 14 tests; and Core, Vault use-cases, and CLI typechecks passed.
- Prepared-runtime construction and CLI package-shape verification passed. The
  regenerated skill hash is `b54adadf9486f94c`.
- Canonical production assembly passed all eight parity probes. Vault CLI is
  9,493,848 of 9,510,683 bytes, with an 805-byte entry and 25,155-byte static
  startup closure. The runner is 11,321,071 of 11,393,617 bytes, with a
  1,748,948-byte entry and 8,641,800-byte static boot closure.
