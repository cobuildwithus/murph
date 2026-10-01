# Preserve Garmin canary secrets during private executor migration

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Preserve the five existing dedicated Garmin canary credentials, especially its
stable Junction identity key, when provisioning the private executor. Plaintext
must remain inside the protected source GitHub job.

## Success criteria

- Only current protected main can seal the fixed five source Environment values.
- The recipient Environment and its public encryption key are reviewed constants.
- Real sealed-box tests prove exact UTF-8 preservation, recipient confidentiality,
  ciphertext integrity, strict admission, bounded output, and content-free errors.
- Operator import and cleanup remain separate from this code-only task.

## Scope

- In scope: disposable source workflow, credential-free PR proof, standard PyNaCl
  sealing script, synthetic tests, narrow security exception and operator procedure.
- Out of scope: provider calls, secret value retrieval, imports, workflow dispatch,
  deployment, account changes, new tokens, or ordinary canary artifact policy.

## Risks and mitigations

- Recipient substitution: pin recipient key and destination in reviewed code;
  accept no workflow inputs or CLI arguments.
- Credential disclosure: scope secrets to the seal step, validate before output,
  use standard SealedBox, emit only a bounded recipient-encrypted capsule.
- Identity drift: preserve all value bytes and prohibit identity-key regeneration.
- Wrong artifact or partial import: require exact successful run provenance and
  fixed schema; operator confirms every write before provider execution.
- Temporary state surviving migration: one-day ciphertext retention, immediate
  operator artifact deletion, and removal of workflow/script/proof after import.

## Tasks

1. Confirm the private Environment public key without reading secret values.
2. Implement fixed-recipient sealing and admitted manual workflow.
3. Prove cryptography, workflow authority, privacy, and type correctness.
4. Document scoped migration and hand off a draft PR for parent review/execution.

## Decisions

- Reuse Ubuntu signed PyNaCl and GitHub's documented sealed-box format; introduce
  no application crypto owner or repository dependency.
- Export a single short-lived ciphertext artifact; no ciphertext in logs and no
  cross-repository credential on the source runner.
- Internal provisioning change only; no product UX or changelog change.

## Verification

- Focused proof: 14 synthetic tests passed using real PyNaCl 1.5.0.
- Strict mypy source typecheck passed; actionlint passed for both workflows.
- Scoped privacy and diff checks passed; docs drift and gardening passed with zero issues.
- Parent owns ReviewGPT, exact-head CI, dispatch, ciphertext import, and cleanup.
  No real secrets were read or transferred during implementation.
Completed: 2026-09-10
