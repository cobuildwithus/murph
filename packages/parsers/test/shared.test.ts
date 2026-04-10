import { describe, expect, it } from "vitest";

import { sanitizeChildProcessEnv } from "../src/shared.js";

describe("sanitizeChildProcessEnv", () => {
  it("keeps only the minimal safe execution environment", () => {
    const sanitized = sanitizeChildProcessEnv({
      APPDATA: "/tmp/appdata",
      HOME: "/home/alice",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      NODE_OPTIONS: "--require ./inject.js",
      NODE_V8_COVERAGE: "/tmp/coverage",
      OPENAI_API_KEY: "secret",
      PATH: "/usr/bin:/bin",
      TEMP: "/tmp",
      TMPDIR: "/tmp",
      USERPROFILE: "/Users/alice",
      XDG_RUNTIME_DIR: "/run/user/1000",
    });

    expect(sanitized).toEqual({
      APPDATA: "/tmp/appdata",
      HOME: "/home/alice",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      PATH: "/usr/bin:/bin",
      TEMP: "/tmp",
      TMPDIR: "/tmp",
      USERPROFILE: "/Users/alice",
      XDG_RUNTIME_DIR: "/run/user/1000",
    });
  });

  it("preserves allowlisted Windows variables regardless of source key casing", () => {
    const sanitized = sanitizeChildProcessEnv({
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      Path: "C:\\Windows\\System32",
      SYSTEMROOT: "C:\\Windows",
      windir: "C:\\Windows",
      OPENAI_API_KEY: "secret",
    });

    expect(sanitized).toEqual({
      ComSpec: "C:\\Windows\\System32\\cmd.exe",
      Path: "C:\\Windows\\System32",
      SYSTEMROOT: "C:\\Windows",
      windir: "C:\\Windows",
    });
  });
});
