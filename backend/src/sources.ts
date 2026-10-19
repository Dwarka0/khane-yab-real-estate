import type { Env } from "./types";

export type SourceKind = "demo" | "manual" | "user_link" | "authorized_adapter";
export type PermissionStatus = "unreviewed" | "approved" | "rejected" | "expired";

export interface SourceRecord {
  id: string;
  name: string;
  kind: SourceKind;
  baseUrl: string | null;
  allowedHost: string | null;
  enabled: boolean;
  permissionStatus: PermissionStatus;
  permissionReviewedAt: string | null;
  permissionNotes: string | null;
}

export const SOURCE_DEMO = "src-demo";
export const SOURCE_MANUAL = "src-manual";
export const SOURCE_USER_LINK = "src-user-link";

/**
 * Loads a source from the registry. The registry is the single place where a
 * data source is declared; ingestion paths must not hard-code a source.
 */
export async function loadSource(env: Env, id: string): Promise<SourceRecord | null> {
  const row = await env.DB.prepare(
    `SELECT id, name, kind, base_url, allowed_host, enabled, permission_status, permission_reviewed_at, permission_notes FROM sources WHERE id = ?`,
  ).bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: String(row.id),
    name: String(row.name),
    kind: String(row.kind) as SourceKind,
    baseUrl: row.base_url == null ? null : String(row.base_url),
    allowedHost: row.allowed_host == null ? null : String(row.allowed_host),
    enabled: Number(row.enabled) === 1,
    permissionStatus: String(row.permission_status) as PermissionStatus,
    permissionReviewedAt: row.permission_reviewed_at == null ? null : String(row.permission_reviewed_at),
    permissionNotes: row.permission_notes == null ? null : String(row.permission_notes),
  };
}

export type PermissionResult =
  | { allowed: true; source: SourceRecord }
  | { allowed: false; code: string; message: string };

/**
 * Fails closed. A source is usable only when it exists, is enabled, and its
 * permission record is approved. Missing or expired permission never degrades
 * into an open path.
 */
export async function checkSourcePermission(env: Env, id: string): Promise<PermissionResult> {
  const source = await loadSource(env, id);
  if (!source) return { allowed: false, code: "SOURCE_NOT_FOUND", message: "منبع داده ثبت نشده است" };
  if (!source.enabled) return { allowed: false, code: "SOURCE_DISABLED", message: "این منبع داده غیرفعال است" };
  if (source.permissionStatus !== "approved") {
    return { allowed: false, code: "PERMISSION_NOT_APPROVED", message: "مجوز دسترسی این منبع داده تأیید نشده است" };
  }
  return { allowed: true, source };
}

/** Host suffixes a source is allowed to contact. */
export function hostAllowlist(source: SourceRecord): string[] {
  return (source.allowedHost ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

/** True when the URL host is the allowed host itself or one of its subdomains. */
export function isHostAllowed(host: string, allowlist: string[]): boolean {
  const normalized = host.toLowerCase();
  return allowlist.some((allowed) => normalized === allowed || normalized.endsWith(`.${allowed}`));
}
