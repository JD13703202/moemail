import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { getRuntimeEnv } from "./runtime-env"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

async function hashPasswordWithSalt(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + salt)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
}

export async function hashPassword(password: string): Promise<string> {
  return hashPasswordWithSalt(password, getRuntimeEnv("AUTH_SECRET") || "")
}

export async function comparePassword(password: string, hashedPassword: string): Promise<boolean> {
  const currentSalt = getRuntimeEnv("AUTH_SECRET") || ""
  const currentHash = await hashPasswordWithSalt(password, currentSalt)
  if (currentHash === hashedPassword) {
    return true
  }

  // Backward compatibility for accounts created on Pages when AUTH_SECRET
  // was only available as a runtime binding and passwords were hashed unsalted.
  if (!currentSalt) {
    return false
  }

  const legacyHash = await hashPasswordWithSalt(password, "")
  return legacyHash === hashedPassword
}
