import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  configSchemaPath,
  generateIncurArtifacts,
  incurGeneratedTypesPath,
  packageDir,
} from './incur-config-schema.js'

const generatedArtifacts = await generateIncurArtifacts()
await writeFile(configSchemaPath, generatedArtifacts.configSchema)
await writeFile(incurGeneratedTypesPath, generatedArtifacts.types)

console.log(path.relative(packageDir, configSchemaPath))
console.log(path.relative(packageDir, incurGeneratedTypesPath))
