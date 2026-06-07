import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildPackageManagerProcessEnv,
  createPackageManagerProcessEnv,
} from "../scripts/runner-bundle/process.js";

describe("runner bundle package-manager process env", () => {
  it("keeps explicit env injection while dropping ambient deploy secrets and config", () => {
    const env = buildPackageManagerProcessEnv(
      {
        COREPACK_ENABLE_AUTO_PIN: "0",
        HTTPS_PROXY: "http://explicit-proxy.example.test",
        NODE_ENV: "production",
      },
      {
        CF_API_TOKEN: "cloudflare-secret",
        COREPACK_ENABLE_PROJECT_SPEC: "1",
        COREPACK_HOME: "/tmp/corepack",
        HOME: "/tmp/home",
        HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "callback-secret",
        HTTPS_PROXY: "http://ambient-proxy.example.test",
        NPM_CONFIG_CACHE: "/tmp/npm-cache",
        NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
        OPENAI_API_KEY: "model-secret",
        PATH: "/usr/bin",
        PNPM_STORE_DIR: "/tmp/pnpm-store",
        npm_config_cache: "/tmp/npm-cache-lower",
      },
    );

    expect(env).toMatchObject({
      COREPACK_ENABLE_AUTO_PIN: "0",
      HTTPS_PROXY: "http://explicit-proxy.example.test",
      NODE_ENV: "production",
      PATH: "/usr/bin",
    });
    expect(env).not.toHaveProperty("CF_API_TOKEN");
    expect(env).not.toHaveProperty("COREPACK_ENABLE_PROJECT_SPEC");
    expect(env).not.toHaveProperty("COREPACK_HOME");
    expect(env).not.toHaveProperty("HOME");
    expect(env).not.toHaveProperty("HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK");
    expect(env).not.toHaveProperty("NPM_CONFIG_CACHE");
    expect(env).not.toHaveProperty("NPM_CONFIG_REGISTRY");
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
    expect(env).not.toHaveProperty("PNPM_STORE_DIR");
    expect(env).not.toHaveProperty("npm_config_cache");
  });

  it("uses an isolated package-manager home while reusing configured package-manager caches", async () => {
    const processEnv = await createPackageManagerProcessEnv(
      {
        COREPACK_ENABLE_AUTO_PIN: "0",
      },
      {
        COREPACK_ENABLE_PROJECT_SPEC: "1",
        COREPACK_HOME: "/tmp/corepack",
        HOME: "/tmp/home",
        NPM_CONFIG_CACHE: "/tmp/npm-cache",
        PATH: "/usr/bin",
        PNPM_STORE_DIR: "/tmp/pnpm-store",
        XDG_CONFIG_HOME: "/tmp/config",
        npm_config_cache: "/tmp/npm-cache-lower",
      },
    );

    try {
      const { env } = processEnv;
      expect(env).toMatchObject({
        COREPACK_ENABLE_AUTO_PIN: "0",
        PATH: "/usr/bin",
      });
      expect(env.HOME).toEqual(expect.stringContaining("murph-package-manager-env-"));
      expect(env.HOME).not.toBe("/tmp/home");
      expect(env.USERPROFILE).toBe(env.HOME);
      expect(env.COREPACK_ENABLE_PROJECT_SPEC).toBeUndefined();
      expect(env.COREPACK_HOME).toBe("/tmp/corepack");
      expect(env.NPM_CONFIG_CACHE).toBe(path.join(env.HOME ?? "", "cache", "npm"));
      expect(env.NPM_CONFIG_CACHE).not.toBe("/tmp/npm-cache");
      expect(env.PNPM_STORE_DIR).toBe("/tmp/pnpm-store");
      expect(env.XDG_CONFIG_HOME).toBe(path.join(env.HOME ?? "", "config"));
      expect(env.NPM_CONFIG_USERCONFIG).toBe(path.join(env.HOME ?? "", ".npmrc"));
      expect(env.npm_config_cache).toBe(env.NPM_CONFIG_CACHE);
      expect(env.npm_config_store_dir).toBe(env.PNPM_STORE_DIR);
      expect(env.npm_config_userconfig).toBe(env.NPM_CONFIG_USERCONFIG);
    } finally {
      await processEnv.cleanup();
    }
  });

  it("derives reusable Corepack and pnpm caches from the parent environment", async () => {
    const processEnv = await createPackageManagerProcessEnv(
      undefined,
      {
        HOME: "/tmp/home",
        PATH: process.env.PATH,
      },
    );

    try {
      const tempHome = processEnv.env.HOME ?? "";
      expect(processEnv.env.COREPACK_HOME).toBe(
        path.join("/tmp/home", ".cache", "node", "corepack"),
      );
      expect(processEnv.env.PNPM_STORE_DIR).toEqual(expect.any(String));
      expect(processEnv.env.PNPM_STORE_DIR).not.toContain(tempHome);
      expect(processEnv.env.npm_config_store_dir).toBe(processEnv.env.PNPM_STORE_DIR);
      expect(tempHome).not.toBe("/tmp/home");
    } finally {
      await processEnv.cleanup();
    }
  });
});
