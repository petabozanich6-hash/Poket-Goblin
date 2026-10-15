export type TestRow = Record<string, unknown>

export type TestD1 = {
  db: D1Database
  query: (sql: string, ...args: unknown[]) => TestRow[]
  run: (sql: string, ...args: unknown[]) => unknown
  sqlite: unknown
}

export function migrationFiles(upTo?: number): string[]
export function applyMigrations(sqlite: unknown, files: string[]): void
export function createTestD1(options?: { upTo?: number }): TestD1
