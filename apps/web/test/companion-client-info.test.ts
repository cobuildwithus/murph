import { describe, expect, it } from "vitest";
import { readCompanionClientInfo } from "@/src/lib/companion/client-info";

const iosHeaders = {
  "X-Murph-Client-Platform": "ios",
  "X-Murph-Client-Version": "1.1.22",
  "X-Murph-Client-Build": "109",
  "X-Murph-Client-OS-Version": "18.1.0",
  "X-Murph-Client-Device-Model": "iPhone16,2",
};

describe("companion client headers", () => {
  it("reads iOS values and trims surrounding whitespace", () => {
    expect(readCompanionClientInfo(new Headers({ ...iosHeaders,
      "X-Murph-Client-Device-Model": "  iPhone16,2  ",
    }))).toEqual({ platform: "ios", version: "1.1.22", build: "109", osVersion: "18.1.0", deviceModel: "iPhone16,2" });
  });

  it("reads Android development builds without numeric normalization", () => {
    expect(readCompanionClientInfo(new Headers({
      "X-Murph-Client-Platform": "android", "X-Murph-Client-Version": "0.1.3-hosted-e2e",
      "X-Murph-Client-Build": "00109", "X-Murph-Client-OS-Version": "15",
      "X-Murph-Client-Device-Model": "Pixel 8 Pro",
    }))).toEqual({ platform: "android", version: "0.1.3-hosted-e2e", build: "00109", osVersion: "15", deviceModel: "Pixel 8 Pro" });
  });

  it.each(["Platform", "Version", "Build"])("requires %s along with the other core fields", (field) => {
    const headers = new Headers(iosHeaders);
    headers.delete(`X-Murph-Client-${field}`);
    expect(readCompanionClientInfo(headers)).toBeNull();
    expect(readCompanionClientInfo(new Headers())).toBeNull();
  });

  it.each([
    ["Platform", "web"], ["Platform", "IOS"], ["Platform", "ios, android"],
    ["Version", "1.2.3.4.5"], ["Version", "12345"], ["Version", "1.2-"],
    ["Version", `1.2-${"a".repeat(25)}`], ["Version", "1.2+dev"], ["Version", "1.\u00012"],
    ["Build", "12345678901"], ["Build", "1e2"], ["Build", "-1"], ["Build", "1.2"], ["Build", "1\t2"],
  ])("ignores an invalid %s value %j", (field, value) => {
    const headers = new Headers(iosHeaders);
    headers.set(`X-Murph-Client-${field}`, value);
    expect(readCompanionClientInfo(headers)).toBeNull();
  });

  it.each([
    ["OS-Version", "osVersion", "18-dev"], ["OS-Version", "osVersion", "12345"],
    ["OS-Version", "osVersion", "1.2.3.4.5"], ["OS-Version", "osVersion", "1\t2"],
    ["Device-Model", "deviceModel", "x".repeat(65)], ["Device-Model", "deviceModel", "Pixel\u00018"],
    ["Device-Model", "deviceModel", "Pixel/8"], ["Device-Model", "deviceModel", "Píxel"],
  ])("drops only invalid optional %s value %j", (header, field, value) => {
    const headers = new Headers(iosHeaders);
    headers.set(`X-Murph-Client-${header}`, value);
    expect(readCompanionClientInfo(headers)).toEqual({
      platform: "ios", version: "1.1.22", build: "109", osVersion: "18.1.0", deviceModel: "iPhone16,2", [field]: null,
    });
  });

  it("accepts boundary lengths and treats absent optional fields as null", () => {
    const headers = new Headers({
      "X-Murph-Client-Platform": "ios",
      "X-Murph-Client-Version": `1234.1234.1234.1234-${"a".repeat(24)}`,
      "X-Murph-Client-Build": "1234567890",
    });
    expect(readCompanionClientInfo(headers)).toMatchObject({ osVersion: null, deviceModel: null });
    headers.set("X-Murph-Client-OS-Version", "1234.1234.1234.1234");
    headers.set("X-Murph-Client-Device-Model", "x".repeat(64));
    expect(readCompanionClientInfo(headers)).toMatchObject({ osVersion: "1234.1234.1234.1234", deviceModel: "x".repeat(64) });
  });
});
