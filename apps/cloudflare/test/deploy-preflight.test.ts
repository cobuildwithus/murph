import { describe, expect, it } from "vitest";

import {
  assertHostedDeployEnvironment,
  listMissingHostedDeployEnvironment,
  parseDeployWorkerFlag,
} from "../src/deploy-preflight.js";

describe("deploy preflight helpers", () => {
  it("requires the base deploy environment regardless of deploy mode", () => {
    expect(listMissingHostedDeployEnvironment({}, { deployWorker: false })).toEqual([
      "CF_WORKER_NAME",
      "CF_BUNDLES_BUCKET",
      "CF_BUNDLES_PREVIEW_BUCKET",
    ]);
  });

  it("requires CF_PUBLIC_BASE_URL when deploy_worker is enabled", () => {
    expect(listMissingHostedDeployEnvironment({
      CF_BUNDLES_BUCKET: "bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "bundles-preview",
      CF_WORKER_NAME: "hosted-runner",
    }, { deployWorker: true })).toEqual(["CF_PUBLIC_BASE_URL"]);
  });

  it("allows config-only runs without CF_PUBLIC_BASE_URL", () => {
    expect(() => assertHostedDeployEnvironment({
      CF_BUNDLES_BUCKET: "bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "bundles-preview",
      CF_WORKER_NAME: "hosted-runner",
    }, { deployWorker: false })).not.toThrow();
  });

  it("treats whitespace-only values as missing", () => {
    expect(() => assertHostedDeployEnvironment({
      CF_BUNDLES_BUCKET: "bundles",
      CF_BUNDLES_PREVIEW_BUCKET: "   ",
      CF_PUBLIC_BASE_URL: "   ",
      CF_WORKER_NAME: "hosted-runner",
    }, { deployWorker: true })).toThrowError(
      "Missing required GitHub environment variables for deploy workflow: CF_BUNDLES_PREVIEW_BUCKET CF_PUBLIC_BASE_URL",
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
