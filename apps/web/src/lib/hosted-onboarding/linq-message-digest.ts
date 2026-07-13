import { sha256Hex } from "../primitives";

export function createHostedLinqTextPartDigest(value: string): string {
  return sha256Hex(`hosted-linq-text-part.v1\0${value}`);
}
