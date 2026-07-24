import "server-only";

import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import { readRawBodyBuffer } from "../http";
import {
  openHostedUserSecureBoxString,
  sealHostedUserSecureBoxString,
} from "../hosted-crypto/secure-box";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { assertActiveHostedMemberAccessAllowed } from "../hosted-onboarding/member-access";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  type HostedOnboardingReadClient,
  lockHostedMemberRow,
  lockHostedMemberSponsoredAccessRows,
} from "../hosted-onboarding/shared";
import { assertHostedHistoricalLaunchConsentGranted } from "../legal/consent";

export const MEAL_PHOTO_CAPTURE_SCHEMA_VERSION_HEADER = "x-murph-meal-capture-schema";
export const MEAL_PHOTO_CAPTURE_CAPTURED_AT_HEADER = "x-murph-captured-at";
export const MEAL_PHOTO_CAPTURE_IDEMPOTENCY_HEADER = "idempotency-key";
export const MEAL_PHOTO_CAPTURE_MAX_JPEG_BYTES = 4 * 1024 * 1024;

const MEAL_PHOTO_CAPTURE_TOKEN_PREFIX = "murph_meal_photo_";
const MEAL_PHOTO_CAPTURE_TOKEN_PATTERN = /^murph_meal_photo_[A-Za-z0-9_-]{43}$/u;
const MEAL_PHOTO_CAPTURE_CAPTURE_ID_PATTERN = /^[0-9a-f]{64}$/u;
const MEAL_PHOTO_CAPTURE_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MEAL_PHOTO_CAPTURE_APP_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/u;
const MEAL_PHOTO_CAPTURE_ENROLLMENT_ID_PREFIX = "hmp_";
const MEAL_PHOTO_CAPTURE_ENROLLMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MEAL_PHOTO_CAPTURE_TOKEN_BYTES = 32;
const MEAL_PHOTO_CAPTURE_ENROLLMENT_ID_BYTES = 16;
const MEAL_PHOTO_CAPTURE_SECRET_BYTES = 32;
const MEAL_PHOTO_CAPTURE_SECRET_SCOPE = "meal-photo-capture-idempotency";
const MEAL_PHOTO_CAPTURE_ENROLLMENT_TABLE = "hosted_meal_photo_capture_enrollment";
const MEAL_PHOTO_CAPTURE_SECRET_FIELD = "idempotency_secret_encrypted";
const MEAL_PHOTO_CAPTURE_ALLOWED_ENROLLMENT_KEYS = new Set([
  "appInstallationId",
  "appVersion",
  "schemaVersion",
]);
const MEAL_PHOTO_CAPTURE_ALLOWED_REVOCATION_KEYS = new Set([
  "appInstallationId",
  "schemaVersion",
]);
const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0,
  0xc1,
  0xc2,
  0xc3,
  0xc5,
  0xc6,
  0xc7,
  0xc9,
  0xca,
  0xcb,
  0xcd,
  0xce,
  0xcf,
]);
const JPEG_APPLICATION_MARKER_MIN = 0xe0;
const JPEG_APPLICATION_MARKER_MAX = 0xef;
const JPEG_COMMENT_MARKER = 0xfe;

export interface MealPhotoCaptureEnrollmentRequest {
  appInstallationId: string;
  appVersion: string;
  schemaVersion: 1;
}

export interface MealPhotoCaptureRevocationRequest {
  appInstallationId: string;
  schemaVersion: 1;
}

export interface MealPhotoCaptureEnrollmentResponse {
  expiresAt: Date;
  idempotencySecret: string;
  uploadToken: string;
}

export interface ActiveMealPhotoCaptureEnrollment {
  enrollmentId: string;
  expiresAt: Date;
  memberId: string;
}

export interface ValidatedMealPhotoUpload {
  bytes: Buffer;
  captureId: string;
  capturedAt: string;
  height: number;
  sha256: string;
  width: number;
}

export function parseMealPhotoCaptureEnrollmentRequest(
  body: Record<string, unknown>,
): MealPhotoCaptureEnrollmentRequest {
  assertExactKeys(body, MEAL_PHOTO_CAPTURE_ALLOWED_ENROLLMENT_KEYS, "enrollment");
  return {
    appInstallationId: parseCanonicalInstallationId(body.appInstallationId),
    appVersion: parseAppVersion(body.appVersion),
    schemaVersion: parseSchemaVersion(body.schemaVersion),
  };
}

export function parseMealPhotoCaptureRevocationRequest(
  body: Record<string, unknown>,
): MealPhotoCaptureRevocationRequest {
  assertExactKeys(body, MEAL_PHOTO_CAPTURE_ALLOWED_REVOCATION_KEYS, "revocation");
  return {
    appInstallationId: parseCanonicalInstallationId(body.appInstallationId),
    schemaVersion: parseSchemaVersion(body.schemaVersion),
  };
}

export async function issueMealPhotoCaptureEnrollment(input: {
  memberId: string;
  now?: Date;
  prisma: PrismaClient;
  request: MealPhotoCaptureEnrollmentRequest;
}): Promise<MealPhotoCaptureEnrollmentResponse> {
  const now = input.now ?? new Date();
  const installationIdHash = hashMealPhotoCaptureValue(input.request.appInstallationId);

  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    const existing = await tx.hostedMealPhotoCaptureEnrollment.findUnique({
      where: {
        memberId_installationIdHash: {
          installationIdHash,
          memberId: input.memberId,
        },
      },
    });
    const enrollmentId = existing?.id ?? generateMealPhotoCaptureEnrollmentId();
    const idempotencySecret = existing && !existing.revokedAt
      ? await openMealPhotoCaptureIdempotencySecret({
          enrollmentId,
          memberId: input.memberId,
          prisma: tx,
          value: existing.idempotencySecretEncrypted,
        })
      : generateMealPhotoCaptureIdempotencySecret();
    const idempotencySecretEncrypted = existing && !existing.revokedAt
      ? existing.idempotencySecretEncrypted
      : await sealMealPhotoCaptureIdempotencySecret({
          enrollmentId,
          memberId: input.memberId,
          prisma: tx,
          value: idempotencySecret,
        });
    const uploadToken = generateMealPhotoCaptureToken();
    const expiresAt = new Date(now.getTime() + MEAL_PHOTO_CAPTURE_ENROLLMENT_TTL_MS);

    await tx.hostedMealPhotoCaptureEnrollment.upsert({
      create: {
        createdAt: now,
        expiresAt,
        id: enrollmentId,
        idempotencySecretEncrypted,
        installationIdHash,
        memberId: input.memberId,
        revokeReason: null,
        revokedAt: null,
        updatedAt: now,
        uploadTokenHash: hashMealPhotoCaptureValue(uploadToken),
      },
      update: {
        expiresAt,
        idempotencySecretEncrypted,
        revokeReason: null,
        revokedAt: null,
        updatedAt: now,
        uploadTokenHash: hashMealPhotoCaptureValue(uploadToken),
      },
      where: {
        memberId_installationIdHash: {
          installationIdHash,
          memberId: input.memberId,
        },
      },
    });

    return {
      expiresAt,
      idempotencySecret,
      uploadToken,
    };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function revokeMealPhotoCaptureEnrollmentForMember(input: {
  memberId: string;
  now?: Date;
  prisma: PrismaClient;
  request: MealPhotoCaptureRevocationRequest;
}): Promise<{ revoked: boolean }> {
  const now = input.now ?? new Date();
  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    const result = await tx.hostedMealPhotoCaptureEnrollment.updateMany({
      data: {
        revokeReason: "member_disabled",
        revokedAt: now,
        updatedAt: now,
      },
      where: {
        installationIdHash: hashMealPhotoCaptureValue(input.request.appInstallationId),
        memberId: input.memberId,
        revokedAt: null,
      },
    });

    return { revoked: result.count > 0 };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function revokeMealPhotoCaptureEnrollmentForScopedToken(input: {
  now?: Date;
  prisma: PrismaClient;
  token: string;
}): Promise<{ revoked: boolean }> {
  const token = normalizeMealPhotoCaptureToken(input.token);
  if (!token) {
    throw mealPhotoCaptureAuthRequired();
  }
  const now = input.now ?? new Date();
  const enrollment = await input.prisma.hostedMealPhotoCaptureEnrollment.findUnique({
    where: {
      uploadTokenHash: hashMealPhotoCaptureValue(token),
    },
  });
  if (!enrollment || enrollment.revokedAt) {
    throw mealPhotoCaptureAuthRequired();
  }

  return input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, enrollment.memberId);
    const result = await tx.hostedMealPhotoCaptureEnrollment.updateMany({
      data: {
        revokeReason: "scoped_token_revoked",
        revokedAt: now,
        updatedAt: now,
      },
      where: {
        id: enrollment.id,
        revokedAt: null,
      },
    });

    if (result.count === 0) {
      throw mealPhotoCaptureAuthRequired();
    }

    return { revoked: true };
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

export async function requireActiveMealPhotoCaptureEnrollment(input: {
  now?: Date;
  prisma: HostedOnboardingReadClient;
  request: Request;
}): Promise<ActiveMealPhotoCaptureEnrollment> {
  const token = normalizeMealPhotoCaptureToken(readBearerToken(input.request));
  if (!token) {
    throw mealPhotoCaptureAuthRequired();
  }
  const now = input.now ?? new Date();
  const enrollment = await input.prisma.hostedMealPhotoCaptureEnrollment.findUnique({
    where: {
      uploadTokenHash: hashMealPhotoCaptureValue(token),
    },
  });
  if (!enrollment || enrollment.revokedAt || enrollment.expiresAt <= now) {
    throw mealPhotoCaptureAuthRequired();
  }

  await assertActiveHostedMemberAccessAllowed({
    memberId: enrollment.memberId,
    prisma: input.prisma,
  });
  // Uploads happen from the phone with no consent UI, so stale launch-document
  // acceptance must not interrupt an active enrollment; members with no grant at
  // all still fail closed. New enrollments keep requiring the current versions.
  await assertHostedHistoricalLaunchConsentGranted({
    memberId: enrollment.memberId,
    prisma: input.prisma,
  });

  return {
    enrollmentId: enrollment.id,
    expiresAt: enrollment.expiresAt,
    memberId: enrollment.memberId,
  };
}

export async function assertCurrentMealPhotoCaptureEnrollmentTx(input: {
  enrollment: ActiveMealPhotoCaptureEnrollment;
  now?: Date;
  prisma: Prisma.TransactionClient;
  request: Request;
}): Promise<void> {
  await lockHostedMemberRow(input.prisma, input.enrollment.memberId);
  await lockHostedMemberSponsoredAccessRows(input.prisma, input.enrollment.memberId);
  const current = await requireActiveMealPhotoCaptureEnrollment({
    now: input.now,
    prisma: input.prisma,
    request: input.request,
  });
  if (
    current.enrollmentId !== input.enrollment.enrollmentId
    || current.memberId !== input.enrollment.memberId
  ) {
    throw mealPhotoCaptureAuthRequired();
  }
}

export function isMealPhotoCaptureScopedAuthorization(request: Request): boolean {
  const token = readBearerToken(request);
  return typeof token === "string" && token.startsWith(MEAL_PHOTO_CAPTURE_TOKEN_PREFIX);
}

export function requireMealPhotoCaptureScopedToken(request: Request): string {
  const token = normalizeMealPhotoCaptureToken(readBearerToken(request));
  if (!token) {
    throw mealPhotoCaptureAuthRequired();
  }
  return token;
}

export async function assertMealPhotoCaptureRequestHasNoBody(request: Request): Promise<void> {
  let body: Buffer;
  try {
    body = await readRawBodyBuffer(request, { limitBytes: 1 });
  } catch (error) {
    if (error instanceof RangeError) {
      throw mealPhotoCaptureRequestInvalid("Scoped revocation does not accept a request body.");
    }
    throw error;
  }
  if (body.byteLength !== 0) {
    throw mealPhotoCaptureRequestInvalid("Scoped revocation does not accept a request body.");
  }
}

export async function readAndValidateMealPhotoUpload(
  request: Request,
): Promise<ValidatedMealPhotoUpload> {
  if (request.headers.get("content-type")?.trim().toLowerCase() !== "image/jpeg") {
    throw hostedOnboardingError({
      code: "MEAL_PHOTO_CONTENT_TYPE_UNSUPPORTED",
      httpStatus: 415,
      message: "Meal photo uploads must be JPEG images.",
    });
  }
  if (request.headers.get(MEAL_PHOTO_CAPTURE_SCHEMA_VERSION_HEADER) !== "1") {
    throw mealPhotoCaptureUploadInvalid("Meal photo schema version is invalid.");
  }
  const captureId = request.headers.get(MEAL_PHOTO_CAPTURE_IDEMPOTENCY_HEADER)?.trim() ?? "";
  if (!MEAL_PHOTO_CAPTURE_CAPTURE_ID_PATTERN.test(captureId)) {
    throw mealPhotoCaptureUploadInvalid("Meal photo idempotency key is invalid.");
  }
  const capturedAt = parseCapturedAt(
    request.headers.get(MEAL_PHOTO_CAPTURE_CAPTURED_AT_HEADER),
  );
  let bytes: Buffer;
  try {
    bytes = await readRawBodyBuffer(request, {
      limitBytes: MEAL_PHOTO_CAPTURE_MAX_JPEG_BYTES,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      throw hostedOnboardingError({
        code: "MEAL_PHOTO_BODY_TOO_LARGE",
        httpStatus: 413,
        message: "Meal photo upload is too large.",
      });
    }
    throw error;
  }
  if (bytes.byteLength === 0) {
    throw mealPhotoCaptureUploadInvalid("Meal photo upload is empty.");
  }
  const dimensions = validateJpegStructure(bytes);

  return {
    bytes,
    captureId,
    capturedAt,
    ...dimensions,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function parseCanonicalInstallationId(value: unknown): string {
  if (typeof value !== "string") {
    throw mealPhotoCaptureRequestInvalid("appInstallationId must be a UUID.");
  }
  const normalized = value.trim().toLowerCase();
  if (!MEAL_PHOTO_CAPTURE_UUID_PATTERN.test(normalized)) {
    throw mealPhotoCaptureRequestInvalid("appInstallationId must be a UUID.");
  }
  return normalized;
}

function parseAppVersion(value: unknown): string {
  if (typeof value !== "string") {
    throw mealPhotoCaptureRequestInvalid("appVersion is invalid.");
  }
  const normalized = value.trim();
  if (!MEAL_PHOTO_CAPTURE_APP_VERSION_PATTERN.test(normalized)) {
    throw mealPhotoCaptureRequestInvalid("appVersion is invalid.");
  }
  return normalized;
}

function parseSchemaVersion(value: unknown): 1 {
  if (value !== 1) {
    throw mealPhotoCaptureRequestInvalid("schemaVersion must be 1.");
  }
  return 1;
}

function assertExactKeys(
  body: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  operation: string,
): void {
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      throw mealPhotoCaptureRequestInvalid(
        `Meal photo ${operation} contains an unsupported field.`,
      );
    }
  }
}

function parseCapturedAt(value: string | null): string {
  const capturedAt = value?.trim() ?? "";
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(capturedAt)
    || !Number.isFinite(Date.parse(capturedAt))
  ) {
    throw mealPhotoCaptureUploadInvalid("Meal photo capture time is invalid.");
  }
  return new Date(capturedAt).toISOString();
}

function validateJpegStructure(bytes: Buffer): { height: number; width: number } {
  if (
    bytes.byteLength < 12
    || bytes[0] !== 0xff
    || bytes[1] !== 0xd8
    || bytes[bytes.byteLength - 2] !== 0xff
    || bytes[bytes.byteLength - 1] !== 0xd9
  ) {
    throw mealPhotoCaptureUploadInvalid("Meal photo JPEG structure is invalid.");
  }

  let offset = 2;
  let dimensions: { height: number; width: number } | null = null;
  let insideScan = false;
  let sawScan = false;

  while (offset < bytes.byteLength) {
    let marker: number | undefined;
    if (insideScan) {
      while (offset < bytes.byteLength) {
        const value = bytes[offset];
        offset += 1;
        if (value !== 0xff) {
          continue;
        }
        while (offset < bytes.byteLength && bytes[offset] === 0xff) {
          offset += 1;
        }
        const scanMarker = bytes[offset];
        offset += 1;
        if (scanMarker === 0x00 || (scanMarker !== undefined
          && scanMarker >= 0xd0
          && scanMarker <= 0xd7)) {
          continue;
        }
        marker = scanMarker;
        break;
      }
      insideScan = false;
    } else {
      if (bytes[offset] !== 0xff) {
        throw mealPhotoCaptureUploadInvalid("Meal photo JPEG structure is invalid.");
      }
      while (offset < bytes.byteLength && bytes[offset] === 0xff) {
        offset += 1;
      }
      marker = bytes[offset];
      offset += 1;
    }

    if (marker === undefined || marker === 0x00 || marker === 0xd8) {
      throw mealPhotoCaptureUploadInvalid("Meal photo JPEG structure is invalid.");
    }
    if (marker === 0xd9) {
      if (!dimensions || !sawScan || offset !== bytes.byteLength) {
        throw mealPhotoCaptureUploadInvalid("Meal photo JPEG structure is invalid.");
      }
      return dimensions;
    }
    if (marker === 0x01) {
      continue;
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      throw mealPhotoCaptureUploadInvalid("Meal photo JPEG structure is invalid.");
    }
    if (offset + 2 > bytes.byteLength) {
      throw mealPhotoCaptureUploadInvalid("Meal photo JPEG structure is invalid.");
    }
    const segmentLength = bytes.readUInt16BE(offset);
    const segmentEnd = offset + segmentLength;
    if (segmentLength < 2 || segmentEnd > bytes.byteLength) {
      throw mealPhotoCaptureUploadInvalid("Meal photo JPEG structure is invalid.");
    }
    if (marker === JPEG_COMMENT_MARKER || (
      marker >= JPEG_APPLICATION_MARKER_MIN
      && marker <= JPEG_APPLICATION_MARKER_MAX
    )) {
      throw mealPhotoCaptureUploadInvalid("Meal photo JPEG contains disallowed metadata.");
    }
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 8 || bytes[offset + 2] !== 8) {
        throw mealPhotoCaptureUploadInvalid("Meal photo JPEG dimensions are invalid.");
      }
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      if (
        height === 0
        || width === 0
        || height > 4096
        || width > 4096
        || height * width > 16_000_000
      ) {
        throw mealPhotoCaptureUploadInvalid("Meal photo JPEG dimensions are invalid.");
      }
      dimensions = { height, width };
    }
    if (marker === 0xda) {
      if (!dimensions) {
        throw mealPhotoCaptureUploadInvalid("Meal photo JPEG dimensions are missing.");
      }
      insideScan = true;
      sawScan = true;
    }
    offset = segmentEnd;
  }

  throw mealPhotoCaptureUploadInvalid("Meal photo JPEG structure is invalid.");
}

function generateMealPhotoCaptureToken(): string {
  return `${MEAL_PHOTO_CAPTURE_TOKEN_PREFIX}${randomBytes(MEAL_PHOTO_CAPTURE_TOKEN_BYTES).toString("base64url")}`;
}

function generateMealPhotoCaptureEnrollmentId(): string {
  return `${MEAL_PHOTO_CAPTURE_ENROLLMENT_ID_PREFIX}${randomBytes(MEAL_PHOTO_CAPTURE_ENROLLMENT_ID_BYTES).toString("base64url")}`;
}

function generateMealPhotoCaptureIdempotencySecret(): string {
  return randomBytes(MEAL_PHOTO_CAPTURE_SECRET_BYTES).toString("base64url");
}

function normalizeMealPhotoCaptureToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return MEAL_PHOTO_CAPTURE_TOKEN_PATTERN.test(normalized) ? normalized : null;
}

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return null;
  }
  const match = /^Bearer ([^\s]+)$/iu.exec(authorization.trim());
  return match?.[1] ?? null;
}

function hashMealPhotoCaptureValue(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function openMealPhotoCaptureIdempotencySecret(input: {
  enrollmentId: string;
  memberId: string;
  prisma: Prisma.TransactionClient;
  value: string;
}): Promise<string> {
  const value = await openHostedUserSecureBoxString({
    aad: mealPhotoCaptureSecretAad(input.enrollmentId),
    lane: "device-sync-token",
    prisma: input.prisma,
    scope: MEAL_PHOTO_CAPTURE_SECRET_SCOPE,
    userId: input.memberId,
    value: input.value,
  });
  if (!value) {
    throw new Error("Meal photo capture idempotency secret could not be opened.");
  }
  return value;
}

async function sealMealPhotoCaptureIdempotencySecret(input: {
  enrollmentId: string;
  memberId: string;
  prisma: Prisma.TransactionClient;
  value: string;
}): Promise<string> {
  const value = await sealHostedUserSecureBoxString({
    aad: mealPhotoCaptureSecretAad(input.enrollmentId),
    lane: "device-sync-token",
    prisma: input.prisma,
    scope: MEAL_PHOTO_CAPTURE_SECRET_SCOPE,
    userId: input.memberId,
    value: input.value,
  });
  if (!value) {
    throw new Error("Meal photo capture idempotency secret could not be sealed.");
  }
  return value;
}

function mealPhotoCaptureSecretAad(enrollmentId: string) {
  return {
    field: MEAL_PHOTO_CAPTURE_SECRET_FIELD,
    purpose: "meal-photo-capture-idempotency-secret",
    rowId: enrollmentId,
    table: MEAL_PHOTO_CAPTURE_ENROLLMENT_TABLE,
  } as const;
}

function mealPhotoCaptureRequestInvalid(message: string) {
  return hostedOnboardingError({
    code: "MEAL_PHOTO_CAPTURE_REQUEST_INVALID",
    httpStatus: 400,
    message,
  });
}

function mealPhotoCaptureUploadInvalid(message: string) {
  return hostedOnboardingError({
    code: "MEAL_PHOTO_UPLOAD_INVALID",
    httpStatus: 422,
    message,
  });
}

function mealPhotoCaptureAuthRequired() {
  return hostedOnboardingError({
    code: "AUTH_REQUIRED",
    httpStatus: 401,
    message: "Meal photo capture authorization is required.",
  });
}
