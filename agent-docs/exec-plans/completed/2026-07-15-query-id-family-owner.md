# Canonical lookup ID family owner

Status: completed
Created: 2026-07-15
Updated: 2026-07-15

## Goal

- Put static lookup-ID family classification in one lower package owner and delete the drifted query/vault-usecases duplication.

## Success criteria

- Contracts owns the canonical static family catalog and lookup classification helpers.
- Query retains event/display identity derivation while reusing the lower owner.
- Vault-usecases deletes its duplicate family registry and correctly classifies habitat IDs.
- Health descriptor precedence and special/non-queryable ID behavior remain unchanged.
- Package exports, boundary checks, tests, and typechecks are green.

## Scope

- In scope: the existing query and vault-usecases ID-family modules/callers, a narrow contracts owner/export, focused tests, plan and ledger.
- Out of scope: record storage formats, query result rendering beyond family classification, generic registries, and unrelated ID schemes.

## Constraints

- Keep workspace dependencies one-way and use public package entrypoints.
- Move only static classification; keep query-specific display identity local.
- Preserve `core`, `current`, `journal:`, `xfm_`, `pack_`, and health-descriptor semantics.

## Risks and mitigations

1. Risk: moving exports changes public import behavior.
   Mitigation: preserve query's existing public surface through a lower-owner re-export where needed and run package boundary/type checks.
2. Risk: order-dependent health classification changes.
   Mitigation: port exact precedence tests before deleting the duplicate catalog.
3. Risk: habitat IDs remain generic in vault-usecases.
   Mitigation: add direct regression coverage for affected link builders/classifiers.

## Tasks

1. Inspect current contracts family owners and select the smallest compatible home.
2. Move static lookup classification and update public exports.
3. Delete the vault-usecases duplicate and update callers.
4. Add focused parity and habitat regression tests.
5. Run scoped verification and the required coverage-write audit.
6. Archive this plan, commit, publish a draft PR, and run PR review gates.

## Decisions

- Contracts is the lower shared owner because both consumers already depend on it.
- Query remains responsible for event display-ID derivation.

## Verification

- `pnpm test:diff packages/contracts packages/query packages/vault-usecases`
- Required write-capable `coverage-write` audit.
- ReviewGPT and PR CI on the exact pushed head.
Completed: 2026-07-15
