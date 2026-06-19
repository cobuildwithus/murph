import { createHash, randomBytes } from "node:crypto";

type ComputerIdPrefix = "hcp" | "hcr" | "hch";

export function createComputerId(prefix: ComputerIdPrefix): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

export function createComputerHandoffToken(): string {
  return `mch_${randomBytes(32).toString("base64url")}`;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}
