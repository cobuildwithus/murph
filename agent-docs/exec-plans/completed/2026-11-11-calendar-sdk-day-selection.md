# Normalize SDK intervals before calendar day selection

Status: completed
Created: 2026-11-11
Updated: 2026-11-11

## Goal

Complete sparse calendar repair when the installed provider SDK decodes interval endpoints into Date objects.

## Evidence and cause

Bounded finite production diagnostics show a direct record rejected for an adjacent source-local day on the deployed selection runtime. The installed SDK returns Date endpoints. Selection reads strings, retains the row as incomplete, then the existing snapshot sanitizer converts Dates into strings and strict validation rejects the adjacent day. A synthetic grouped SDK response reproduces that exact composed path. Earlier fixtures omitted required SDK fields and exercised its raw-response fallback instead.

## Scope and constraints

Use the existing timestamp normalizer at selection only. Preserve string semantics, malformed guards, complete collection budgets, foreground yields, source identity and canonical ownership. Do not change acceptance, provider authentication, production data, or retry policy. No new dependencies or state. User explicitly waived ReviewGPT; parent review and exact-head CI remain required.

## Tasks

1. Prove valid SDK-decoded adjacent and target-day intervals through the composed provider/importer path.
2. Correct endpoint reading at selection; retain strict malformed and partial collection proof.
3. Run focused tests, affected typechecks, complexity and parent review; close plan and open scoped PR.
4. Merge after required CI and deploy through the protected owner; continue the existing observation run.

## Product UX

Ready when SDK-decoded records produce the same daily state as string records, without reconnect or manual replay. No foreground UI or assistant prompt change.

## Verification

- New composed SDK regression must fail before the correction and pass afterward.
- Existing calendar collection suite covers partial/unavailable/malformed/foreground cases.
- Importer selection and provider suites plus importer/device-sync typechecks.
- No production rows or identifiers used in tests or artifacts.

## Results

- Composed grouped SDK fixture reproduced direct before/before day rejection on the prior code. A desired-success regression failed before the patch.
- Seven SDK regression cases now prove Date decoding, empty and populated target days at positive/negative offsets, strict reversed-interval rejection, and mixed Date/string endpoint alias precedence. Calendar/client suites: 66 passed. Importer suites: 272 passed. Changelog render: 4 passed.
- Importer and device-sync typechecks pass. Complexity adds no debt. Parent review confirms only Date endpoint resolution changes; source admission, complete collection, malformed validation, canonical publication and foreground yields retain their existing owners.
- Existing public daily-total recovery entry updated; no new UI or prompt flow. No external calls or latency added.
- Production recovery remains pending reviewed release and natural affected-resource traffic. Existing temporary observation follows the admitted run.
Completed: 2026-11-11
