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
      NODE_ENV: "production",
    });
  });

  it("ignores removed AgentMail and ffmpeg alias keys", () => {
    expect(buildHostedRunnerContainerEnv({
      AGENTMAIL_API_BASE_URL: "https://legacy-mail.example.test/v0",
      PARSER_FFMPEG_PATH: "/usr/local/bin/ffmpeg",
    })).toEqual({
      NODE_ENV: "production",
    });
  });

  it("ignores unknown AgentMail and ffmpeg-prefixed keys", () => {
    expect(buildHostedRunnerContainerEnv({
      AGENTMAIL_TIMEOUT_MS: "5000",
      FFMPEG_THREADS: "2",
    })).toEqual({
      NODE_ENV: "production",
    });
  });
});
