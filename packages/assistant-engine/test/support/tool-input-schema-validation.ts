import { Ajv2020 } from 'ajv/dist/2020.js'
import { fullFormats } from 'ajv-formats/dist/formats.js'

// Independent JSON Schema validation; never coerce, default, or strip input.
const validator = new Ajv2020({ allErrors: true, strictTypes: false, formats: fullFormats })

export function compileToolInputSchema(schema: Record<string, unknown>) {
  return validator.compile(schema)
}
