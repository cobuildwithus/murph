import { PrismaClient } from "@prisma/client";

import { HOSTED_USER_ASSERTION_FIRST_INVALID_OFFSET_SECONDS } from "../auth";
import { isUniqueViolation } from "./prisma-errors";

export class PrismaHostedBrowserAssertionNonceStore {
  readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async consumeBrowserAssertionNonce(input: {
    nonceHash: string;
    userId: string;
    method: string;
    path: string;
    now: string;
    expiresAt: string;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const cleanupCutoff = new Date(
        new Date(input.now).getTime() - HOSTED_USER_ASSERTION_FIRST_INVALID_OFFSET_SECONDS * 1000,
      );

      await tx.deviceBrowserAssertionNonce.deleteMany({
        where: {
          expiresAt: {
            lte: cleanupCutoff,
          },
        },
      });

      try {
        await tx.deviceBrowserAssertionNonce.create({
          data: {
            nonceHash: input.nonceHash,
            userId: input.userId,
            method: input.method,
            path: input.path,
            createdAt: new Date(input.now),
            expiresAt: new Date(input.expiresAt),
          },
        });
        return true;
      } catch (error) {
        if (isUniqueViolation(error)) {
          return false;
        }

        throw error;
      }
    });
  }
}
