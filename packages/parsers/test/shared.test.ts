import { describe, expect, it } from "vitest";

import { readConfiguredEnvValue, sanitizeChildProcessEnv } from "../src/shared.js";

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
      COMSPEC: "C:\\Windows\\System32\\cmd.exe",
      PATH: "C:\\Windows\\System32",
      SYSTEMROOT: "C:\\Windows",
      WINDIR: "C:\\Windows",
    });
  });

  it("dedupes preserved keys by canonical casing and prefers the canonical entry", () => {
    expect(
      sanitizeChildProcessEnv({
        HOME: "/home/murph",
        Path: "/tmp/bad-bin",
        PATH: "/usr/bin",
        SECRET_TOKEN: "nope",
        lc_all: "C.UTF-8",
      }),
    ).toEqual({
      HOME: "/home/murph",
      LC_ALL: "C.UTF-8",
      PATH: "/usr/bin",
    });
  });

  it("keeps the first preserved variant when no canonical entry exists", () => {
    expect(
      sanitizeChildProcessEnv({
        path: "/usr/local/bin",
        tmpdir: "/tmp/murph",
      }),
    ).toEqual({
      PATH: "/usr/local/bin",
      TMPDIR: "/tmp/murph",
    });
  });

  it("prefers the canonical uppercase entry even when a later mixed-case duplicate is non-empty", () => {
    expect(
      sanitizeChildProcessEnv({
        PATH: "",
        path: "/usr/local/bin",
      }),
    ).toEqual({
      PATH: "",
    });
  });

  it("skips non-string values even when the key itself is allowlisted", () => {
    const env: NodeJS.ProcessEnv = {
      HOME: "/home/murph",
    };
    Reflect.set(env, "TMP", 42);

    expect(sanitizeChildProcessEnv(env)).toEqual({
      HOME: "/home/murph",
    });
  });
});

describe("readConfiguredEnvValue", () => {
  it("returns the first non-empty configured key after trimming", () => {
    expect(
      readConfiguredEnvValue(
        {
          PARSER_BIN: "   ",
          PARSER_PATH: " /usr/local/bin/pdftotext ",
        },
        ["PARSER_BIN", "PARSER_PATH"],
      ),
    ).toBe("/usr/local/bin/pdftotext");
  });
});
