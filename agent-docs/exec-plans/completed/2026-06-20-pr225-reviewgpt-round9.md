# PR 225 ReviewGPT Round 9 Fix

## Goal

Fix the round 9 ReviewGPT finding: hosted email thread targets that parse but
contain no recipient must fail automation route validation before assistant work.

## Constraints

- Keep hosted/local route validation profile-driven.
- Parse hostedmail targets once during route validation.
- Reject undeliverable hosted email thread targets without widening ingress
  parsing or adding compatibility layers.

## Verification Plan

- Add a focused regression using a serialized hosted email target with `to: []`.
- Run focused operator-config tests and affected verification.
- Run required local review passes before commit if the change remains
  trust-boundary relevant.

## Progress

- Round 9 finding received from ReviewGPT.
- Route validator now rejects parsed hosted email thread targets without a primary recipient.
- Focused hosted and local profile regressions added.
- Focused operator-config test, operator-config typecheck, `test:diff`, whitespace/privacy checks, and local audit passes completed.
Status: completed
Updated: 2026-06-19
Completed: 2026-06-19
