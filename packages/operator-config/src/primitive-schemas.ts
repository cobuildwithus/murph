import * as z from '@murphai/contracts/zod-runtime'

// Leaf primitives shared by the CLI contract modules. Keeping them here lets
// assistant contracts avoid evaluating the full vault CLI schema surface.

export const isoTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .describe('Timestamp in ISO 8601 format with an explicit UTC offset.')

export const pathSchema = z
  .string()
  .min(1)
  .describe('Filesystem path supplied by the operator.')
