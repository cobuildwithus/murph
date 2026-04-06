import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { generateIncurConfigSchema, configSchemaPath, packageDir } from './incur-config-schema.js'

const generatedConfigSchema = await generateIncurConfigSchema()
await writeFile(configSchemaPath, generatedConfigSchema)

console.log(path.relative(packageDir, configSchemaPath))
