---
title: 'Native iOS Vercel deploy test did not cover the strict request body'
severity: 'minor'
---

## Expected Behavior

The native iOS hosted E2E controller contract test should fail when its Vercel deployment payload contains a field rejected by the current strict create-deployment API.

## Current Behavior

The tests validate returned deployment identity but do not execute deployment creation or assert the exact request body. A removed optional field can therefore remain in the controller until the first live sweep returns HTTP 400.

## Possible Solution

Mock the provider boundary in the focused controller suite and assert the complete allowlisted request object, including the absence of legacy fields.

## Minimal Reproducible Example

Send a synthetic create-deployment request containing `public: false` to an endpoint whose schema uses `additionalProperties: false`; the request is rejected before a deployment is created even though the remaining Git source and custom-environment fields are valid.

## Context

This delayed activation of the protected hosted Web plus real native iOS acceptance lane and required another trusted-controller rollout before the private iOS workflow could run.
