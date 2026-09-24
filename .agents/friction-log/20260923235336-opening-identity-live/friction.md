---
title: 'Opening identity live proof inherits local delegation policy'
severity: 'minor'
---

## Expected Behavior

The focused opening identity journey should exercise production delegation policy while retaining local subscription authentication.

## Current Behavior

The fixture enables native children but omits the hosted usage and mode hints. A subscription profile can therefore retain conflicting local delegation guidance. The model then uses the root identity fallback and the test fails before reaching the check-in assertions.

The same fixture supplies a real automation port while its composed instructions
default that capability to unavailable. Once delegation is aligned, the model
correctly obeys that contradictory availability statement and omits scheduling.

## Possible Solution

Derive the three delegation hints from the hosted configuration owner for this focused fixture without copying credentials or importing runtime implementation into Assistant Engine.

Also pass the real automation availability into the production prompt builder
and assert that its unavailable message is absent before the live run.

## Minimal Reproducible Example

Run the focused opening identity journey through a subscription profile whose native delegation mode prohibits unrequested children. Compare the configured hints with the hosted configuration owner.

## Context

This blocks faithful proof of an opening policy that explicitly requires a bounded background identity child.
