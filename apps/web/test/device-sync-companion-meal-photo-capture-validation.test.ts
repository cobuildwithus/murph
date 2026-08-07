import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  assertMealPhotoCaptureRequestHasNoBody,
  isMealPhotoCaptureScopedAuthorization,
  parseMealPhotoCaptureEnrollmentRequest,
  parseMealPhotoCaptureRevocationRequest,
  readAndValidateMealPhotoUpload,
} from "../src/lib/device-sync/meal-photo-capture";

const INSTALLATION_ID = "F47AC10B-58CC-4372-A567-0E02B2C3D479";
const CAPTURE_ID = "a".repeat(64);

describe("meal photo capture validation", () => {
  it("normalizes the native UUID while keeping the enrollment body closed", () => {
    expect(parseMealPhotoCaptureEnrollmentRequest({
      appInstallationId: INSTALLATION_ID,
      appVersion: "1.2.3",
      schemaVersion: 1,
    })).toEqual({
      appInstallationId: INSTALLATION_ID.toLowerCase(),
      appVersion: "1.2.3",
      schemaVersion: 1,
    });

    expect(() => parseMealPhotoCaptureEnrollmentRequest({
      appInstallationId: INSTALLATION_ID,
      appVersion: "1.2.3",
      phoneNumber: "not-accepted",
      schemaVersion: 1,
    })).toThrow("unsupported field");
  });

  it("requires the closed identity revocation contract", () => {
    expect(parseMealPhotoCaptureRevocationRequest({
      appInstallationId: INSTALLATION_ID,
      schemaVersion: 1,
    })).toEqual({
      appInstallationId: INSTALLATION_ID.toLowerCase(),
      schemaVersion: 1,
    });
    expect(parseMealPhotoCaptureRevocationRequest({
      appInstallationId: INSTALLATION_ID,
      authorityRevision: 1,
      schemaVersion: 2,
    })).toEqual({
      appInstallationId: INSTALLATION_ID.toLowerCase(),
      authorityRevision: 1,
      schemaVersion: 2,
    });
    expect(() => parseMealPhotoCaptureRevocationRequest({
      appInstallationId: INSTALLATION_ID,
      schemaVersion: 2,
    })).toThrow("authorityRevision must be an integer");
  });

  it("accepts only closed schema-v2 enrollment bodies with a Postgres Int revision", () => {
    expect(parseMealPhotoCaptureEnrollmentRequest({
      appInstallationId: INSTALLATION_ID,
      appVersion: "1.2.3",
      authorityRevision: 2_147_483_647,
      schemaVersion: 2,
    })).toEqual({
      appInstallationId: INSTALLATION_ID.toLowerCase(),
      appVersion: "1.2.3",
      authorityRevision: 2_147_483_647,
      schemaVersion: 2,
    });

    for (const authorityRevision of [0, -1, 1.5, 2_147_483_648, "1"]) {
      expect(() => parseMealPhotoCaptureEnrollmentRequest({
        appInstallationId: INSTALLATION_ID,
        appVersion: "1.2.3",
        authorityRevision,
        schemaVersion: 2,
      })).toThrow("authorityRevision must be an integer between 1 and 2147483647");
    }

    expect(() => parseMealPhotoCaptureEnrollmentRequest({
      appInstallationId: INSTALLATION_ID,
      appVersion: "1.2.3",
      authorityRevision: 1,
      schemaVersion: 2,
      unexpected: true,
    })).toThrow("unsupported field");
  });

  it("distinguishes the narrow scoped token from Privy identity authority", () => {
    const scopedToken = `murph_meal_photo_${"a".repeat(43)}`;
    expect(isMealPhotoCaptureScopedAuthorization(new Request("https://example.test", {
      headers: { authorization: `Bearer ${scopedToken}` },
    }))).toBe(true);
    expect(isMealPhotoCaptureScopedAuthorization(new Request("https://example.test", {
      headers: { authorization: "Bearer privy-identity-token" },
    }))).toBe(false);
  });

  it("keeps scoped activation and revocation bodyless", async () => {
    await expect(assertMealPhotoCaptureRequestHasNoBody(new Request(
      "https://example.test/enrollment",
      { method: "PUT" },
    ))).resolves.toBeUndefined();
    await expect(assertMealPhotoCaptureRequestHasNoBody(new Request(
      "https://example.test/enrollment",
      { body: "x", method: "PUT" },
    ))).rejects.toMatchObject({
      code: "MEAL_PHOTO_CAPTURE_REQUEST_INVALID",
      httpStatus: 400,
    });
  });

  it("accepts a bounded metadata-free JPEG and derives server-owned facts", async () => {
    const jpeg = createMinimalJpeg({ height: 2, width: 3 });
    const upload = await readAndValidateMealPhotoUpload(createUploadRequest(jpeg));

    expect(upload).toMatchObject({
      bytes: jpeg,
      captureId: CAPTURE_ID,
      capturedAt: "2026-07-12T16:30:45.000Z",
      height: 2,
      width: 3,
    });
    expect(upload.sha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it.each([
    ...Array.from({ length: 16 }, (_, index) => ({
      label: `APP${index}`,
      marker: 0xe0 + index,
    })),
    { label: "comment", marker: 0xfe },
  ])("rejects $label metadata before and between JPEG scans", async ({ marker }) => {
    const metadataSegment = Buffer.from([0xff, marker, 0x00, 0x04, 0x00, 0x00]);
    const jpeg = createMinimalJpeg({
      headerSegment: metadataSegment,
    });
    const multiScanJpeg = createMinimalJpeg({
      trailingSegments: Buffer.concat([
        metadataSegment,
        Buffer.from([
          0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
          0x00,
        ]),
      ]),
    });

    await expect(readAndValidateMealPhotoUpload(createUploadRequest(jpeg)))
      .rejects.toMatchObject({
        code: "MEAL_PHOTO_UPLOAD_INVALID",
        httpStatus: 422,
      });
    await expect(readAndValidateMealPhotoUpload(createUploadRequest(multiScanJpeg)))
      .rejects.toMatchObject({
        code: "MEAL_PHOTO_UPLOAD_INVALID",
        httpStatus: 422,
      });
  });

  it("accepts stuffed entropy and restart markers across multiple scans", async () => {
    const jpeg = createMinimalJpeg({
      scanData: Buffer.from([0x11, 0xff, 0x00, 0xff, 0xd0, 0x22]),
      trailingSegments: Buffer.from([
        0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
        0x33,
      ]),
    });

    await expect(readAndValidateMealPhotoUpload(createUploadRequest(jpeg)))
      .resolves.toMatchObject({ height: 2, width: 3 });
  });

  it("rejects unsupported media, invalid dimensions, and oversized bodies", async () => {
    const jpeg = createMinimalJpeg({ height: 4097, width: 2 });
    await expect(readAndValidateMealPhotoUpload(createUploadRequest(jpeg)))
      .rejects.toMatchObject({ code: "MEAL_PHOTO_UPLOAD_INVALID", httpStatus: 422 });

    await expect(readAndValidateMealPhotoUpload(createUploadRequest(Buffer.from("not-jpeg"), {
      contentType: "image/png",
    }))).rejects.toMatchObject({
      code: "MEAL_PHOTO_CONTENT_TYPE_UNSUPPORTED",
      httpStatus: 415,
    });

    const oversized = new Request("https://example.test/photos", {
      body: requestBody(Buffer.from([0])),
      headers: uploadHeaders({
        contentLength: String(4 * 1024 * 1024 + 1),
      }),
      method: "POST",
    });
    await expect(readAndValidateMealPhotoUpload(oversized)).rejects.toMatchObject({
      code: "MEAL_PHOTO_BODY_TOO_LARGE",
      httpStatus: 413,
    });
  });
});

function createUploadRequest(
  body: Buffer,
  options: { contentType?: string } = {},
): Request {
  return new Request("https://example.test/photos", {
    body: requestBody(body),
    headers: uploadHeaders({ contentType: options.contentType }),
    method: "POST",
  });
}

function requestBody(body: Buffer): ArrayBuffer {
  return Uint8Array.from(body).buffer;
}

function uploadHeaders(input: {
  contentLength?: string;
  contentType?: string;
} = {}): HeadersInit {
  return {
    ...(input.contentLength ? { "content-length": input.contentLength } : {}),
    "content-type": input.contentType ?? "image/jpeg",
    "idempotency-key": CAPTURE_ID,
    "x-murph-captured-at": "2026-07-12T12:30:45-04:00",
    "x-murph-meal-capture-schema": "1",
  };
}

function createMinimalJpeg(input: {
  headerSegment?: Buffer;
  height?: number;
  scanData?: Buffer;
  trailingSegments?: Buffer;
  width?: number;
} = {}): Buffer {
  const height = input.height ?? 2;
  const width = input.width ?? 3;
  return Buffer.from([
    0xff, 0xd8,
    ...(input.headerSegment ?? Buffer.alloc(0)),
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
    ...(input.scanData ?? Buffer.from([0x00])),
    ...(input.trailingSegments ?? Buffer.alloc(0)),
    0xff, 0xd9,
  ]);
}
