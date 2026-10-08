import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/src/db/schema/index.ts',
  out: './resources/drizzle',
  strict: true
})
