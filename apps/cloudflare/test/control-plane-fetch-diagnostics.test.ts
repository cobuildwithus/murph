import { describe, expect, it, vi } from "vitest";

import { deriveHostedExecutionErrorCode } from "@murphai/hosted-execution";

import {
  HostedRuntimeControlPlaneFetchError,
  readHostedRuntimeControlPlaneFetchFailureDiagnostics,
  shouldRetryHostedRuntimeReplaySafeRead,
} from "../src/runtime-platform/control-plane-fetch.ts";
import { buildHostedRuntimeSafeErrorMetadata } from "../src/runtime-platform/diagnostics.ts";

const signalState = {
  callerSignalAborted: false,
  requestSignalAborted: false,
  timeoutMs: 1000,
  timeoutSignalAborted: false,
};
const legacyMetadata = {
  errorCode: "type_error",
  errorMessagePresent: true,
  errorName: "Error",
  fetchCallerSignalAborted: false,
  fetchCauseCode: "type_error",
  fetchCauseKind: "fetch_failed",
  fetchCauseName: "TypeError",
  fetchRequestSignalAborted: false,
  fetchTimeoutMs: 1000,
  fetchTimeoutSignalAborted: false,
};

function createFailure(cause: unknown = new TypeError("fetch failed")) {
  return new HostedRuntimeControlPlaneFetchError({
    cause,
    description: "Synthetic fetch",
    signalState,
  });
}

function readMetadata(error: unknown) {
  return buildHostedRuntimeSafeErrorMetadata(
    new Error("Synthetic wrapper", { cause: error }),
    { includeSafeErrorText: false },
  );
}

function captureNetworkCause(cause: unknown) {
  return createFailure(new TypeError("fetch failed", { cause }));
}

describe("hosted fetch network diagnostics", () => {
  it.each([
    "ECONNRESET", "UND_ERR_SOCKET", "ECONNREFUSED", "ENOTFOUND", "EPIPE",
    "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
  ])("preserves the bounded nested %s code through an outer wrapper", (code) => {
    const failure = captureNetworkCause(Object.assign(
      new Error("synthetic transport detail"),
      {
        code,
        stack: "synthetic private stack",
        address: "192.0.2.10",
        port: 43210,
        url: "https://example.invalid/private",
        socket: { remoteAddress: "192.0.2.11" },
        headers: { authorization: "synthetic-private-credential" },
        payload: "synthetic-private-payload",
      },
    ));
    const errorCode = code.includes("TIMEOUT") ? "timeout" : "type_error";
    expect(readMetadata(failure)).toEqual({
      ...legacyMetadata, errorCode, fetchCauseCode: errorCode, fetchNetworkErrorCode: code,
    });
  });

  it.each([
    { label: "missing", code: undefined },
    { label: "null", code: null },
    { label: "numeric", code: 123 },
    { label: "unknown", code: "ERR_SYNTHETIC" },
    { label: "private", code: "https://example.invalid/private" },
    { label: "oversized", code: `ECONNRESET${"x".repeat(4096)}` },
    { label: "whitespace", code: " ECONNRESET " },
    { label: "lowercase", code: "econnreset" },
    { label: "boxed", code: new String("ECONNRESET") },
  ])("omits $label codes at capture and forged-wrapper projection", ({ code }) => {
    expect(readMetadata(captureNetworkCause({ code }))).toEqual(legacyMetadata);
    expect(readMetadata({
      ...createFailure(),
      hostedRuntimeFetchNetworkErrorCode: code,
    })).toEqual(legacyMetadata);
  });

  it("does not coerce code values or enumerate error keys", () => {
    const coerce = vi.fn(() => { throw new Error("Synthetic coercion"); });
    const ownKeys = vi.fn(() => { throw new Error("Synthetic enumeration"); });
    const cause = new Proxy({ code: { [Symbol.toPrimitive]: coerce } }, { ownKeys });
    expect(readMetadata(captureNetworkCause(cause))).toEqual(legacyMetadata);
    expect(coerce).not.toHaveBeenCalled();
    expect(ownKeys).not.toHaveBeenCalled();
  });

  it("uses the nearest known code, including a direct code", () => {
    const cause = Object.assign(new TypeError("fetch failed", {
      cause: { code: "UND_ERR_SOCKET" },
    }), { code: "ECONNRESET" });
    expect(readMetadata(createFailure(cause)).fetchNetworkErrorCode).toBe("ECONNRESET");
    expect(readMetadata(captureNetworkCause({
      code: "ERR_SYNTHETIC",
      cause: { code: "UND_ERR_SOCKET" },
    })).fetchNetworkErrorCode).toBe("UND_ERR_SOCKET");
  });

  it.each([2, 3, 100])("bounds capture with %s intermediate causes", (count) => {
    let cause: unknown = { code: "ECONNRESET" };
    for (let index = 0; index < count; index += 1) {
      cause = { cause };
    }
    expect(readMetadata(captureNetworkCause(cause))).toEqual(count === 2
      ? { ...legacyMetadata, fetchNetworkErrorCode: "ECONNRESET" }
      : legacyMetadata);
  });

  it("bounds descriptor work even when each cause is a fresh object", () => {
    const descriptor = vi.fn((_target: object, property: string | symbol): PropertyDescriptor => ({
      configurable: true,
      value: property === "cause" ? new Proxy({}, { getOwnPropertyDescriptor: descriptor }) : undefined,
    }));
    const failure = captureNetworkCause(new Proxy({}, { getOwnPropertyDescriptor: descriptor }));
    expect(failure.hostedRuntimeFetchNetworkErrorCode).toBeUndefined();
    // The direct TypeError plus three nested objects; only code and cause are inspected.
    expect(descriptor.mock.calls.map(([, property]) => property)).toEqual([
      "code", "cause", "code", "cause", "code", "cause",
    ]);
  });

  it("stops at cycles without rescanning their descriptors", () => {
    const target: { cause?: unknown } = {};
    const descriptor = vi.fn(Reflect.getOwnPropertyDescriptor);
    target.cause = new Proxy(target, { getOwnPropertyDescriptor: descriptor });
    expect(readMetadata(captureNetworkCause(target.cause))).toEqual(legacyMetadata);
    expect(descriptor).toHaveBeenCalledTimes(2);
  });

  it.each(["code", "cause"])("adds no nested %s getter reads to legacy classification", (property) => {
    const getter = vi.fn(() => undefined);
    const nested = Object.defineProperty({}, property, { get: getter });
    const cause = new TypeError("fetch failed", { cause: nested });
    deriveHostedExecutionErrorCode(cause);
    const legacyReads = getter.mock.calls.length;
    getter.mockClear();
    const failure = createFailure(cause);
    expect(readHostedRuntimeControlPlaneFetchFailureDiagnostics(failure))
      .not.toHaveProperty("fetchNetworkErrorCode");
    expect(getter).toHaveBeenCalledTimes(legacyReads);
  });

  it("does not capture inherited codes or add inherited cause getter reads", () => {
    const getter = vi.fn(() => undefined);
    const prototype = Object.defineProperty({ code: "ECONNRESET" }, "cause", { get: getter });
    const cause = new TypeError("fetch failed", { cause: Object.create(prototype) });
    deriveHostedExecutionErrorCode(cause);
    const legacyReads = getter.mock.calls.length;
    getter.mockClear();
    expect(createFailure(cause).hostedRuntimeFetchNetworkErrorCode).toBeUndefined();
    expect(getter).toHaveBeenCalledTimes(legacyReads);
  });

  it.each(["code", "cause"])("omits the code when %s descriptor inspection throws", (property) => {
    const cause = new Proxy({ cause: { code: "ECONNRESET" } }, {
      getOwnPropertyDescriptor(target, key) {
        if (key === property) {
          throw new Error("Synthetic descriptor failure");
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    expect(readMetadata(captureNetworkCause(cause))).toEqual(legacyMetadata);
  });

  it("rejects optional-field getters, inherited values and throwing descriptors at projection", () => {
    const failure = createFailure();
    const getter = vi.fn(() => { throw new Error("Synthetic wrapper accessor"); });
    Object.defineProperty(failure, "hostedRuntimeFetchNetworkErrorCode", { get: getter });
    expect(readMetadata(failure)).toEqual(legacyMetadata);
    expect(getter).not.toHaveBeenCalled();
    const forged = { ...createFailure() };
    Reflect.deleteProperty(forged, "hostedRuntimeFetchNetworkErrorCode");
    Object.setPrototypeOf(forged, { hostedRuntimeFetchNetworkErrorCode: "ECONNRESET" });
    expect(readMetadata(forged)).toEqual(legacyMetadata);
    expect(readMetadata(new Proxy(createFailure(), {
      getOwnPropertyDescriptor(target, key) {
        if (key === "hostedRuntimeFetchNetworkErrorCode") {
          throw new Error("Synthetic wrapper descriptor failure");
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    }))).toEqual(legacyMetadata);
  });

  it("keeps legacy wrappers without the optional field unchanged", () => {
    const failure = createFailure();
    Reflect.deleteProperty(failure, "hostedRuntimeFetchNetworkErrorCode");
    expect(readMetadata(failure)).toEqual(legacyMetadata);
    expect(readMetadata(new Error("Synthetic ordinary failure")))
      .not.toHaveProperty("fetchNetworkErrorCode");
  });

  it.each([
    { state: signalState, retryable: true, kind: "fetch_failed" },
    { state: { ...signalState, callerSignalAborted: true }, retryable: false, kind: "abort" },
    { state: { ...signalState, requestSignalAborted: true }, retryable: false, kind: "fetch_failed" },
    { state: { ...signalState, timeoutSignalAborted: true }, retryable: false, kind: "timeout" },
  ])("keeps $kind classification and signal-based retryability", ({ state, retryable, kind }) => {
    for (const code of [undefined, "ECONNRESET", "UND_ERR_CONNECT_TIMEOUT"]) {
      const cause = new TypeError("fetch failed", { cause: { code } });
      const failure = new HostedRuntimeControlPlaneFetchError({
        cause, description: "Synthetic fetch", signalState: state,
      });
      expect(failure.cause).toBe(cause);
      const errorCode = code === "UND_ERR_CONNECT_TIMEOUT" ? "timeout" : "type_error";
      expect(failure.code).toBe(errorCode);
      expect(failure.name).toBe("Error");
      expect(readMetadata(failure)).toEqual({
        ...legacyMetadata,
        errorCode,
        fetchCauseCode: errorCode,
        fetchCauseKind: kind,
        fetchCallerSignalAborted: state.callerSignalAborted,
        fetchRequestSignalAborted: state.requestSignalAborted,
        fetchTimeoutSignalAborted: state.timeoutSignalAborted,
        ...(code ? { fetchNetworkErrorCode: code } : {}),
      });
      expect(shouldRetryHostedRuntimeReplaySafeRead({ attempt: 1, error: failure })).toBe(retryable);
      expect(shouldRetryHostedRuntimeReplaySafeRead({ attempt: 2, error: failure })).toBe(false);
    }
  });

  it("does not make an unknown failure retryable merely because a nested code is known", () => {
    const failure = createFailure(new Error("Synthetic failure", { cause: { code: "ECONNRESET" } }));
    expect(readMetadata(failure)).toMatchObject({
      errorCode: "runtime_error", fetchCauseKind: "unknown", fetchNetworkErrorCode: "ECONNRESET",
    });
    expect(shouldRetryHostedRuntimeReplaySafeRead({ attempt: 1, error: failure })).toBe(false);
  });
});
