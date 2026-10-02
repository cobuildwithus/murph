---
title: 'Synthetic Garmin persistence failures omit safe stage evidence'
severity: 'minor'
---

## Expected Behavior

A failed hosted synthetic-delivery proof should distinguish webhook admission, runtime execution, and replica publication without exposing credentials, account identifiers, health values, or raw errors.

## Current Behavior

The helper returns one closed failure code for every boundary. An acknowledgement-only timeout cannot show whether the runtime or any fresh replica was observed, so a full protected run must be repeated to locate the failing owner.

## Possible Solution

Report a fixed phase enum, boolean observations, and the number of completed status reads only when the proof fails. Preserve the existing strict persistence assertion and closed failure code.

## Minimal Reproducible Example

In the synthetic-delivery test, let the public ingress acknowledge a signed fixture and keep returning an unchanged replica until the deadline. The error is indistinguishable from failed user resolution or failed replica decryption.

## Context

The hosted connection journey is expensive; content-free diagnostic evidence is needed to investigate its composed ingestion proof.
