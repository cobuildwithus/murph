import * as z from "./zod-runtime.ts";

export const sleepSessionTypeSchema = z.enum(["main_sleep", "short_sleep", "nap", "unknown"]);
export const sleepSessionStateSchema = z.enum(["tentative", "confirmed"]);
