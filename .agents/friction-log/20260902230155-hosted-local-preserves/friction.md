---
title: 'Hosted-local preserves legacy invalid KMS key-version state'
severity: 'minor'
---

## Expected Behavior

Starting the hosted-local stack migrates persisted local authority state from legacy non-numeric key-version names to the current exact KMS resource-name format while preserving verification compatibility.

## Current Behavior

A persisted legacy local key-version name remains active after the repository adopts numeric KMS key versions. The first operation that signs a hosted domain-root envelope then fails, and local native admission cannot complete until the ignored crypto-state file is manually removed.

## Possible Solution

Derive the active local key version deterministically from the preserved public key on every startup, while retaining the legacy keyring entry as verify-only. Continue reading externally supplied key versions only when remote hosted crypto keys are explicitly enabled.

## Minimal Reproducible Example

Persist a matching local authority private/public key pair with an active key-version name ending in a non-numeric legacy suffix. Pass that state to mergeCloudflareLocalEnv, then call the local KMS signer with the returned active version.

## Context

This blocks a clean hosted-local signup after upgrading an existing development checkout and forces deletion of otherwise valid local crypto state.
