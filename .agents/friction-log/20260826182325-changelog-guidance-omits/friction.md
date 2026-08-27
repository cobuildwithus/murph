---
title: 'Changelog guidance omits structured tryIt schema'
severity: 'minor'
---

## Expected Behavior

The changelog skill or fragment README documents the accepted object shape for the optional tryIt field, with one valid synthetic example.

## Current Behavior

The guidance explains when tryIt is appropriate but not its required structure. A string value appears reasonable and passes JSON parsing, then changelog generation fails with a type error saying the field must be an object.

## Possible Solution

Add the current tryIt object schema and a minimal valid fragment example to the changelog README or skill.

## Minimal Reproducible Example

Add a changelog fragment with an item whose tryIt value is a string, then run pnpm --dir apps/web changelog:generate.

## Context

This interrupted a member-visible changelog update after the entry was otherwise complete. The optional field was removed because it was not required for the release claim.
