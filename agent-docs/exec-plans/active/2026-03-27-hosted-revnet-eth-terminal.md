# Hosted RevNet ETH Terminal Refactor

Status: completed
Created: 2026-03-27
Updated: 2026-03-27

## Goal

- Refactor hosted onboarding RevNet issuance so paid Stripe subscription invoices fund the canonical co-build community terminal with native ETH instead of approving and paying an ERC-20 token.

## Success criteria

- Hosted RevNet env parsing no longer requires ERC-20 payment-token address/decimals and instead models the native ETH payment path cleanly.
- The hosted viem helper uses the exact `CobuildCommunityTerminal.pay(...)` surface reviewed in `v1-core`, sending `value` and the native-token sentinel expected by the terminal.
- Issuance persistence and webhook logic record ETH-native payment metadata without leaving misleading USDC/ERC-20 terminology in the write path.
- Existing invoice-level idempotency, confirmation gating, wallet forwarding, and hosted activation sequencing remain intact.
- Focused hosted onboarding tests cover the new ETH-native assumptions.

## Scope

- In scope:
  - hosted onboarding env parsing and `.env.example`
  - hosted onboarding RevNet viem helper and Stripe invoice issuance service
  - Prisma schema plus follow-up migration for ETH-native issuance metadata
  - focused hosted onboarding tests
- Out of scope:
  - protocol contract changes in `v1-core` unless inspection reveals a source-of-truth defect
  - chargeback/dispute clawback mechanics
  - donor route-selection metadata beyond preserving the current empty-metadata path

## Constraints

- Source-of-truth terminal behavior comes from sibling repo `v1-core`.
- Hosted issuance still only runs in Stripe `subscription` mode.
- Treasury wallet remains pre-funded onchain and now must hold native ETH for the pay call.
- Repo policy asks for delegated audit passes, but this session can only spawn subagents when the user explicitly authorizes them.

## Tasks

1. Review the community terminal ABI and native payment path in `v1-core`.
2. Replace hosted ERC-20 approval logic with a native ETH terminal pay helper.
3. Rename or reshape issuance persistence/env fields so stored data matches the native path.
4. Update focused tests and docs/runtime examples.
5. Run required checks, commit the touched files, and note the blocked delegated-audit requirement if still unauthorized.
