# Restore assistant ownership of reminder provenance reads

Status: active
Created: 2026-09-10
Updated: 2026-09-10

## Goal

- Restore assistant-engine ownership of outbox reads used to prove delivered
  experiment reminders, while preserving canonical occurrence and replay rules.

## Success criteria

- Vault usecases never open assistant-owned outbox files or import assistant-engine.
- Default and scoped CLI service composition use the public assistant outbox reader.
- Existing reminder acceptance, owner binding, planned occurrence, and replay tests pass.
- Focused tests, affected typechecks, boundary guards, required PR CI, and ReviewGPT pass.

## Scope

- In scope: typed service dependency, CLI composition, provenance and boundary proof.
- Out of scope: prompts, command schemas, delivery behavior, persisted formats, deployment.

## Constraints

- Keep dependencies acyclic and the trusted reader outside command JSON.
- Preserve ordinary experiment logging without an assistant dependency.
- Open a separate PR; do not merge or deploy.

## Risks and mitigations

1. A composition path omits the reader.
   Mitigation: wire default and scoped CLI factories and test composed provenance reads.
2. Untrusted input substitutes delivery proof.
   Mitigation: retain intent and occurrence validation; test forged JSON and missing readers.

## Tasks

1. Confirm current consumer and outbox owner paths.
2. Pass the typed trusted reader through existing lazy service factories.
3. Migrate provenance proof to composed CLI tests and add lower-level denial tests.
4. Run focused verification, inspect the candidate, and open a draft PR.
5. Mark Ready and run ReviewGPT concurrently with required CI; resolve eligible failures.

## Decisions

- Reuse `readAssistantOutboxIntent` through a lazy CLI-owned callback.
- Keep experiment-specific validation in vault usecases; do not add a reverse dependency.
- No member-visible behavior or provider input change is intended.

## Verification

- Passed: CLI provenance and wiring (8 tests), lower usecase provenance (5 tests),
  and architecture guards (3 tests).
- Passed: vault-usecases and CLI typechecks; workspace boundary and cycle guards;
  docs drift; diff whitespace and privacy review; `pnpm complexity:diff`.
- Confirmed: unchanged canonical effects, one lookup per reminder attempt, no lookup
  for ordinary logging, and fail-closed missing or mismatched owner evidence.
- Existing complexity hotspots are unchanged; the new owner forwarding adds no
  product branches to the canonical experiment writer.
- Pending: pushed candidate, required PR CI, and final ReviewGPT.
