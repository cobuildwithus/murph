---
title: 'Vault validation rejects valid clinical FHIR manifests and nested page references'
severity: 'minor'
---

## Expected Behavior

A clinical FHIR snapshot accepted by the clinical manifest schema and canonical importer should retain valid provenance when checked by validateVault.

## Current Behavior

The generic raw validator treats clinical manifests as murph.raw-import-manifest.v1 and expects another manifest beside each nested resource page. It emits RAW_MANIFEST_INVALID for valid clinical evidence. Recovering more source-backed records increases repeated validator findings without changing the underlying source bytes.

## Minimal Reproducible Example

Initialize a synthetic vault. Write a valid murph.clinical-raw-manifest.v2 snapshot at raw/clinical/fhir/connection-1/run-1/manifest.json, with a hash-bound Observation/page-1.json containing one patient-bound, dated final observation. Build its plan through buildClinicalImportPlanFromSnapshot and apply it through importEventBatch. validateVault passes before the snapshot and fails afterward with generic manifest-schema and nested-directory manifest errors.

## Possible Solution

Route clinical raw manifests and page references through their existing clinical contract and immutable manifest bindings, rather than applying the generic import manifest schema or looking for a manifest in every resource-type subdirectory.

## Context

This prevents whole-vault validation from distinguishing valid clinical import recovery from broken raw provenance. Focused clinical attestation and canonical readback remain necessary until the validator recognizes the clinical owner.
