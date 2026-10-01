# Vault CLI Error Single-Owner Retrospective

Status: completed
Owner: Codex
Started: 2026-08-24

## Requirement

Return one privacy-safe, parseable Vault CLI error envelope with a stable code,
truthful retryability, and bounded value-free guidance sufficient to correct a
supported request. Recover validation guidance only from information already
owned by supported commands, classify fixed root failures without exposing raw
context, and preserve native Incur validation behavior.

## First-Reviewed Versus Current Concepts

- The first-reviewed shape added a public `VaultCliRepair*` value family,
  `createVaultCliRepair`, a fourth `VaultCliError` constructor argument, and an
  explicit-repair precedence branch. Supported validation owners did not write
  that channel, so ordinary failures remained generic.
- Review remediation added a bounded `context.issues` derivation path, shared
  setup/main projection, Incur serializer proof, model guidance, and journey
  regressions. That fixed the behavior but left two sources for the same
  model-facing recovery information.
- The current PR is 833 changed lines and 10 files larger than the immutable
  first-reviewed shape, while authored-source churn grew by 36 lines. Tests and
  transport proof explain most growth; the repeated mechanism is the unresolved
  dual source, not total source size.

## Decision

Redesign by deletion. `VaultCliError.context` is the sole metadata source.
Remove the public repair types, helper, property, fourth constructor argument,
and precedence branch. The shared operator-config projector derives bounded
field errors only from allowlisted Zod-like `context.issues`; raw Zod errors use
the same mapper. Fixed filesystem and root classifications return final
projections directly instead of round-tripping through a repair-bearing error.

Retain the shared setup/main owner, dependency serializer, compact model
guidance, and regression surface because each directly proves the current
experience. Keep the separate Mapbox domain unchanged.

## Regression Proof

- Operator projection: issue allowlist, cap and omitted count, path
  normalization, raw-message/value exclusion, raw Zod parity, and direct fixed
  filesystem/root projections.
- Product journeys: workout, scheduled-log, and blood-test validation; setup
  parity; pre-serve and served direct versus explicit `--full-output` behavior.
- Transport: Incur fetch, serve, execution, and streaming preserve the same
  bounded envelope while native Incur validation remains unchanged.
- Boundaries: affected typechecks, CLI package shape, workspace boundaries,
  prompt measurement and ratchet, production runner bundle/parity, privacy and
  diff scans.

## Constraints

- Do not add a replacement repair abstraction, state owner, or generic context
  serializer.
- Do not push or mutate PR metadata until parent inspection of the exact local
  diff and evidence.

## Progress

- Deleted the public repair value family, helper, error property, fourth
  constructor argument, precedence branch, and error round-trip used only to
  recover fixed root guidance.
- The shared projection now derives validation fields only from allowlisted
  `context.issues` metadata and gives escaped raw Zod errors the same bounded
  treatment. Setup and main CLI bridges consume that one projection unchanged.
- Focused operator-config, setup, assistant, inbox seam, CLI/Incur, and
  Cloudflare runner-contract suites pass. All six affected package typechecks,
  CLI package shape, workspace boundaries, and dependency-cycle checks pass.
- The production Vault CLI bundle and every parity probe pass at 9,465,308 of
  9,467,648 bytes. The reviewed candidate was 9,467,564 bytes, so the redesign
  deletes 2,256 bundled bytes while leaving entry and static-startup budgets
  intact.
- Deterministic replacement in the same serialized provider-input instruction
  field reproduces the reviewed +87-token/+414-byte delta exactly. The compact
  final guidance is +49 `o200k_harmony` tokens/+199 UTF-8 bytes from base for
  both runtimes: individual 24,779 tokens/113,914 bytes; hosted group 21,198
  tokens/98,046 bytes. Tools and other provider-visible fields are unchanged.
- Targeted deleted-API, privacy, unsafe-cast, whitespace, and diff scans pass.
  No new Frog entry is needed because the only encountered focused-test cwd
  friction is already recorded by the existing package-test entry.
Updated: 2026-08-24
Completed: 2026-08-24
