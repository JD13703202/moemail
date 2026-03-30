"use client"

import { useCallback, useEffect, useState } from "react"
import { signIn } from "next-auth/react"
import { useTranslations } from "next-intl"
import { useToast } from "@/components/ui/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Github, Loader2, KeyRound, User2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Turnstile } from "@/components/auth/turnstile"

interface TurnstileConfigProps {
  enabled: boolean
  siteKey: string
}

interface LoginFormProps {
  turnstile?: TurnstileConfigProps
  oauthProviders?: {
    github: boolean
    google: boolean
  }
  allowRegistration?: boolean
  authDebug?: boolean
}

interface FormErrors {
  username?: string
  password?: string
  confirmPassword?: string
}

interface DebugLogEntry {
  at: string
  event: string
  level: "debug" | "warn" | "error"
  details?: unknown
}

interface DebugSnapshot {
  logs: DebugLogEntry[]
  statuses: {
    authSecretConfigured: boolean
    githubConfigured: boolean
    googleConfigured: boolean
    turnstileEnabled: boolean
    turnstileSiteKeyConfigured: boolean
    allowRegistration: boolean
  }
}

const DEBUG_STATUS_LABELS: Record<keyof DebugSnapshot["statuses"], string> = {
  authSecretConfigured: "AUTH_SECRET",
  githubConfigured: "GitHub OAuth",
  googleConfigured: "Google OAuth",
  turnstileEnabled: "Turnstile enabled",
  turnstileSiteKeyConfigured: "Turnstile site key",
  allowRegistration: "Public registration",
}

export function LoginForm({
  turnstile,
  oauthProviders,
  allowRegistration = true,
  authDebug = false,
}: LoginFormProps) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const [turnstileToken, setTurnstileToken] = useState("")
  const [turnstileResetCounter, setTurnstileResetCounter] = useState(0)
  const [activeTab, setActiveTab] = useState<"login" | "register">("login")
  const [debugSnapshot, setDebugSnapshot] = useState<DebugSnapshot | null>(null)
  const [debugLoading, setDebugLoading] = useState(false)
  const { toast } = useToast()
  const t = useTranslations("auth.loginForm")

  const turnstileSiteKey = turnstile?.siteKey ?? ""
  const turnstileEnabled = Boolean(turnstile?.enabled && turnstileSiteKey)
  const hasGithubProvider = Boolean(oauthProviders?.github)
  const hasGoogleProvider = Boolean(oauthProviders?.google)
  const hasOAuthProviders = hasGithubProvider || hasGoogleProvider
  const registrationEnabled = Boolean(allowRegistration)

  const loadDebugSnapshot = useCallback(async () => {
    if (!authDebug) {
      return
    }

    setDebugLoading(true)
    try {
      const response = await fetch("/api/auth/debug", {
        cache: "no-store",
      })
      const data = await response.json() as DebugSnapshot
      setDebugSnapshot(data)
    } catch (error) {
      setDebugSnapshot({
        logs: [{
          at: new Date().toISOString(),
          event: "debug-panel-fetch-failed",
          level: "error",
          details: error instanceof Error ? error.message : "Unknown error",
        }],
        statuses: {
          authSecretConfigured: false,
          githubConfigured: false,
          googleConfigured: false,
          turnstileEnabled,
          turnstileSiteKeyConfigured: Boolean(turnstileSiteKey),
          allowRegistration: registrationEnabled,
        },
      })
    } finally {
      setDebugLoading(false)
    }
  }, [authDebug, registrationEnabled, turnstileEnabled, turnstileSiteKey])

  useEffect(() => {
    void loadDebugSnapshot()
  }, [loadDebugSnapshot])

  const resetTurnstile = useCallback(() => {
    setTurnstileToken("")
    setTurnstileResetCounter((prev) => prev + 1)
  }, [])

  const ensureTurnstileSolved = () => {
    if (!turnstileEnabled) return true
    if (turnstileToken) return true

    toast({
      title: t("toast.turnstileRequired"),
      description: t("toast.turnstileRequiredDesc"),
      variant: "destructive",
    })
    return false
  }

  const clearForm = () => {
    setUsername("")
    setPassword("")
    setConfirmPassword("")
    setErrors({})
  }

  const handleTabChange = (value: string) => {
    if (!registrationEnabled && value === "register") {
      return
    }
    setActiveTab(value as "login" | "register")
    clearForm()
  }

  const validateLoginForm = () => {
    const newErrors: FormErrors = {}
    if (!username) newErrors.username = t("errors.usernameRequired")
    if (!password) newErrors.password = t("errors.passwordRequired")
    if (username.includes('@')) newErrors.username = t("errors.usernameInvalid")
    if (password && password.length < 8) newErrors.password = t("errors.passwordTooShort")
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const validateRegisterForm = () => {
    const newErrors: FormErrors = {}
    if (!username) newErrors.username = t("errors.usernameRequired")
    if (!password) newErrors.password = t("errors.passwordRequired")
    if (username.includes('@')) newErrors.username = t("errors.usernameInvalid")
    if (password && password.length < 8) newErrors.password = t("errors.passwordTooShort")
    if (!confirmPassword) newErrors.confirmPassword = t("errors.confirmPasswordRequired")
    if (password !== confirmPassword) newErrors.confirmPassword = t("errors.passwordMismatch")
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleLogin = async () => {
    if (!validateLoginForm()) return
    if (!ensureTurnstileSolved()) return

    setLoading(true)
    try {
      const result = await signIn("credentials", {
        username,
        password,
        turnstileToken,
        redirect: false,
      })

      if (result?.error) {
        void loadDebugSnapshot()
        toast({
          title: t("toast.loginFailed"),
          description: result.error,
          variant: "destructive",
        })
        setLoading(false)
        resetTurnstile()
        return
      }

      window.location.href = "/"
    } catch (error) {
      void loadDebugSnapshot()
      toast({
        title: t("toast.loginFailed"),
        description: error instanceof Error ? error.message : t("toast.registerFailedDesc"),
        variant: "destructive",
      })
      setLoading(false)
      resetTurnstile()
    }
  }

  const handleRegister = async () => {
    if (!validateRegisterForm()) return
    if (!ensureTurnstileSolved()) return

    setLoading(true)
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, turnstileToken }),
      })

      const data = await response.json() as { error?: string }

      if (!response.ok) {
        void loadDebugSnapshot()
        toast({
          title: t("toast.registerFailed"),
          description: data.error || t("toast.registerFailedDesc"),
          variant: "destructive",
        })
        setLoading(false)
        resetTurnstile()
        return
      }

      // 注册成功后自动登录
      const result = await signIn("credentials", {
        username,
        password,
        turnstileToken,
        redirect: false,
      })

      if (result?.error) {
        void loadDebugSnapshot()
        toast({
          title: t("toast.loginFailed"),
          description: result.error || t("toast.autoLoginFailed"),
          variant: "destructive",
        })
        setLoading(false)
        resetTurnstile()
        return
      }

      window.location.href = "/"
    } catch (error) {
      void loadDebugSnapshot()
      toast({
        title: t("toast.registerFailed"),
        description: error instanceof Error ? error.message : t("toast.registerFailedDesc"),
        variant: "destructive",
      })
      setLoading(false)
      resetTurnstile()
    }
  }

  const handleGithubLogin = () => {
    signIn("github", { callbackUrl: "/" })
  }

  const handleGoogleLogin = () => {
    signIn("google", { callbackUrl: "/" })
  }

  return (
    <Card className="w-[95%] max-w-lg border-2 border-primary/20">
      <CardHeader className="space-y-2">
        <CardTitle className="text-2xl text-center bg-gradient-to-r from-primary to-purple-600 bg-clip-text text-transparent">
          {t("title")}
        </CardTitle>
        <CardDescription className="text-center">
          {t("subtitle")}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-6">
        <Tabs value={activeTab} className="w-full" onValueChange={handleTabChange}>
          <TabsList className={cn("grid w-full mb-6", registrationEnabled ? "grid-cols-2" : "grid-cols-1")}>
            <TabsTrigger value="login">{t("tabs.login")}</TabsTrigger>
            {registrationEnabled && (
              <TabsTrigger value="register">{t("tabs.register")}</TabsTrigger>
            )}
          </TabsList>
          <div className="min-h-[220px]">
            <TabsContent value="login" className="space-y-4 mt-0">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="relative">
                    <div className="absolute left-2.5 top-2 text-muted-foreground">
                      <User2 className="h-5 w-5" />
                    </div>
                    <Input
                      className={cn(
                        "h-9 pl-9 pr-3",
                        errors.username && "border-destructive focus-visible:ring-destructive"
                      )}
                      placeholder={t("fields.username")}
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value)
                        setErrors({})
                      }}
                      disabled={loading}
                    />
                  </div>
                  {errors.username && (
                    <p className="text-xs text-destructive">{errors.username}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <div className="relative">
                    <div className="absolute left-2.5 top-2 text-muted-foreground">
                      <KeyRound className="h-5 w-5" />
                    </div>
                    <Input
                      className={cn(
                        "h-9 pl-9 pr-3",
                        errors.password && "border-destructive focus-visible:ring-destructive"
                      )}
                      type="password"
                      placeholder={t("fields.password")}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value)
                        setErrors({})
                      }}
                      disabled={loading}
                    />
                  </div>
                  {errors.password && (
                    <p className="text-xs text-destructive">{errors.password}</p>
                  )}
                </div>
              </div>

              <div className="space-y-3 pt-1">
                <Button
                  className="w-full"
                  onClick={handleLogin}
                  disabled={loading}
                >
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t("actions.login")}
                </Button>

                {hasOAuthProviders && (
                  <>
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-background px-2 text-muted-foreground">
                          {t("actions.or")}
                        </span>
                      </div>
                    </div>

                    {hasGithubProvider && (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={handleGithubLogin}
                      >
                        <Github className="mr-2 h-4 w-4" />
                        {t("actions.githubLogin")}
                      </Button>
                    )}

                    {hasGoogleProvider && (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={handleGoogleLogin}
                      >
                        <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                          <path
                            fill="currentColor"
                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                          />
                          <path
                            fill="currentColor"
                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          />
                          <path
                            fill="currentColor"
                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                          />
                          <path
                            fill="currentColor"
                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                          />
                        </svg>
                        {t("actions.googleLogin")}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </TabsContent>
            {registrationEnabled && (
            <TabsContent value="register" className="space-y-4 mt-0">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <div className="relative">
                    <div className="absolute left-2.5 top-2 text-muted-foreground">
                      <User2 className="h-5 w-5" />
                    </div>
                    <Input
                      className={cn(
                        "h-9 pl-9 pr-3",
                        errors.username && "border-destructive focus-visible:ring-destructive"
                      )}
                      placeholder={t("fields.username")}
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value)
                        setErrors({})
                      }}
                      disabled={loading}
                    />
                  </div>
                  {errors.username && (
                    <p className="text-xs text-destructive">{errors.username}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <div className="relative">
                    <div className="absolute left-2.5 top-2 text-muted-foreground">
                      <KeyRound className="h-5 w-5" />
                    </div>
                    <Input
                      className={cn(
                        "h-9 pl-9 pr-3",
                        errors.password && "border-destructive focus-visible:ring-destructive"
                      )}
                      type="password"
                      placeholder={t("fields.password")}
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value)
                        setErrors({})
                      }}
                      disabled={loading}
                    />
                  </div>
                  {errors.password && (
                    <p className="text-xs text-destructive">{errors.password}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <div className="relative">
                    <div className="absolute left-2.5 top-2 text-muted-foreground">
                      <KeyRound className="h-5 w-5" />
                    </div>
                    <Input
                      className={cn(
                        "h-9 pl-9 pr-3",
                        errors.confirmPassword && "border-destructive focus-visible:ring-destructive"
                      )}
                      type="password"
                      placeholder={t("fields.confirmPassword")}
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value)
                        setErrors({})
                      }}
                      disabled={loading}
                    />
                  </div>
                  {errors.confirmPassword && (
                    <p className="text-xs text-destructive">{errors.confirmPassword}</p>
                  )}
                </div>
              </div>

              <div className="space-y-3 pt-1">
                <Button
                  className="w-full"
                  onClick={handleRegister}
                  disabled={loading}
                >
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t("actions.register")}
                </Button>
              </div>
            </TabsContent>
            )}
          </div>
        </Tabs>
        {turnstileEnabled && turnstileSiteKey && (
          <div className={cn("space-y-2", activeTab === "login" ? "mt-4" : "")}>
            <Turnstile
              siteKey={turnstileSiteKey}
              onVerify={setTurnstileToken}
              onExpire={resetTurnstile}
              resetSignal={turnstileResetCounter}
            />
          </div>
        )}
        {authDebug && (
          <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-50/80 p-3 text-xs text-amber-950 dark:border-amber-400/40 dark:bg-amber-950/30 dark:text-amber-100">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="font-semibold">Auth Debug Panel</div>
                <div className="text-[11px] opacity-80">Open only when troubleshooting. Refresh after a failed login to inspect the latest server logs.</div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadDebugSnapshot()}
                disabled={debugLoading}
              >
                {debugLoading ? "Loading..." : "Refresh"}
              </Button>
            </div>

            <div className="mb-3 grid grid-cols-2 gap-2">
              {Object.entries(debugSnapshot?.statuses ?? {}).map(([key, value]) => (
                <div key={key} className="rounded border border-amber-600/20 bg-background/70 px-2 py-1">
                  <div className="font-medium">{DEBUG_STATUS_LABELS[key as keyof DebugSnapshot["statuses"]]}</div>
                  <div className={cn("mt-1", value ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                    {value ? "configured" : "missing"}
                  </div>
                </div>
              ))}
            </div>

            <pre className="max-h-72 overflow-auto rounded border border-amber-600/20 bg-background/70 p-2 text-[11px] leading-5">
              {debugSnapshot
                ? JSON.stringify(debugSnapshot.logs, null, 2)
                : "No debug data loaded yet."}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
