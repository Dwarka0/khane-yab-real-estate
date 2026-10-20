/**
 * A small in-memory stand-in for the D1 database.
 *
 * It implements the subset of SQL the API uses (parameterized equality and
 * range comparisons, LIKE, COUNT, INSERT/UPDATE/DELETE, and the atomic
 * rate-limit upsert) so the HTTP routes can be exercised end to end in tests
 * without a live D1 instance. It is a test double, not a database: unsupported
 * statements throw instead of silently returning nothing.
 */

export type Row = Record<string, unknown>;

export interface FakeDbOptions {
  sources?: Row[];
  listings?: Row[];
  userPreferences?: Row[];
  now?: string;
}

const DEFAULT_SOURCE: Row = {
  id: "src-demo",
  name: "نمونه‌ی نمایشی",
  kind: "demo",
  base_url: null,
  allowed_host: null,
  enabled: 1,
  permission_status: "approved",
  permission_reviewed_at: "2026-01-01 00:00:00",
  permission_notes: "test",
};

/** The sources seeded by migration 0005. */
const BUILT_IN_SOURCES: Row[] = [
  DEFAULT_SOURCE,
  { ...DEFAULT_SOURCE, id: "src-manual", name: "ورود دستی اپراتور", kind: "manual" },
  { ...DEFAULT_SOURCE, id: "src-user-link", name: "لینک ارسالی کاربر", kind: "user_link", allowed_host: "divar.ir,sheypoor.com" },
];

function text(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function likeMatch(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(haystack);
}

/** Evaluates one "column <op> ?" condition against a row. */
function evaluate(row: Row, condition: string, value: unknown): boolean {
  const nullCheck = /^([a-z_]+)\s+IS(\s+NOT)?\s+NULL$/i.exec(condition.trim());
  if (nullCheck) {
    const cell = row[nullCheck[1]!];
    const isNull = cell === null || cell === undefined;
    return nullCheck[2] ? !isNull : isNull;
  }
  // A compound condition such as "(expires_at IS NULL OR expires_at > ?)".
  const compound = /^\(\s*([a-z_]+)\s+IS\s+NULL\s+OR\s+([a-z_]+)\s*(>=|<=|>|<|=)\s*\?\s*\)$/i.exec(condition.trim());
  if (compound) {
    const cell = row[compound[1]!];
    if (cell === null || cell === undefined) return true;
    const left = Number(cell);
    const right = Number(value);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
    if (compound[3] === ">=") return left >= right;
    if (compound[3] === "<=") return left <= right;
    if (compound[3] === ">") return left > right;
    return left === right;
  }
  const match = /^([a-z_]+)\s*(COLLATE NOCASE)?\s*(>=|<=|!=|<>|=|>|<|LIKE)\s*(\?|'[^']*'|-?\d+(?:\.\d+)?)$/i.exec(condition.trim());
  if (!match) throw new Error(`Fake D1 cannot evaluate condition: ${condition}`);
  const column = match[1]!;
  const operator = match[3]!.toUpperCase();
  const raw = match[4]!;
  const literal = raw.startsWith("'") ? raw.slice(1, -1) : /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : undefined;
  const operand = literal ?? value;
  if (operator === "LIKE") return likeMatch(text(row[column]), text(operand));
  if (operator === "!=" || operator === "<>") return text(row[column]) !== text(operand);
  if (row[column] === null || row[column] === undefined) return false;
  if (operator === "=") {
    if (match[2]) return text(row[column]).toLowerCase() === text(operand).toLowerCase();
    return text(row[column]) === text(operand);
  }
  const left = Number(row[column]);
  const right = Number(operand);
  if (Number.isFinite(left) && Number.isFinite(right)) {
    if (operator === ">=") return left >= right;
    if (operator === "<=") return left <= right;
    if (operator === ">") return left > right;
    return left < right;
  }
  // Timestamps and other text columns compare chronologically or lexically.
  const leftTime = Date.parse(text(row[column]));
  const rightTime = Date.parse(text(operand));
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    if (operator === ">=") return leftTime >= rightTime;
    if (operator === "<=") return leftTime <= rightTime;
    if (operator === ">") return leftTime > rightTime;
    return leftTime < rightTime;
  }
  const leftText = text(row[column]);
  const rightText = text(operand);
  if (operator === ">=") return leftText >= rightText;
  if (operator === "<=") return leftText <= rightText;
  if (operator === ">") return leftText > rightText;
  return leftText < rightText;
}

/** Evaluates a WHERE clause; only parameterized conditions consume a value. */
function matchesConditions(row: Row, conditions: string[], values: unknown[]): boolean {
  let index = 0;
  for (const condition of conditions) {
    const usesPlaceholder = /\?\s*$/.test(condition);
    const operand = usesPlaceholder ? values[index++] : undefined;
    if (!evaluate(row, condition, operand)) return false;
  }
  return true;
}

export class FakeDatabase {
  readonly sources: Row[];
  readonly listings: Row[];
  readonly userPreferences: Row[];
  readonly ingestionRuns: Row[] = [];
  readonly importErrors: Row[] = [];
  readonly listingObservations: Row[] = [];
  readonly sourcePages: Row[] = [];
  readonly pageCache: Row[] = [];
  readonly rateLimitBuckets = new Map<string, Row>();
  readonly statements: string[] = [];
  rateCount = 0;

  constructor(options: FakeDbOptions = {}) {
    this.sources = options.sources ?? BUILT_IN_SOURCES.map((source) => ({ ...source }));
    this.listings = options.listings ?? [];
    this.userPreferences = options.userPreferences ?? [];
  }

  prepare(sql: string): D1PreparedStatement {
    this.statements.push(sql);
    const values: unknown[] = [];
    const db = this;
    const normalized = sql.replace(/\s+/g, " ").trim();

    const statement = {
      bind(...bound: unknown[]) {
        values.push(...bound);
        return statement;
      },
      async first<T>() {
        return db.runFirst(normalized, values) as T | null;
      },
      async run() {
        return db.runStatement(normalized, values);
      },
      async all<T>() {
        return db.runAll(normalized, values) as { results: T[] };
      },
      __sql: normalized,
      __values: values,
    };
    return statement as unknown as D1PreparedStatement;
  }

  /** D1 batches are transactional; the fake applies statements in order. */
  async batch(statements: D1PreparedStatement[]): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const statement of statements) {
      const internal = statement as unknown as { __sql: string; __values: unknown[] };
      results.push(this.runStatement(internal.__sql, internal.__values));
    }
    return results;
  }

  // ---------------------------------------------------------------- helpers

  private columnsOf(table: string): string[] {
    const row = this.table(table)[0];
    return row ? Object.keys(row) : [];
  }

  private table(name: string): Row[] {
    switch (name) {
      case "sources": return this.sources;
      case "listings": return this.listings;
      case "user_preferences": return this.userPreferences;
      case "ingestion_runs": return this.ingestionRuns;
      case "import_errors": return this.importErrors;
      case "listing_observations": return this.listingObservations;
      case "source_pages": return this.sourcePages;
      case "page_cache": return this.pageCache;
      default: throw new Error(`Fake D1 has no table ${name}`);
    }
  }

  private selectRows(sql: string, values: unknown[]): Row[] {
    const tableMatch = /FROM ([a-z_]+)/i.exec(sql);
    if (!tableMatch) throw new Error(`Fake D1 cannot read table from: ${sql}`);
    const table = tableMatch[1]!;
    const rows = this.table(table).map((row) => ({ ...row }));
    const whereMatch = /WHERE (.+?)(?: ORDER BY| LIMIT| OFFSET|$)/i.exec(sql);
    if (!whereMatch) return rows;
    const conditions = whereMatch[1]!.split(" AND ");
    const filtered = rows.filter((row) => matchesConditions(row, conditions, values));
    const orderMatch = /ORDER BY ([a-z_]+)( ASC| DESC)?/i.exec(sql);
    if (orderMatch) {
      const column = orderMatch[1]!;
      const direction = (orderMatch[2] ?? "ASC").trim().toUpperCase() === "DESC" ? -1 : 1;
      filtered.sort((a, b) => (text(a[column]) < text(b[column]) ? -direction : text(a[column]) > text(b[column]) ? direction : 0));
    }
    const limitMatch = /LIMIT (\?|\d+)/i.exec(sql);
    if (limitMatch) {
      const offsetMatch = /OFFSET (\?|\d+)/i.exec(sql);
      // LIMIT and OFFSET are bound last, in that order.
      const boundTail = [limitMatch[1] === "?" ? Number(values[values.length - (offsetMatch ? 2 : 1)]) : Number(limitMatch[1])];
      const limit = boundTail[0]!;
      const offset = offsetMatch ? (offsetMatch[1] === "?" ? Number(values[values.length - 1]) : Number(offsetMatch[1])) : 0;
      return filtered.slice(offset, offset + limit);
    }
    return filtered;
  }

  private insertInto(sql: string, values: unknown[]): { changes: number } {
    const tableMatch = /INSERT(?: OR IGNORE)? INTO ([a-z_]+)/i.exec(sql);
    if (!tableMatch) throw new Error(`Fake D1 cannot insert into: ${sql}`);
    const table = tableMatch[1]!;
    const columnsMatch = /\(([^)]+)\)\s*VALUES/i.exec(sql);
    if (!columnsMatch) throw new Error(`Fake D1 cannot read columns from: ${sql}`);
    const columns = columnsMatch[1]!.split(",").map((column) => column.trim());
    const valuesMatch = /VALUES\s*\(([^)]*)\)/i.exec(sql);
    const entries = valuesMatch ? valuesMatch[1]!.split(",").map((entry) => entry.trim()) : [];
    const row: Row = {};
    let valueIndex = 0;
    for (let index = 0; index < columns.length; index++) {
      const entry = entries[index];
      if (entry === "?") { row[columns[index]!] = valueIndex < values.length ? values[valueIndex++] ?? null : null; continue; }
      if (!entry || /^CURRENT_TIMESTAMP$/i.test(entry)) { row[columns[index]!] = new Date().toISOString().replace("T", " ").slice(0, 19); continue; }
      row[columns[index]!] = entry.replace(/^'|'$/g, "");
    }
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    if (!row.created_at) row.created_at = now;
    if (!row.updated_at) row.updated_at = now;
    if (!row.first_seen_at) row.first_seen_at = now;
    if (!row.last_seen_at) row.last_seen_at = now;
    if (!row.started_at) row.started_at = now;

    if (sql.includes("ON CONFLICT(id) DO NOTHING") && this.userPreferences.some((preference) => preference.id === row.id)) {
      return { changes: 0 };
    }
    if (table === "rate_limit_buckets") {
      const key = String(row.bucket_key);
      const existing = this.rateLimitBuckets.get(key);
      const count = existing && existing.window_start === row.window_start ? Number(existing.request_count) + 1 : 1;
      this.rateLimitBuckets.set(key, { bucket_key: key, window_start: row.window_start, request_count: count });
      this.rateCount = count;
      return { changes: 1 };
    }
    const conflictMatch = /ON CONFLICT\(([^)]+)\)\s*DO UPDATE/i.exec(sql);
    if (conflictMatch) {
      const conflictColumns = conflictMatch[1]!.split(",").map((column) => column.trim());
      const existing = this.table(table).find((candidate) => conflictColumns.every((column) => text(candidate[column]) === text(row[column])));
      if (existing) {
        const setMatch = /DO UPDATE SET (.+)$/i.exec(sql);
        const assignments = setMatch ? setMatch[1]!.split(",").map((part) => part.trim()) : [];
        const setValues = values.slice(0, assignments.filter((part) => part.includes("?")).length);
        let setIndex = 0;
        for (const assignment of assignments) {
          const parts = /^([a-z0-9_]+)\s*=\s*(.+)$/i.exec(assignment);
          if (!parts) throw new Error(`Fake D1 cannot read assignment: ${assignment}`);
          const column = parts[1]!;
          const expression = parts[2]!.trim();
          if (expression === "CURRENT_TIMESTAMP") existing[column] = new Date().toISOString().replace("T", " ").slice(0, 19);
          else if (expression.startsWith("excluded.")) existing[column] = row[expression.slice("excluded.".length)] ?? null;
          else if (expression === "?") existing[column] = setValues[setIndex++] ?? null;
          else existing[column] = expression.replace(/^'|'$/g, "");
        }
        return { changes: 1 };
      }
    }
    this.table(table).push(row);
    return { changes: 1 };
  }

  private updateRows(sql: string, values: unknown[]): { changes: number } {
    const tableMatch = /UPDATE ([a-z_]+)/i.exec(sql);
    if (!tableMatch) throw new Error(`Fake D1 cannot update: ${sql}`);
    const table = tableMatch[1]!;
    const setMatch = /SET (.+?) WHERE/i.exec(sql);
    if (!setMatch) throw new Error(`Fake D1 cannot read SET clause from: ${sql}`);
    const assignments = setMatch[1]!.split(",").map((part) => part.trim());
    const whereMatch = /WHERE (.+)$/i.exec(sql);
    const setPlaceholderCount = assignments.filter((part) => part.includes("?")).length;
    const setValues = values.slice(0, setPlaceholderCount);
    const whereValues = values.slice(setPlaceholderCount);
    const rows = this.table(table);
    const updated: Row[] = [];
    for (const row of rows) {
      const matches = !whereMatch || matchesConditions(row, whereMatch[1]!.split(" AND "), whereValues);
      if (!matches) continue;
      let setIndex = 0;
      for (const assignment of assignments) {
        const parts = /^([a-z0-9_]+)\s*=\s*(.+)$/i.exec(assignment);
        if (!parts) throw new Error(`Fake D1 cannot read assignment: ${assignment}`);
        const column = parts[1]!;
        const expression = parts[2]!.trim();
        if (expression === "CURRENT_TIMESTAMP") row[column] = new Date().toISOString().replace("T", " ").slice(0, 19);
        else if (expression === "?") row[column] = setValues[setIndex++] ?? null;
        else row[column] = expression.replace(/^'|'$/g, "");
      }
      updated.push(row);
    }
    return { changes: updated.length };
  }

  private deleteRows(sql: string, values: unknown[]): { changes: number } {
    const tableMatch = /DELETE FROM ([a-z_]+)/i.exec(sql);
    if (!tableMatch) throw new Error(`Fake D1 cannot delete from: ${sql}`);
    const table = tableMatch[1]!;
    const whereMatch = /WHERE (.+)$/i.exec(sql);
    if (table === "rate_limit_buckets") {
      let removed = 0;
      for (const [key, row] of [...this.rateLimitBuckets.entries()]) {
        const matches = !whereMatch || matchesConditions(row, whereMatch[1]!.split(" AND "), values);
        if (matches) { this.rateLimitBuckets.delete(key); removed++; }
      }
      return { changes: removed };
    }
    const rows = this.table(table);
    const keep: Row[] = [];
    let removed = 0;
    for (const row of rows) {
      const matches = !whereMatch || matchesConditions(row, whereMatch[1]!.split(" AND "), values);
      if (matches) removed++;
      else keep.push(row);
    }
    rows.length = 0;
    rows.push(...keep);
    return { changes: removed };
  }

  // -------------------------------------------------------------- execution

  runFirst(sql: string, values: unknown[]): Row | null {
    if (/^SELECT COUNT\(\*\)/i.test(sql)) {
      const rows = this.selectRows(sql, values);
      return { total: rows.length };
    }
    if (/RETURNING window_start, request_count/i.test(sql)) {
      // The atomic upsert must run before the returned bucket is read.
      this.runStatement(sql, values);
      const key = String(values[0]);
      const row = this.rateLimitBuckets.get(key);
      return row ? { window_start: row.window_start, request_count: row.request_count } : null;
    }
    const rows = this.selectRows(sql, values);
    return rows[0] ?? null;
  }

  runAll(sql: string, values: unknown[]): { results: Row[] } {
    if (/^SELECT COUNT\(\*\)/i.test(sql)) return { results: [{ total: this.selectRows(sql, values).length }] };
    return { results: this.selectRows(sql, values) };
  }

  runStatement(sql: string, values: unknown[]): { success: true; meta: { changes: number } } {
    const changes = /^\s*INSERT/i.test(sql) ? this.insertInto(sql, values).changes
      : /^\s*UPDATE/i.test(sql) ? this.updateRows(sql, values).changes
      : /^\s*DELETE/i.test(sql) ? this.deleteRows(sql, values).changes
      : (() => { throw new Error(`Fake D1 cannot execute: ${sql}`); })();
    // D1 reports the affected row count under `meta`.
    return { success: true, meta: { changes } };
  }
}

export function fakeEnv(db: FakeDatabase, overrides: Record<string, unknown> = {}) {
  return { DB: db as unknown as D1Database, RATE_LIMIT_PER_MINUTE: "1000", ALLOWED_ORIGINS: "http://localhost:5173", ...overrides };
}
