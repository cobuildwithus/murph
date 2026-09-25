import * as z from '@murphai/contracts/zod-runtime'

export const dailyFoodTimeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u, 'Expected a 24-hour HH:MM time.')

export function slugifyFoodLookup(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
}
