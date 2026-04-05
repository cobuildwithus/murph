import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'package',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
  },
})
