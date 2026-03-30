import { getRequestContext } from "@cloudflare/next-on-pages"

function readCloudflareRuntimeEnv(name: string): string | undefined {
  try {
    const env = getRequestContext().env as unknown as Record<string, unknown> | undefined
    const value = env?.[name]
    return typeof value === "string" && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

export function getRuntimeEnv(name: string): string | undefined {
  const cloudflareValue = readCloudflareRuntimeEnv(name)
  if (cloudflareValue) {
    return cloudflareValue
  }

  const processValue = process.env[name]
  if (typeof processValue === "string" && processValue.length > 0) {
    return processValue
  }

  return undefined
}
