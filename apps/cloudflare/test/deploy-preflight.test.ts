import { describe, expect, it } from "vitest";

import {
  assertHostedDeployEnvironment,
  listMissingHostedDeployEnvironment,
  parseDeployWorkerFlag,
} from "../scripts/deploy-preflight.js";

describe("deploy preflight helpers", () => {
  it("requires the base deploy environment regardless of deploy mode", () => {
    expect(listMissingHostedDeployEnvironment({}, { deployWorker: false })).toEqual([
      "CF_WORKER_NAME",
      "CF_BUNDLES_BUCKET",
      "CF_BUNDLES_PREVIEW_BUCKET",
    ]);
  });

  it("requires the worker public URL plus hosted web OIDC validation env when deploy_worker is enabled", () => {
    expect(listMissingHostedDeployEnvironment({
      CF_BUNDLES_BUCKET: "bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "bundles-preview",
      CF_WORKER_NAME: "hosted-runner",
    }, { deployWorker: true })).toEqual([
      "CF_PUBLIC_BASE_URL",
      "HOSTED_WEB_BASE_URL",
      "HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG",
      "HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME",
      "HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY",
      "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK",
      "HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK",
      "HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK",
      "HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK",
    ]);
  });

  it("does not require worker-only secrets for config-only runs", () => {
    expect(listMissingHostedDeployEnvironment({
      CF_BUNDLES_BUCKET: "bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "bundles-preview",
      CF_WORKER_NAME: "hosted-runner",
    }, { deployWorker: false })).toEqual([]);
  });

  it("allows config-only runs without CF_PUBLIC_BASE_URL", () => {
    expect(() => assertHostedDeployEnvironment({
      CF_BUNDLES_BUCKET: "bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "bundles-preview",
      CF_WORKER_NAME: "hosted-runner",
    }, { deployWorker: false })).not.toThrow();
  });

  it("requires BRAVE_API_KEY when hosted search is pinned to brave", () => {
    expect(() => assertHostedDeployEnvironment({
      CF_BUNDLES_BUCKET: "bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "bundles-preview",
      CF_PUBLIC_BASE_URL: "https://worker.example.test",
      CF_WORKER_NAME: "hosted-runner",
      HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK: "{\"kty\":\"OKP\",\"crv\":\"X25519\",\"d\":\"secret\",\"x\":\"public\"}",
      HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK: "{\"kty\":\"OKP\",\"crv\":\"X25519\",\"x\":\"public\"}",
      HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "ZW5jcnlwdGlvbi1rZXktMzItYnl0ZXMtbG9uZy1leGFtcGxlIQ==",
      HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK: "{\"kty\":\"OKP\",\"crv\":\"X25519\",\"x\":\"recovery\"}",
      HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: "murph-web",
      HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: "murph-team",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"public-x\",\"y\":\"public-y\",\"d\":\"private-d\"}",
      HOSTED_WEB_BASE_URL: "https://web.example.test",
      MURPH_WEB_SEARCH_PROVIDER: "brave",
    }, { deployWorker: true })).toThrowError(
      "Missing required GitHub environment variables for deploy workflow: BRAVE_API_KEY",
    );
  });

  it("allows brave-hosted search when the matching secret is present", () => {
    expect(() => assertHostedDeployEnvironment({
      BRAVE_API_KEY: "brave-secret",
      CF_BUNDLES_BUCKET: "bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "bundles-preview",
      CF_PUBLIC_BASE_URL: "https://worker.example.test",
      CF_WORKER_NAME: "hosted-runner",
      HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PRIVATE_JWK: "{\"kty\":\"OKP\",\"crv\":\"X25519\",\"d\":\"secret\",\"x\":\"public\"}",
      HOSTED_EXECUTION_AUTOMATION_RECIPIENT_PUBLIC_JWK: "{\"kty\":\"OKP\",\"crv\":\"X25519\",\"x\":\"public\"}",
      HOSTED_EXECUTION_PLATFORM_ENVELOPE_KEY: "ZW5jcnlwdGlvbi1rZXktMzItYnl0ZXMtbG9uZy1leGFtcGxlIQ==",
      HOSTED_EXECUTION_RECOVERY_RECIPIENT_PUBLIC_JWK: "{\"kty\":\"OKP\",\"crv\":\"X25519\",\"x\":\"recovery\"}",
      HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: "murph-web",
      HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: "murph-team",
      HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "{\"kty\":\"EC\",\"crv\":\"P-256\",\"x\":\"public-x\",\"y\":\"public-y\",\"d\":\"private-d\"}",
      HOSTED_WEB_BASE_URL: "https://web.example.test",
      MURPH_WEB_SEARCH_PROVIDER: "brave",
    }, { deployWorker: true })).not.toThrow();
  });

  it("does not require BRAVE_API_KEY for config-only runs even when hosted search is pinned to brave", () => {
    expect(listMissingHostedDeployEnvironment({
      CF_BUNDLES_BUCKET: "bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "bundles-preview",
      CF_WORKER_NAME: "hosted-runner",
      MURPH_WEB_SEARCH_PROVIDER: "brave",
    }, { deployWorker: false })).toEqual([]);
  });

  it("treats whitespace-only values as missing", () => {
    expect(() => assertHostedDeployEnvironment({
      CF_BUNDLES_BUCKET: "bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "   ",
      CF_PUBLIC_BASE_URL: "   ",
      CF_WORKER_NAME: "hosted-runner",
      HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME: "   ",
      HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG: "   ",
      HOSTED_WEB_BASE_URL: "   ",
    }, { deployWorker: true })).toThrowError(
      "Missing required GitHub environment variables for deploy workflow: CF_BUNDLES_PREVIEW_BUCKET CF_PUBLIC_BASE_URL HOSTED_WEB_BASE_URL HOSTED_EXECUTION_VERCEL_OIDC_TEAM_SLUG HOSTED_EXECUTION_VERCEL_OIDC_PROJECT_NAME",
    );
  });

  it("parses truthy deploy-worker flag values", () => {
    expect(parseDeployWorkerFlag("true")).toBe(true);
    expect(parseDeployWorkerFlag("1")).toBe(true);
    expect(parseDeployWorkerFlag("yes")).toBe(true);
    expect(parseDeployWorkerFlag(" false ")).toBe(false);
    expect(parseDeployWorkerFlag(undefined)).toBe(false);
  });
});
