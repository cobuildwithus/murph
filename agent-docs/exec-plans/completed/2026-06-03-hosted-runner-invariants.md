# Hosted runner invariants

Status: completed
Created: 2026-06-03
Updated: 2026-06-03

## Goal

- Add explicit baseline invariants for the hosted Cloudflare runner boundary and warm hosted runtime reuse.

## Success criteria

- `docs/contracts/00-invariants.md` states that Cloudflare remains a thin execution runner over the Murph runtime rather than owning assistant or product logic.
- `docs/contracts/00-invariants.md` states that warm hosted containers should reuse the Node process, restored workspace root, and Codex App Server process across messages when authority and cleanup proof remain valid.
- The doc also states that warm reuse is an optimization and must fall back to cold restore/restart when safety cannot be proven.

## Scope

- In scope: text-only baseline invariant documentation.
- Out of scope: runtime implementation changes, tests for hosted execution code, and broader architecture doc rewrites.

## Constraints

- Technical constraints: keep the contract aligned with the existing architecture doc and do not invent new runtime ownership.
- Product/process constraints: preserve privacy guardrails and avoid exposing local identifiers in docs or commit output.

## Risks and mitigations

1. Risk: The invariant could overstate warm reuse as correctness authority.
   Mitigation: Make fallback and per-message authority validation explicit.

## Tasks

1. Update the invariants doc.
2. Read back the touched docs.
3. Close the plan and commit only this scoped docs change.

## Decisions

- Add a dedicated `Hosted Runner Boundary` section after hosted foreground priority.

## Verification

- Commands to run: direct Markdown readback.
- Expected outcomes: touched docs contain the new invariants and no repo-wide checks are required for text-only Markdown changes.
Completed: 2026-06-03
