import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { expect, it, vi } from "vitest";
import { companionMealsProjectionSchema } from "@murphai/contracts";
vi.mock("server-only", () => ({}));
import { recoverCompanionMealUploadIds } from "../src/lib/device-sync/companion-meal-upload-links";

const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
const databaseUrl = process.env.DATABASE_URL ?? "";
if (enabled && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Upload-link proof requires a local database.");
}

it.skipIf(!enabled)("matches only owner-bound automatic receipts, with one bounded metadata query", async () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("CREATE TEMP TABLE hosted_mailbox_item (user_id text, kind text, dedupe_key text)");
      const captureIds = ["a", "b", "c", "d", "e"].map(value => value.repeat(64));
      await tx.$executeRawUnsafe(`INSERT INTO hosted_mailbox_item VALUES
        ('member_fixture', 'meal-photo.captured', $1),
        ('member_fixture', 'meal-photo.captured', $2),
        ('member_fixture', 'meal-photo.captured', $3),
        ('member_foreign', 'meal-photo.captured', $4),
        ('member_fixture', 'conversation.message', $5)`,
        `meal-photo:enrollment1:${captureIds[0]}`, `meal-photo:enrollment2:${captureIds[0]}`,
        `meal-photo:manual:${captureIds[1]}`, `meal-photo:enrollment3:${captureIds[2]}`,
        `meal-photo:enrollment4:${captureIds[3]}`,
      );
      const meals = captureIds.map((_, i) => ({
        id: `meal_fixture${i}`, eatenAt: "2026-11-01T12:00:00Z", name: null,
        calories: null, proteinGrams: null, carbsGrams: null, fatGrams: null, uploadId: null,
      }));
      const projection = companionMealsProjectionSchema.parse({ schemaVersion: 1, timeZone: "UTC", days: [{
        date: "2026-11-01", calories: null, proteinGrams: null, carbsGrams: null, fatGrams: null,
        mealCount: meals.length, calorieMealCount: 0, meals,
      }] });
      const entities = captureIds.map((captureId, i) => ({ family: "event", kind: "meal", attributes: {
        mealId: meals[i]!.id, source: "device",
        externalRef: { system: "meal-photo-capture", resourceType: "photo", resourceId: captureId },
      } }));
      const query = vi.spyOn(tx, "$queryRaw");
      await recoverCompanionMealUploadIds({ memberId: "member_fixture", prisma: tx, projection, entities });
      expect(query).toHaveBeenCalledTimes(1);
      expect(projection.days[0]!.meals.map(meal => meal.uploadId)).toEqual([captureIds[0], null, null, null, null]);
      // Explicit IDs win and removed meals cannot acquire a link from stale entities.
      projection.days[0]!.meals = [{ ...projection.days[0]!.meals[0]!, uploadId: "explicit-phone-id" }];
      query.mockClear();
      await recoverCompanionMealUploadIds({ memberId: "member_fixture", prisma: tx, projection, entities });
      expect(projection.days[0]!.meals[0]!.uploadId).toBe("explicit-phone-id");
      expect(query).not.toHaveBeenCalled();
      await tx.$executeRawUnsafe("DROP TABLE hosted_mailbox_item");
    });
  } finally {
    await prisma.$disconnect();
  }
});
