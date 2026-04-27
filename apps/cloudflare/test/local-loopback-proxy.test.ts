import { describe, expect, it } from "vitest";

import {
  assertHostedLocalInternalProxyEnvironment,
  isLocalInternalProxyHostname,
  isLocalLoopbackProxyProtocol,
} from "../src/local-loopback-proxy.ts";

describe("isLocalLoopbackProxyProtocol", () => {
  it("only accepts http(s) protocols for the surviving local internal proxy shim", () => {
    expect(isLocalLoopbackProxyProtocol("http:")).toBe(true);
    expect(isLocalLoopbackProxyProtocol("https:")).toBe(true);
    expect(isLocalLoopbackProxyProtocol("ws:")).toBe(false);
  });
});

describe("isLocalInternalProxyHostname", () => {
  it("accepts loopback, private-network, and local bridge hosts only", () => {
    expect(isLocalInternalProxyHostname("localhost")).toBe(true);
    expect(isLocalInternalProxyHostname("127.0.0.1")).toBe(true);
    expect(isLocalInternalProxyHostname("[::1]")).toBe(true);
    expect(isLocalInternalProxyHostname("10.0.0.12")).toBe(true);
    expect(isLocalInternalProxyHostname("172.20.0.12")).toBe(true);
    expect(isLocalInternalProxyHostname("192.168.1.12")).toBe(true);
    expect(isLocalInternalProxyHostname("host.docker.internal")).toBe(true);
    expect(isLocalInternalProxyHostname("runner.example.test")).toBe(false);
    expect(isLocalInternalProxyHostname("fc-public.example.test")).toBe(false);
    expect(isLocalInternalProxyHostname("8.8.8.8")).toBe(false);
  });
});

describe("assertHostedLocalInternalProxyEnvironment", () => {
  it("requires explicit development opt-in when the proxy base URL is configured", () => {
    expect(() =>
      assertHostedLocalInternalProxyEnvironment({
        ALLOW_LOCAL_INTERNAL_PROXY: "true",
        HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "production",
      })
    ).toThrow("only supported when HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT=development");

    expect(() =>
      assertHostedLocalInternalProxyEnvironment({
        ALLOW_LOCAL_INTERNAL_PROXY: "true",
        HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://127.0.0.1:8787",
        HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "production",
      })
    ).toThrow("only supported when HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT=development");

    expect(() =>
      assertHostedLocalInternalProxyEnvironment({
        HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://127.0.0.1:8787",
        HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "development",
      })
    ).toThrow("requires ALLOW_LOCAL_INTERNAL_PROXY=true");

    expect(() =>
      assertHostedLocalInternalProxyEnvironment({
        ALLOW_LOCAL_INTERNAL_PROXY: "true",
        HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "http://127.0.0.1:8787",
        HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "development",
      })
    ).not.toThrow();
  });

  it("rejects public configured proxy hosts", () => {
    expect(() =>
      assertHostedLocalInternalProxyEnvironment({
        ALLOW_LOCAL_INTERNAL_PROXY: "true",
        HOSTED_EXECUTION_LOCAL_INTERNAL_PROXY_BASE_URL: "https://runner.example.test",
        HOSTED_EXECUTION_VERCEL_OIDC_ENVIRONMENT: "development",
      })
    ).toThrow("must use a loopback, private-network, or local bridge hostname");
  });
});
