import { LoginForm } from "@/components/auth/login-form"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import type { Locale } from "@/i18n/config"
import { getTurnstileConfig } from "@/lib/turnstile"
import { ALLOW_PUBLIC_REGISTRATION } from "@/config/auth"
import { getRuntimeEnv } from "@/lib/runtime-env"

export const runtime = "edge"

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ debug?: string }>
}) {
  const { locale: localeFromParams } = await params
  const { debug } = await searchParams
  const locale = localeFromParams as Locale
  const session = await auth()
  const authDebug = debug === "1"
  
  if (session?.user) {
    redirect(`/${locale}`)
  }

  const turnstile = await getTurnstileConfig()
  const oauthProviders = {
    github: Boolean(getRuntimeEnv("AUTH_GITHUB_ID") && getRuntimeEnv("AUTH_GITHUB_SECRET")),
    google: Boolean(getRuntimeEnv("AUTH_GOOGLE_ID") && getRuntimeEnv("AUTH_GOOGLE_SECRET")),
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <LoginForm
        turnstile={{ enabled: turnstile.enabled, siteKey: turnstile.siteKey }}
        oauthProviders={oauthProviders}
        allowRegistration={ALLOW_PUBLIC_REGISTRATION}
        authDebug={authDebug}
      />
    </div>
  )
}
