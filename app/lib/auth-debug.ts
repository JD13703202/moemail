import { ALLOW_PUBLIC_REGISTRATION } from "@/config/auth"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { getRuntimeEnv } from "./runtime-env"
import { getTurnstileConfig } from "./turnstile"

const AUTH_DEBUG_LOGS_KEY = "DEBUG_AUTH_LOGS"
const MAX_AUTH_DEBUG_LOGS = 20

type AuthDebugLevel = "debug" | "warn" | "error"

export interface AuthDebugEntry {
  at: string
  event: string
  level: AuthDebugLevel
  details?: unknown
}

export interface AuthDebugSnapshot {
  logs: AuthDebugEntry[]
  statuses: {
    authSecretConfigured: boolean
    githubConfigured: boolean
    googleConfigured: boolean
    turnstileEnabled: boolean
    turnstileSiteKeyConfigured: boolean
    allowRegistration: boolean
  }
}

function maskText(value: string): string {
  if (value.length <= 2) {
    return "*".repeat(value.length)
  }

  if (value.length <= 6) {
    return `${value[0]}***`
  }

  return `${value.slice(0, 2)}***${value.slice(-2)}`
}

function sanitizeDebugValue(value: unknown, key = ""): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (typeof value === "string") {
    if (/secret|token|password|cookie|authorization|clientsecret/i.test(key)) {
      return "[redacted]"
    }

    if (/username|email/i.test(key)) {
      return maskText(value)
    }

    return value.length > 280 ? `${value.slice(0, 280)}...` : value
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      cause: sanitizeDebugValue((value as Error & { cause?: unknown }).cause, "cause"),
    }
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => sanitizeDebugValue(item, key))
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 20)
    return Object.fromEntries(
      entries.map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeDebugValue(entryValue, entryKey),
      ])
    )
  }

  return String(value)
}

function parseStoredLogs(value: string | null): AuthDebugEntry[] {
  if (!value) {
    return []
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((entry): entry is AuthDebugEntry => {
      return typeof entry === "object" && entry !== null
        && typeof (entry as AuthDebugEntry).at === "string"
        && typeof (entry as AuthDebugEntry).event === "string"
        && typeof (entry as AuthDebugEntry).level === "string"
    })
  } catch {
    return []
  }
}

export async function recordAuthDebugLog(
  level: AuthDebugLevel,
  event: string,
  details?: unknown
): Promise<void> {
  const entry: AuthDebugEntry = {
    at: new Date().toISOString(),
    event,
    level,
    details: sanitizeDebugValue(details),
  }

  try {
    const env = getRequestContext().env
    const rawLogs = await env.SITE_CONFIG.get(AUTH_DEBUG_LOGS_KEY)
    const logs = parseStoredLogs(rawLogs)
    logs.unshift(entry)
    await env.SITE_CONFIG.put(AUTH_DEBUG_LOGS_KEY, JSON.stringify(logs.slice(0, MAX_AUTH_DEBUG_LOGS)))
  } catch (error) {
    console.error("Failed to persist auth debug log:", error)
  }

  if (level === "error") {
    console.error("[auth-debug]", entry.event, entry.details)
    return
  }

  if (level === "warn") {
    console.warn("[auth-debug]", entry.event, entry.details)
    return
  }

  console.log("[auth-debug]", entry.event, entry.details)
}

export async function getAuthDebugSnapshot(): Promise<AuthDebugSnapshot> {
  const env = getRequestContext().env
  const [rawLogs, turnstileConfig] = await Promise.all([
    env.SITE_CONFIG.get(AUTH_DEBUG_LOGS_KEY),
    getTurnstileConfig(),
  ])

  return {
    logs: parseStoredLogs(rawLogs),
    statuses: {
      authSecretConfigured: Boolean(getRuntimeEnv("AUTH_SECRET")),
      githubConfigured: Boolean(getRuntimeEnv("AUTH_GITHUB_ID") && getRuntimeEnv("AUTH_GITHUB_SECRET")),
      googleConfigured: Boolean(getRuntimeEnv("AUTH_GOOGLE_ID") && getRuntimeEnv("AUTH_GOOGLE_SECRET")),
      turnstileEnabled: turnstileConfig.enabled,
      turnstileSiteKeyConfigured: Boolean(turnstileConfig.siteKey),
      allowRegistration: ALLOW_PUBLIC_REGISTRATION,
    },
  }
}
