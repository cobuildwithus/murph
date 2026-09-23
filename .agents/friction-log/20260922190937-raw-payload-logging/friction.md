---
title: 'Raw payload logging guard rejects boolean presence checks'
severity: 'minor'
---

## Expected Behavior

The raw payload guard should accept a boolean presence comparison while still rejecting raw response objects.

## Current Behavior

A metadata-only log such as console.info({ completed: response !== undefined }) fails the guard because the expression references a variable named response. Assigning the identical boolean to a local completed variable before the log passes.

## Possible Solution

Recognize bounded comparison expressions that produce booleans without serializing the referenced object, with focused regression tests preserving raw payload rejection.

## Minimal Reproducible Example

Run findRawHealthLogPayloadMatches on synthetic TypeScript containing console.info({ completed: response !== undefined }). Compare its result with const completed = response !== undefined; console.info({ completed }).

## Context

This false positive blocked an internal timing-only change in the release verification lane. The task uses the explicit boolean local without weakening the guard.
