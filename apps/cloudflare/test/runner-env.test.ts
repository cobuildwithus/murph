import { describe, expect, it } from "vitest";

import { buildHostedRunnerContainerEnv } from "../src/runner-env.js";

describe("buildHostedRunnerContainerEnv", () => {
  it("forwards canonical AgentMail and ffmpeg keys", () => {
    expect(buildHostedRunnerContainerEnv({
      AGENTMAIL_API_KEY: "agentmail-secret",
      AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
    })).toEqual({
      AGENTMAIL_API_KEY: "agentmail-secret",
      AGENTMAIL_BASE_URL: "https://mail.example.test/v0",
      FFMPEG_COMMAND: "/usr/local/bin/ffmpeg",
      HOSTED_DEVICE_SYNC_CONTROL_BASE_URL: "http://device-sync.worker",
      HOSTED_SHARE_API_BASE_URL: "http://share-pack.worker",
      NODE_ENV: "production",
    });
  });

  it("ignores removed AgentMail and ffmpeg alias keys", () => {
    expect(buildHostedRunnerContainerEnv({
      AGENTMAIL_API_BASE_URL: "https://legacy-mail.example.test/v0",
      PARSER_FFMPEG_PATH: "/usr/local/bin/ffmpeg",
    })).toEqual({
      HOSTED_DEVICE_SYNC_CONTROL_BASE_URL: "http://device-sync.worker",
      HOSTED_SHARE_API_BASE_URL: "http://share-pack.worker",
      NODE_ENV: "production",
    });
  });

  it("ignores unknown AgentMail and ffmpeg-prefixed keys", () => {
    expect(buildHostedRunnerContainerEnv({
      AGENTMAIL_TIMEOUT_MS: "5000",
      FFMPEG_THREADS: "2",
    })).toEqual({
      HOSTED_DEVICE_SYNC_CONTROL_BASE_URL: "http://device-sync.worker",
      HOSTED_SHARE_API_BASE_URL: "http://share-pack.worker",
      NODE_ENV: "production",
    });
  });

  it("does not forward hosted web control tokens into the runner", () => {
    expect(buildHostedRunnerContainerEnv({
      HOSTED_EXECUTION_CONTROL_TOKEN: "control-token",
      HOSTED_EXECUTION_INTERNAL_TOKEN: "internal-token",
    })).toEqual({
      HOSTED_DEVICE_SYNC_CONTROL_BASE_URL: "http://device-sync.worker",
      HOSTED_SHARE_API_BASE_URL: "http://share-pack.worker",
      NODE_ENV: "production",
    });
  });
});
