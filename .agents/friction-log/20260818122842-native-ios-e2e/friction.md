---
title: 'Native iOS E2E docs omit the custom-environment OIDC subject'
severity: 'major'
---

## Expected Behavior

The native iOS E2E provisioning contract names the dedicated Vercel project's exact `environment:native-ios-e2e` OIDC subject, its isolated preview Workload Identity provider and service account, and the preview-only KMS keyring before the first live sweep.

## Current Behavior

The live owner docs require production-shaped crypto variables but do not identify the non-production federation binding. The dedicated candidate can therefore build successfully, authenticate through Privy, and then fail companion admission when hosted crypto attempts its first KMS operation.

## Possible Solution

Document the exact least-privilege boundary: Vercel custom environments use their named environment in the OIDC subject, so the dedicated project's `environment:native-ios-e2e` subject must be accepted by the preview Workload Identity provider and bound only to the preview crypto service account. The service account must retain key-level encrypt/decrypt and signer roles on the preview keyring. Add a names-only preflight that compares Vercel's reported subject with both Google bindings before creating an expensive candidate deployment.

## Minimal Reproducible Example

1. Configure the dedicated Vercel custom environment with the preview hosted-crypto variables.
2. Configure the Workload Identity provider and service-account binding for the generic `environment:preview` subject instead of Vercel's reported named custom-environment subject.
3. Run the native iOS hosted E2E lane.
4. Observe the candidate build and OTP authentication succeed, followed by a hosted crypto provider error on companion admission.

## Context

The first complete live sweep spent a full hosted build and native simulator run before exposing a deterministic infrastructure authorization gap. The coarse native stage summary initially mislabeled the failure as onboarding, increasing diagnosis time.
