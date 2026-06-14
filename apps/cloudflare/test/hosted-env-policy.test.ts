import { describe, expect, it } from "vitest";

import {
  HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES,
  isHostedAssistantApiKeyEnvName,
} from "@murphai/assistant-runtime/hosted-assistant-env";

import { buildHostedWorkerSecretsPayload } from "../scripts/deploy-automation/secrets.ts";
import {
  buildHostedRunnerContainerEnv,
  isHostedRunnerSecretKeyAllowed,
  summarizeHostedRunnerForwardedEnvLogCategories,
  summarizeHostedRunnerSecretLogCategories,
} from "../src/hosted-env-policy.ts";
import {
  HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL,
} from "../src/runner-egress-intercept.ts";

const requiredWorkerSecrets = {
  HOSTED_CRYPTO_CLOUDFLARE_AUTOMATION_PRIVATE_JWK: "automation-private",
  HOSTED_LOG_FINGERPRINT_SECRET: "log-fingerprint-secret",
  HOSTED_R2_PRESIGN_ACCESS_KEY_ID: "r2-access-fixture",
  HOSTED_R2_PRESIGN_SECRET_ACCESS_KEY: "r2-signing-fixture",
  HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK: "webhook-private",
  MURPH_DATA_API_KEY: "data-api-key",
  OPENAI_API_KEY: "openai-secret",
} satisfies Record<string, string>;
const requiredHostedAssistantProvider = {
  HOSTED_ASSISTANT_PROVIDER: "openai",
} as const;

describe("buildHostedRunnerContainerEnv", () => {
  it("does not forward legacy assistant api key selectors or unrelated referenced secrets", () => {
    const env = buildHostedRunnerContainerEnv({
      ...requiredHostedAssistantProvider,
      HOSTED_ASSISTANT_API_KEY_ENV: "STRIPE_SECRET_KEY",
      OPENAI_API_KEY: "openai-secret",
      STRIPE_SECRET_KEY: "stripe-secret",
    });

    expect(env.HOSTED_ASSISTANT_API_KEY_ENV).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBe(HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL);
    expect(env.STRIPE_SECRET_KEY).toBeUndefined();
  });

  it("includes shared allowed hosted assistant api key env names", () => {
    const env = buildHostedRunnerContainerEnv({
      ...requiredHostedAssistantProvider,
      OPENAI_API_KEY: "openai-secret",
    });

    expect(env.OPENAI_API_KEY).toBe(HOSTED_CLOUDFLARE_INJECTED_CREDENTIAL);
  });

  it("requires the direct OpenAI hosted assistant provider at the runner boundary", () => {
    expect(() =>
      buildHostedRunnerContainerEnv({
        OPENAI_API_KEY: "openai-secret",
      })
    ).toThrow("HOSTED_ASSISTANT_PROVIDER must be openai for hosted runner execution.");
  });

  it("forwards the dev-only ChatGPT subscription auth without credential interception", () => {
    const chatGptAuthJson = Buffer.from(
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: { access_token: "chatgpt-access-token" },
      }),
      "utf8",
    ).toString("base64url");
    const env = buildHostedRunnerContainerEnv({
      ...requiredHostedAssistantProvider,
      HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON: chatGptAuthJson,
      OPENAI_API_KEY: "openai-secret",
    });

    // Codex parses these JWTs client-side, so a placeholder swap cannot work;
    // the dev-only runtime consumes the value directly and NODE_ENV=development
    // gating in prepareHostedCodexRuntimeEnvironment keeps it out of prod.
    expect(env.HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON).toBe(chatGptAuthJson);
  });

  it("does not allow member runner secrets to set the ChatGPT subscription auth", () => {
    const source = {
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS:
        "HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON",
    };

    expect(isHostedRunnerSecretKeyAllowed(
      "HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON",
      source,
    )).toBe(false);
  });

  it("does not allow runner secrets to override hosted control-plane prefixes", () => {
    const source = {
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: [
        "CLOUDFLARE_IMAGES_ACCOUNT_ID",
        "CLOUDFLARE_IMAGES_API_KEY",
        "CLOUDFLARE_IMAGES_VARIANT",
        "HOSTED_CRYPTO_ENV",
        "HOSTED_WEB_CALLBACK_SIGNING_KEY_ID",
      ].join(","),
    };

    expect(isHostedRunnerSecretKeyAllowed(
      "CLOUDFLARE_IMAGES_ACCOUNT_ID",
      source,
    )).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed(
      "CLOUDFLARE_IMAGES_API_KEY",
      source,
    )).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed(
      "CLOUDFLARE_IMAGES_VARIANT",
      source,
    )).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed(
      "HOSTED_CRYPTO_ENV",
      source,
    )).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed(
      "HOSTED_WEB_CALLBACK_SIGNING_KEY_ID",
      source,
    )).toBe(false);
  });

  it("does not allow runner secrets to override image-pinned assistant asset roots", () => {
    const source = {
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: [
        "MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH",
        "MURPH_ASSISTANT_SKILLS_ROOT",
      ].join(","),
    };

    expect(isHostedRunnerSecretKeyAllowed("MURPH_ASSISTANT_SKILLS_ROOT")).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed(
      "MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH",
    )).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("MURPH_ASSISTANT_SKILLS_ROOT", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed(
      "MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH",
      source,
    )).toBe(false);
  });

  it("keeps the worker-side asset-root literals aligned with the engine-owned env names", async () => {
    // hosted-env-policy.ts is part of the workerd bundle and must not import
    // @murphai/assistant-engine (Node-only module graph), so it pins the two
    // deny-listed names as literals. This node-side test imports only the
    // zero-dependency env-name contract.
    const { MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH_ENV, MURPH_ASSISTANT_SKILLS_ROOT_ENV } =
      await import("@murphai/assistant-engine/assistant-skill-env");
    expect(MURPH_ASSISTANT_SKILLS_ROOT_ENV).toBe("MURPH_ASSISTANT_SKILLS_ROOT");
    expect(MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH_ENV).toBe(
      "MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH",
    );
    expect(isHostedRunnerSecretKeyAllowed(MURPH_ASSISTANT_SKILLS_ROOT_ENV)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed(MURPH_ASSISTANT_CLI_SURFACE_PREBUILT_ARTIFACT_PATH_ENV)).toBe(false);
  });

  it("does not allow runner secrets to override process environment keys", () => {
    const source = {
      HOSTED_EXECUTION_ALLOWED_RUNNER_SECRET_KEYS: [
        "CODEX_HOME",
        "CODEX_CA_CERTIFICATE",
        "CURL_CA_BUNDLE",
        "HTTPS_PROXY",
        "NODE_EXTRA_CA_CERTS",
        "NPM_CONFIG_USERCONFIG",
        "REQUESTS_CA_BUNDLE",
        "SSL_CERT_FILE",
        "TMPDIR",
      ].join(","),
    };

    expect(isHostedRunnerSecretKeyAllowed("CODEX_CA_CERTIFICATE", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("CODEX_HOME", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("CURL_CA_BUNDLE", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("HTTPS_PROXY", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("NODE_EXTRA_CA_CERTS", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("NPM_CONFIG_USERCONFIG", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("REQUESTS_CA_BUNDLE", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("SSL_CERT_FILE", source)).toBe(false);
    expect(isHostedRunnerSecretKeyAllowed("TMPDIR", source)).toBe(false);
  });
});

describe("hosted runner log categories", () => {
  it("preserves the forwarded env category summaries used by runner logging", () => {
    expect(summarizeHostedRunnerForwardedEnvLogCategories({
      TELEGRAM_BOT_USERNAME: "murph_bot",
      OPENAI_API_KEY: "openai-secret",
    })).toEqual({
      assistantConfigured: true,
      hostedEmailConfigured: false,
      linqConfigured: false,
      telegramConfigured: true,
      whatsappConfigured: false,
    });
  });

  it("preserves the runner secret category summaries used by runner logging", () => {
    expect(summarizeHostedRunnerSecretLogCategories({
      CUSTOM_API_KEY: "custom-secret",
      OPENAI_API_KEY: "openai-secret",
    })).toEqual({
      modelCredentialConfigured: true,
    });
  });
});

describe("buildHostedWorkerSecretsPayload", () => {
  it("keeps only worker-owned hosted secrets and the Codex OpenAI provider secret in the worker payload", () => {
    const payload = buildHostedWorkerSecretsPayload({
      ...requiredWorkerSecrets,
      CLOUDFLARE_IMAGES_API_KEY: "cloudflare-images-token",
      OLLAMA_API_KEY: "ollama-secret",
      VERCEL_AI_API_KEY: "vercel-secret",
    });

    expect(payload.CLOUDFLARE_IMAGES_API_KEY).toBe("cloudflare-images-token");
    expect(payload.OLLAMA_API_KEY).toBeUndefined();
    expect(payload.HOSTED_LOG_FINGERPRINT_SECRET).toBe("log-fingerprint-secret");
    expect(payload.OPENAI_API_KEY).toBe("openai-secret");
    expect(payload.VERCEL_AI_API_KEY).toBeUndefined();
  });

  it("does not include unrelated referenced secrets", () => {
    const payload = buildHostedWorkerSecretsPayload({
      ...requiredWorkerSecrets,
      HOSTED_ASSISTANT_API_KEY_ENV: "STRIPE_SECRET_KEY",
      STRIPE_SECRET_KEY: "stripe-secret",
    });

    expect(payload.STRIPE_SECRET_KEY).toBeUndefined();
  });

});

describe("isHostedAssistantApiKeyEnvName", () => {
  it("accepts only the shared hosted assistant provider env names", () => {
    expect(isHostedAssistantApiKeyEnvName("OPENAI_API_KEY")).toBe(true);
    expect(isHostedAssistantApiKeyEnvName("VERCEL_AI_API_KEY")).toBe(false);
    expect(isHostedAssistantApiKeyEnvName("STRIPE_SECRET_KEY")).toBe(false);
    expect(HOSTED_ASSISTANT_ALLOWED_API_KEY_ENV_NAMES).toContain("OPENAI_API_KEY");
  });
});
