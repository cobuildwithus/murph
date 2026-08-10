import { Buffer } from "node:buffer";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { hostedOnboardingError } from "../src/lib/hosted-onboarding/errors";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  activateMealPhotoCaptureEnrollmentForScopedToken: vi.fn(),
  appendHostedMealPhotoMailboxEnvelopeTx: vi.fn(),
  assertCurrentMealPhotoCaptureEnrollmentTx: vi.fn(),
  assertHostedHistoricalLaunchConsentGranted: vi.fn(),
  assertMealPhotoCaptureRequestHasNoBody: vi.fn(),
  buildHostedExecutionMealPhotoCapturedWake: vi.fn(),
  deleteMealPhoto: vi.fn(),
  getPrisma: vi.fn(),
  isMealPhotoCaptureScopedAuthorization: vi.fn(),
  issueMealPhotoCaptureEnrollment: vi.fn(),
  parseMealPhotoCaptureEnrollmentRequest: vi.fn(),
  parseMealPhotoCaptureRevocationRequest: vi.fn(),
  readAndValidateMealPhotoUpload: vi.fn(),
  readCurrentHostedMemberDirectRoute: vi.fn(),
  readHostedExecutionControlClientIfConfigured: vi.fn(),
  readHostedMailboxWakeAfterDedupeLockTx: vi.fn(),
  requireActiveMealPhotoCaptureEnrollment: vi.fn(),
  requireActivePrivyMemberAuthFromBearerToken: vi.fn(),
  requireMealPhotoCaptureScopedToken: vi.fn(),
  requirePrivyMemberAuthFromBearerToken: vi.fn(),
  revokeMealPhotoCaptureEnrollmentForMember: vi.fn(),
  revokeMealPhotoCaptureEnrollmentForScopedToken: vi.fn(),
  signalHostedMailboxAppendRuntime: vi.fn(),
  stageMealPhoto: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@murphai/hosted-execution", () => ({
  buildHostedExecutionMealPhotoCapturedWake:
    mocks.buildHostedExecutionMealPhotoCapturedWake,
}));

vi.mock("@/src/lib/device-sync/meal-photo-capture", () => ({
  activateMealPhotoCaptureEnrollmentForScopedToken:
    mocks.activateMealPhotoCaptureEnrollmentForScopedToken,
  assertCurrentMealPhotoCaptureEnrollmentTx:
    mocks.assertCurrentMealPhotoCaptureEnrollmentTx,
  assertMealPhotoCaptureRequestHasNoBody: mocks.assertMealPhotoCaptureRequestHasNoBody,
  isMealPhotoCaptureScopedAuthorization: mocks.isMealPhotoCaptureScopedAuthorization,
  issueMealPhotoCaptureEnrollment: mocks.issueMealPhotoCaptureEnrollment,
  parseMealPhotoCaptureEnrollmentRequest: mocks.parseMealPhotoCaptureEnrollmentRequest,
  parseMealPhotoCaptureRevocationRequest: mocks.parseMealPhotoCaptureRevocationRequest,
  readAndValidateMealPhotoUpload: mocks.readAndValidateMealPhotoUpload,
  requireActiveMealPhotoCaptureEnrollment: mocks.requireActiveMealPhotoCaptureEnrollment,
  requireMealPhotoCaptureScopedToken: mocks.requireMealPhotoCaptureScopedToken,
  revokeMealPhotoCaptureEnrollmentForMember:
    mocks.revokeMealPhotoCaptureEnrollmentForMember,
  revokeMealPhotoCaptureEnrollmentForScopedToken:
    mocks.revokeMealPhotoCaptureEnrollmentForScopedToken,
}));

vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireActivePrivyMemberAuthFromBearerToken:
    mocks.requireActivePrivyMemberAuthFromBearerToken,
  requirePrivyMemberAuthFromBearerToken: mocks.requirePrivyMemberAuthFromBearerToken,
}));

vi.mock("@/src/lib/hosted-routing/member-direct-route", () => ({
  readCurrentHostedMemberDirectRoute: mocks.readCurrentHostedMemberDirectRoute,
}));

vi.mock("@/src/lib/legal/consent", () => ({
  assertHostedHistoricalLaunchConsentGranted:
    mocks.assertHostedHistoricalLaunchConsentGranted,
}));

vi.mock("@/src/lib/hosted-execution/control", () => ({
  readHostedExecutionControlClientIfConfigured:
    mocks.readHostedExecutionControlClientIfConfigured,
}));

vi.mock("@/src/lib/hosted-mailbox/store", () => ({
  appendHostedMealPhotoMailboxEnvelopeTx:
    mocks.appendHostedMealPhotoMailboxEnvelopeTx,
  readHostedMailboxWakeAfterDedupeLockTx:
    mocks.readHostedMailboxWakeAfterDedupeLockTx,
}));

vi.mock("@/src/lib/hosted-orchestration/signal-runtime", () => ({
  signalHostedMailboxAppendRuntime: mocks.signalHostedMailboxAppendRuntime,
}));

vi.mock("@/src/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

type EnrollmentRoute =
  typeof import("../app/api/device-sync/companion/meal-photo-capture/enrollment/route");
type PhotosRoute =
  typeof import("../app/api/device-sync/companion/meal-photo-capture/photos/route");

let enrollmentRoute: EnrollmentRoute;
let photosRoute: PhotosRoute;

const MEMBER_ID = "member_1";
const ENROLLMENT_ID = "hmp_enrollment";
const CAPTURE_ID = "a".repeat(64);
const CAPTURED_AT = "2026-07-12T16:30:45.000Z";
const EVENT_ID = `meal-photo:${ENROLLMENT_ID}:${CAPTURE_ID}`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const ENROLLMENT_REQUEST = {
  appInstallationId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  appVersion: "1.2.3",
  schemaVersion: 1 as const,
};

describe("meal photo companion routes", () => {
  beforeAll(async () => {
    enrollmentRoute = await import(
      "../app/api/device-sync/companion/meal-photo-capture/enrollment/route"
    );
    photosRoute = await import(
      "../app/api/device-sync/companion/meal-photo-capture/photos/route"
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({ $transaction: mocks.transaction });
    mocks.transaction.mockImplementation(
      async (operation: (tx: { label: string }) => unknown) => operation({ label: "tx" }),
    );
    mocks.requireActivePrivyMemberAuthFromBearerToken.mockResolvedValue({
      member: { id: MEMBER_ID },
    });
    mocks.requirePrivyMemberAuthFromBearerToken.mockResolvedValue({
      member: { id: MEMBER_ID },
    });
    mocks.assertHostedHistoricalLaunchConsentGranted.mockResolvedValue(undefined);
    mocks.readCurrentHostedMemberDirectRoute.mockResolvedValue({
      channel: "linq",
      threadId: "linq-thread-1",
    });
    mocks.parseMealPhotoCaptureEnrollmentRequest.mockReturnValue(ENROLLMENT_REQUEST);
    mocks.parseMealPhotoCaptureRevocationRequest.mockReturnValue({
      appInstallationId: ENROLLMENT_REQUEST.appInstallationId,
      schemaVersion: 1,
    });
    mocks.issueMealPhotoCaptureEnrollment.mockResolvedValue({
      expiresAt: new Date("2026-08-11T12:00:00.000Z"),
      idempotencySecret: "idempotency-secret",
      uploadToken: "scoped-upload-token",
    });
    mocks.activateMealPhotoCaptureEnrollmentForScopedToken.mockResolvedValue({
      activated: true,
    });
    mocks.revokeMealPhotoCaptureEnrollmentForMember.mockResolvedValue({ revoked: true });
    mocks.revokeMealPhotoCaptureEnrollmentForScopedToken.mockResolvedValue({ revoked: true });
    mocks.requireMealPhotoCaptureScopedToken.mockReturnValue("scoped-upload-token");
    mocks.requireActiveMealPhotoCaptureEnrollment.mockResolvedValue({
      enrollmentId: ENROLLMENT_ID,
      memberId: MEMBER_ID,
    });
    mocks.assertCurrentMealPhotoCaptureEnrollmentTx.mockResolvedValue(undefined);
    mocks.readAndValidateMealPhotoUpload.mockResolvedValue({
      bytes: JPEG,
      captureId: CAPTURE_ID,
      capturedAt: CAPTURED_AT,
      height: 2,
      sha256: "b".repeat(64),
      width: 3,
    });
    mocks.stageMealPhoto.mockResolvedValue({
      byteLength: JPEG.byteLength,
      mealPhotoKey: "meal-photo-key",
      sha256: "b".repeat(64),
    });
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue({
      deleteMealPhoto: mocks.deleteMealPhoto,
      stageMealPhoto: mocks.stageMealPhoto,
    });
    mocks.deleteMealPhoto.mockResolvedValue(undefined);
    mocks.buildHostedExecutionMealPhotoCapturedWake.mockReturnValue(buildMealPhotoWake());
    mocks.appendHostedMealPhotoMailboxEnvelopeTx.mockResolvedValue({
      claimedMealPhotoKey: "meal-photo-key",
      dedupeConflict: false,
      duplicate: false,
      item: { id: "mailbox_1" },
    });
    mocks.readHostedMailboxWakeAfterDedupeLockTx.mockResolvedValue(null);
    mocks.signalHostedMailboxAppendRuntime.mockResolvedValue(undefined);
  });

  function buildMealPhotoWake(mealPhotoKey = "meal-photo-key") {
    return {
      directRoute: {
        channel: "linq",
        threadId: "linq-thread-1",
      },
      eventId: EVENT_ID,
      kind: "meal-photo.captured",
      mealPhoto: {
        byteLength: JPEG.byteLength,
        captureId: CAPTURE_ID,
        capturedAt: CAPTURED_AT,
        mealPhotoKey,
        sha256: "b".repeat(64),
      },
      occurredAt: CAPTURED_AT,
      userId: MEMBER_ID,
    };
  }

  it("enrolls after active Privy auth and historical launch consent", async () => {
    const request = jsonRequest("https://app.example.test/enrollment", ENROLLMENT_REQUEST);
    const response = await enrollmentRoute.POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      expiresAt: "2026-08-11T12:00:00.000Z",
      idempotencySecret: "idempotency-secret",
      uploadToken: "scoped-upload-token",
    });
    expect(mocks.requireActivePrivyMemberAuthFromBearerToken).toHaveBeenCalledWith(
      request,
      expect.anything(),
    );
    expect(mocks.assertHostedHistoricalLaunchConsentGranted).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: expect.anything(),
    });
    expect(mocks.readCurrentHostedMemberDirectRoute).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: expect.anything(),
    });
    expect(mocks.issueMealPhotoCaptureEnrollment).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: expect.anything(),
      request: ENROLLMENT_REQUEST,
    });
  });

  it("keeps the successful schema-v2 enrollment response credential-only", async () => {
    const schemaV2Request = {
      ...ENROLLMENT_REQUEST,
      authorityRevision: 1,
      schemaVersion: 2 as const,
    };
    mocks.parseMealPhotoCaptureEnrollmentRequest.mockReturnValueOnce(schemaV2Request);

    const response = await enrollmentRoute.POST(
      jsonRequest("https://app.example.test/enrollment", schemaV2Request),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      expiresAt: "2026-08-11T12:00:00.000Z",
      idempotencySecret: "idempotency-secret",
      uploadToken: "scoped-upload-token",
    });
    expect(mocks.issueMealPhotoCaptureEnrollment).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: expect.anything(),
      request: schemaV2Request,
    });
  });

  it("returns the current authority revision only on schema-v2 conflict", async () => {
    mocks.issueMealPhotoCaptureEnrollment.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "MEAL_PHOTO_CAPTURE_AUTHORITY_REVISION_CONFLICT",
        details: {
          currentAuthorityRevision: 3,
          currentAuthorityState: "revoked",
          requestedOperation: "enroll",
        },
        httpStatus: 409,
        message: "Meal photo capture authority changed. Retry from the current state.",
      }),
    );

    const response = await enrollmentRoute.POST(
      jsonRequest("https://app.example.test/enrollment", ENROLLMENT_REQUEST),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "MEAL_PHOTO_CAPTURE_AUTHORITY_REVISION_CONFLICT",
        details: {
          currentAuthorityRevision: 3,
          currentAuthorityState: "revoked",
          requestedOperation: "enroll",
        },
        message: "Meal photo capture authority changed. Retry from the current state.",
        retryable: false,
      },
    });
  });

  it("rejects enrollment when historical launch consent is missing", async () => {
    mocks.assertHostedHistoricalLaunchConsentGranted.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_CONSENT_REQUIRED",
        httpStatus: 403,
        message: "Accept the Murph legal consent before continuing.",
      }),
    );

    const response = await enrollmentRoute.POST(
      jsonRequest("https://app.example.test/enrollment", ENROLLMENT_REQUEST),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_CONSENT_REQUIRED",
      },
    });
    expect(mocks.readCurrentHostedMemberDirectRoute).not.toHaveBeenCalled();
    expect(mocks.issueMealPhotoCaptureEnrollment).not.toHaveBeenCalled();
  });

  it("keeps paid enrollment denial feature-scoped for paused companion sessions", async () => {
    mocks.requireActivePrivyMemberAuthFromBearerToken.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_ACCESS_REQUIRED",
        httpStatus: 403,
        message: "Your subscription is paused. Resume billing before continuing.",
      }),
    );

    const response = await enrollmentRoute.POST(
      jsonRequest("https://app.example.test/enrollment", ENROLLMENT_REQUEST),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "MEAL_PHOTO_CAPTURE_ACTIVE_ACCESS_REQUIRED",
        message: "Active Murph access is required for automatic meal capture.",
        retryable: false,
      },
    });
    expect(mocks.assertHostedHistoricalLaunchConsentGranted).not.toHaveBeenCalled();
    expect(mocks.issueMealPhotoCaptureEnrollment).not.toHaveBeenCalled();
  });

  it("requires an existing private Murph delivery route before enrollment", async () => {
    mocks.readCurrentHostedMemberDirectRoute.mockResolvedValueOnce(null);
    const request = jsonRequest(
      "https://app.example.test/enrollment",
      ENROLLMENT_REQUEST,
    );
    const response = await enrollmentRoute.POST(request);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "MEAL_PHOTO_CAPTURE_DIRECT_ROUTE_REQUIRED",
        message:
          "Connect iMessage, Telegram, or a verified email before retrying meal capture setup.",
        retryable: false,
      },
    });
    expect(mocks.issueMealPhotoCaptureEnrollment).not.toHaveBeenCalled();
  });

  it("rejects never-consented scoped uploads before validation or staging", async () => {
    mocks.requireActiveMealPhotoCaptureEnrollment.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_CONSENT_REQUIRED",
        httpStatus: 403,
        message: "Accept the Murph legal consent before continuing.",
      }),
    );

    const response = await photosRoute.POST(new Request(
      "https://app.example.test/photos",
      { body: requestBody(JPEG), method: "POST" },
    ));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "HOSTED_CONSENT_REQUIRED",
        message: "Accept the Murph legal consent before continuing.",
      },
    });
    expect(mocks.readAndValidateMealPhotoUpload).not.toHaveBeenCalled();
    expect(mocks.readHostedExecutionControlClientIfConfigured).not.toHaveBeenCalled();
    expect(mocks.stageMealPhoto).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("lets the narrow scoped credential revoke only itself without a body", async () => {
    mocks.isMealPhotoCaptureScopedAuthorization.mockReturnValue(true);
    const request = new Request("https://app.example.test/enrollment", {
      headers: { authorization: "Bearer scoped-upload-token" },
      method: "DELETE",
    });
    const response = await enrollmentRoute.DELETE(request);

    expect(response.status).toBe(200);
    expect(mocks.assertMealPhotoCaptureRequestHasNoBody).toHaveBeenCalledWith(request);
    expect(mocks.revokeMealPhotoCaptureEnrollmentForScopedToken).toHaveBeenCalledWith({
      prisma: expect.anything(),
      token: "scoped-upload-token",
    });
    expect(mocks.requirePrivyMemberAuthFromBearerToken).not.toHaveBeenCalled();
  });

  it("activates a prepared credential through an exact bodyless scoped PUT", async () => {
    const request = new Request("https://app.example.test/enrollment", {
      headers: { authorization: "Bearer scoped-upload-token" },
      method: "PUT",
    });
    const response = await enrollmentRoute.PUT(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ activated: true });
    expect(mocks.assertMealPhotoCaptureRequestHasNoBody).toHaveBeenCalledWith(request);
    expect(mocks.activateMealPhotoCaptureEnrollmentForScopedToken).toHaveBeenCalledWith({
      prisma: expect.anything(),
      token: "scoped-upload-token",
    });
    expect(mocks.requirePrivyMemberAuthFromBearerToken).not.toHaveBeenCalled();
  });

  it("keeps paid activation denial feature-scoped for paused companion sessions", async () => {
    mocks.activateMealPhotoCaptureEnrollmentForScopedToken.mockRejectedValueOnce(
      hostedOnboardingError({
        code: "HOSTED_ACCESS_REQUIRED",
        httpStatus: 403,
        message: "Your subscription is paused. Resume billing before continuing.",
      }),
    );
    const request = new Request("https://app.example.test/enrollment", {
      headers: { authorization: "Bearer scoped-upload-token" },
      method: "PUT",
    });

    const response = await enrollmentRoute.PUT(request);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "MEAL_PHOTO_CAPTURE_ACTIVE_ACCESS_REQUIRED",
      },
    });
  });

  it("keeps identity-authenticated revocation available without active billing", async () => {
    mocks.isMealPhotoCaptureScopedAuthorization.mockReturnValue(false);
    const request = jsonRequest(
      "https://app.example.test/enrollment",
      { appInstallationId: ENROLLMENT_REQUEST.appInstallationId, schemaVersion: 1 },
      "DELETE",
    );
    const response = await enrollmentRoute.DELETE(request);

    expect(response.status).toBe(200);
    expect(mocks.requirePrivyMemberAuthFromBearerToken).toHaveBeenCalledWith(
      request,
      expect.anything(),
    );
    expect(mocks.requireActivePrivyMemberAuthFromBearerToken).not.toHaveBeenCalled();
    expect(mocks.revokeMealPhotoCaptureEnrollmentForMember).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: expect.anything(),
      request: {
        appInstallationId: ENROLLMENT_REQUEST.appInstallationId,
        schemaVersion: 1,
      },
    });
  });

  it("stages raw bytes privately and appends only the metadata wake", async () => {
    const request = new Request("https://app.example.test/photos", {
      body: requestBody(JPEG),
      method: "POST",
    });
    const response = await photosRoute.POST(request);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ accepted: true, duplicate: false });
    expect(mocks.stageMealPhoto).toHaveBeenCalledWith({
      bytes: JPEG,
      captureId: CAPTURE_ID,
      sha256: "b".repeat(64),
      userId: MEMBER_ID,
    });
    expect(mocks.buildHostedExecutionMealPhotoCapturedWake).toHaveBeenCalledWith({
      byteLength: JPEG.byteLength,
      captureId: CAPTURE_ID,
      capturedAt: CAPTURED_AT,
      directRoute: {
        channel: "linq",
        threadId: "linq-thread-1",
      },
      eventId: EVENT_ID,
      mealPhotoKey: "meal-photo-key",
      memberId: MEMBER_ID,
      occurredAt: CAPTURED_AT,
      sha256: "b".repeat(64),
    });
    expect(mocks.appendHostedMealPhotoMailboxEnvelopeTx).toHaveBeenCalledWith({
      envelope: buildMealPhotoWake(),
      tx: { label: "tx" },
    });
    expect(
      mocks.assertCurrentMealPhotoCaptureEnrollmentTx.mock.invocationCallOrder[0],
    ).toBeLessThan(
      mocks.appendHostedMealPhotoMailboxEnvelopeTx.mock.invocationCallOrder[0]
        ?? Number.MAX_SAFE_INTEGER,
    );
    expect(mocks.assertCurrentMealPhotoCaptureEnrollmentTx).toHaveBeenCalledWith({
      enrollment: {
        enrollmentId: ENROLLMENT_ID,
        memberId: MEMBER_ID,
      },
      prisma: { label: "tx" },
      request,
    });
    expect(mocks.deleteMealPhoto).not.toHaveBeenCalled();
    expect(mocks.readCurrentHostedMemberDirectRoute).toHaveBeenCalledWith({
      memberId: MEMBER_ID,
      prisma: expect.anything(),
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledWith({
      expectedUserId: MEMBER_ID,
      mailboxItemId: "mailbox_1",
    });
  });

  it("requires a current private route again before accepting an upload", async () => {
    mocks.readCurrentHostedMemberDirectRoute.mockResolvedValueOnce(null);

    const response = await photosRoute.POST(new Request(
      "https://app.example.test/photos",
      { body: requestBody(JPEG), method: "POST" },
    ));

    expect(response.status).toBe(409);
    expect(mocks.stageMealPhoto).not.toHaveBeenCalled();
    expect(mocks.appendHostedMealPhotoMailboxEnvelopeTx).not.toHaveBeenCalled();
  });

  it("re-signals exact duplicates and rejects conflicting capture reuse", async () => {
    mocks.appendHostedMealPhotoMailboxEnvelopeTx.mockResolvedValueOnce({
      claimedMealPhotoKey: "canonical-meal-photo-key",
      dedupeConflict: false,
      duplicate: true,
      item: { id: "mailbox_existing" },
    });
    const duplicateResponse = await photosRoute.POST(new Request(
      "https://app.example.test/photos",
      { body: requestBody(JPEG), method: "POST" },
    ));
    expect(duplicateResponse.status).toBe(202);
    await expect(duplicateResponse.json()).resolves.toEqual({
      accepted: true,
      duplicate: true,
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenLastCalledWith({
      expectedUserId: MEMBER_ID,
      mailboxItemId: "mailbox_existing",
    });
    expect(mocks.deleteMealPhoto).toHaveBeenLastCalledWith({
      mealPhotoKey: "meal-photo-key",
      userId: MEMBER_ID,
    });

    mocks.appendHostedMealPhotoMailboxEnvelopeTx.mockResolvedValueOnce({
      claimedMealPhotoKey: "meal-photo-key",
      dedupeConflict: true,
      duplicate: true,
      item: { id: "mailbox_existing" },
    });
    mocks.readHostedMailboxWakeAfterDedupeLockTx.mockResolvedValueOnce(
      buildMealPhotoWake("canonical-meal-photo-key"),
    );
    const conflictResponse = await photosRoute.POST(new Request(
      "https://app.example.test/photos",
      { body: requestBody(JPEG), method: "POST" },
    ));
    expect(conflictResponse.status).toBe(422);
    expect(mocks.deleteMealPhoto).toHaveBeenCalledWith({
      mealPhotoKey: "meal-photo-key",
      userId: MEMBER_ID,
    });
    expect(mocks.signalHostedMailboxAppendRuntime).toHaveBeenCalledTimes(1);
  });

  it("deletes staging when final authority revalidation fails", async () => {
    mocks.assertCurrentMealPhotoCaptureEnrollmentTx.mockRejectedValueOnce(
      new Error("authorization changed"),
    );
    const response = await photosRoute.POST(new Request(
      "https://app.example.test/photos",
      { body: requestBody(JPEG), method: "POST" },
    ));

    expect(response.status).toBe(500);
    expect(mocks.appendHostedMealPhotoMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.deleteMealPhoto).toHaveBeenCalledWith({
      mealPhotoKey: "meal-photo-key",
      userId: MEMBER_ID,
    });
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("deletes staging when the mailbox append fails", async () => {
    mocks.appendHostedMealPhotoMailboxEnvelopeTx.mockRejectedValueOnce(
      new Error("append failed"),
    );
    const response = await photosRoute.POST(new Request(
      "https://app.example.test/photos",
      { body: requestBody(JPEG), method: "POST" },
    ));

    expect(response.status).toBe(500);
    expect(mocks.deleteMealPhoto).toHaveBeenCalledWith({
      mealPhotoKey: "meal-photo-key",
      userId: MEMBER_ID,
    });
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("retains staging when an ambiguous append committed its exact object", async () => {
    mocks.appendHostedMealPhotoMailboxEnvelopeTx.mockRejectedValueOnce(
      new Error("append response lost"),
    );
    mocks.readHostedMailboxWakeAfterDedupeLockTx.mockResolvedValueOnce(
      buildMealPhotoWake(),
    );
    const response = await photosRoute.POST(new Request(
      "https://app.example.test/photos",
      { body: requestBody(JPEG), method: "POST" },
    ));

    expect(response.status).toBe(500);
    expect(mocks.readHostedMailboxWakeAfterDedupeLockTx).toHaveBeenCalledWith({
      dedupeKey: EVENT_ID,
      tx: { label: "tx" },
      userId: MEMBER_ID,
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.deleteMealPhoto).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("retains staging when mailbox ownership cannot be reconciled", async () => {
    mocks.appendHostedMealPhotoMailboxEnvelopeTx.mockRejectedValueOnce(
      new Error("append response lost"),
    );
    mocks.readHostedMailboxWakeAfterDedupeLockTx.mockRejectedValueOnce(
      new Error("mailbox unavailable"),
    );
    const response = await photosRoute.POST(new Request(
      "https://app.example.test/photos",
      { body: requestBody(JPEG), method: "POST" },
    ));

    expect(response.status).toBe(500);
    expect(mocks.deleteMealPhoto).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("keeps the original conflict response when staging cleanup fails", async () => {
    mocks.appendHostedMealPhotoMailboxEnvelopeTx.mockResolvedValueOnce({
      claimedMealPhotoKey: "meal-photo-key",
      dedupeConflict: true,
      duplicate: true,
      item: { id: "mailbox_existing" },
    });
    mocks.deleteMealPhoto.mockRejectedValueOnce(new Error("delete failed"));
    const response = await photosRoute.POST(new Request(
      "https://app.example.test/photos",
      { body: requestBody(JPEG), method: "POST" },
    ));

    expect(response.status).toBe(422);
    expect(mocks.deleteMealPhoto).toHaveBeenCalledWith({
      mealPhotoKey: "meal-photo-key",
      userId: MEMBER_ID,
    });
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });

  it("fails closed before mailbox append when private storage is unavailable", async () => {
    mocks.readHostedExecutionControlClientIfConfigured.mockReturnValue(null);
    const response = await photosRoute.POST(new Request(
      "https://app.example.test/photos",
      { body: requestBody(JPEG), method: "POST" },
    ));

    expect(response.status).toBe(503);
    expect(mocks.appendHostedMealPhotoMailboxEnvelopeTx).not.toHaveBeenCalled();
    expect(mocks.signalHostedMailboxAppendRuntime).not.toHaveBeenCalled();
  });
});

function jsonRequest(url: string, body: unknown, method = "POST"): Request {
  return new Request(url, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method,
  });
}

function requestBody(body: Buffer): ArrayBuffer {
  return Uint8Array.from(body).buffer;
}
