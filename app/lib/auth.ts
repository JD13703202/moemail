import NextAuth, { CredentialsSignin, type NextAuthConfig } from "next-auth"
import GitHub from "next-auth/providers/github"
import Google from "next-auth/providers/google"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { createDb, Db } from "./db"
import { accounts, users, roles, userRoles } from "./schema"
import { eq } from "drizzle-orm"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { Permission, hasPermission, ROLES, Role } from "./permissions"
import CredentialsProvider from "next-auth/providers/credentials"
import { authSchema, AuthSchema } from "@/lib/validation"
import { generateAvatarUrl } from "./avatar"
import { getUserId } from "./apiKey"
import { verifyTurnstileToken } from "./turnstile"
import { getRuntimeEnv } from "./runtime-env"
import { hashPassword, comparePassword } from "./password"
import { recordAuthDebugLog } from "./auth-debug"

const ROLE_DESCRIPTIONS: Record<Role, string> = {
  [ROLES.EMPEROR]: "皇帝（网站所有者）",
  [ROLES.DUKE]: "公爵（超级用户）",
  [ROLES.KNIGHT]: "骑士（高级用户）",
  [ROLES.CIVILIAN]: "平民（普通用户）",
}

class CredentialsFlowError extends CredentialsSignin {
  constructor(code: string) {
    super()
    this.code = code
  }
}

const getDefaultRole = async (): Promise<Role> => {
  const defaultRole = await getRequestContext().env.SITE_CONFIG.get("DEFAULT_ROLE")

  if (
    defaultRole === ROLES.DUKE ||
    defaultRole === ROLES.KNIGHT ||
    defaultRole === ROLES.CIVILIAN
  ) {
    return defaultRole as Role
  }

  return ROLES.CIVILIAN
}

async function findOrCreateRole(db: Db, roleName: Role) {
  let role = await db.query.roles.findFirst({
    where: eq(roles.name, roleName),
  })

  if (!role) {
    const [newRole] = await db.insert(roles)
      .values({
        name: roleName,
        description: ROLE_DESCRIPTIONS[roleName],
      })
      .returning()
    role = newRole
  }

  return role
}

export async function assignRoleToUser(db: Db, userId: string, roleId: string) {
  await db.delete(userRoles)
    .where(eq(userRoles.userId, userId))

  await db.insert(userRoles)
    .values({
      userId,
      roleId,
    })
}

export async function getUserRole(userId: string) {
  const db = createDb()
  const userRoleRecords = await db.query.userRoles.findMany({
    where: eq(userRoles.userId, userId),
    with: { role: true },
  })
  return userRoleRecords[0].role.name
}

export async function checkPermission(permission: Permission) {
  const userId = await getUserId()

  if (!userId) return false

  const db = createDb()
  const userRoleRecords = await db.query.userRoles.findMany({
    where: eq(userRoles.userId, userId),
    with: { role: true },
  })

  const userRoleNames = userRoleRecords.map(ur => ur.role.name)
  return hasPermission(userRoleNames as Role[], permission)
}

export const {
  handlers: { GET, POST },
  auth,
  signIn,
  signOut
} = NextAuth(() => {
  const githubClientId = getRuntimeEnv("AUTH_GITHUB_ID")
  const githubClientSecret = getRuntimeEnv("AUTH_GITHUB_SECRET")
  const googleClientId = getRuntimeEnv("AUTH_GOOGLE_ID")
  const googleClientSecret = getRuntimeEnv("AUTH_GOOGLE_SECRET")
  const authSecret = getRuntimeEnv("AUTH_SECRET")

  if (!authSecret) {
    void recordAuthDebugLog("error", "auth-secret-missing", {
      githubConfigured: Boolean(githubClientId && githubClientSecret),
      googleConfigured: Boolean(googleClientId && googleClientSecret),
    })
  }

  const providers: NonNullable<NextAuthConfig["providers"]> = [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "用户名", type: "text", placeholder: "请输入用户名" },
        password: { label: "密码", type: "password", placeholder: "请输入密码" },
      },
      async authorize(credentials) {
        if (!credentials) {
          void recordAuthDebugLog("error", "credentials-missing", {})
          throw new CredentialsFlowError("invalid-input")
        }

        const { username, password, turnstileToken } = credentials as Record<string, string | undefined>
        void recordAuthDebugLog("debug", "credentials-authorize-start", {
          username,
          hasPassword: Boolean(password),
          hasTurnstileToken: Boolean(turnstileToken),
        })

        let parsedCredentials: AuthSchema
        try {
          parsedCredentials = authSchema.parse({ username, password, turnstileToken })
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (error) {
          void recordAuthDebugLog("error", "credentials-parse-failed", {
            username,
            error,
          })
          throw new CredentialsFlowError("invalid-input")
        }

        const verification = await verifyTurnstileToken(parsedCredentials.turnstileToken)
        if (!verification.success) {
          void recordAuthDebugLog("error", "turnstile-verification-failed", {
            username: parsedCredentials.username,
            reason: verification.reason,
          })
          if (verification.reason === "missing-token") {
            throw new CredentialsFlowError("turnstile-required")
          }
          throw new CredentialsFlowError("turnstile-failed")
        }

        const db = createDb()

        const user = await db.query.users.findFirst({
          where: eq(users.username, parsedCredentials.username),
        })

        if (!user) {
          void recordAuthDebugLog("warn", "credentials-user-not-found", {
            username: parsedCredentials.username,
          })
          return null
        }

        const isValid = await comparePassword(parsedCredentials.password, user.password as string)
        if (!isValid) {
          void recordAuthDebugLog("warn", "credentials-password-mismatch", {
            username: parsedCredentials.username,
            userId: user.id,
          })
          return null
        }

        void recordAuthDebugLog("debug", "credentials-authorize-success", {
          username: parsedCredentials.username,
          userId: user.id,
        })

        return {
          ...user,
          password: undefined,
        }
      },
    }),
  ]

  if (githubClientId && githubClientSecret) {
    providers.unshift(
      GitHub({
        clientId: githubClientId,
        clientSecret: githubClientSecret,
        allowDangerousEmailAccountLinking: true,
      })
    )
  }

  if (googleClientId && googleClientSecret) {
    providers.unshift(
      Google({
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        allowDangerousEmailAccountLinking: true,
      })
    )
  }

  return {
    secret: authSecret,
    adapter: DrizzleAdapter(createDb(), {
      usersTable: users,
      accountsTable: accounts,
    }),
    providers,
    events: {
      async signIn({ user }) {
        if (!user.id) return

        try {
          const db = createDb()
          const existingRole = await db.query.userRoles.findFirst({
            where: eq(userRoles.userId, user.id),
          })

          if (existingRole) return

          const defaultRole = await getDefaultRole()
          const role = await findOrCreateRole(db, defaultRole)
          await assignRoleToUser(db, user.id, role.id)
        } catch (error) {
          void recordAuthDebugLog("error", "assign-role-failed", {
            userId: user.id,
            error,
          })
          console.error('Error assigning role:', error)
        }
      }
    },
    logger: {
      error(error) {
        void recordAuthDebugLog("error", "authjs-error", error)
      },
      warn(code) {
        void recordAuthDebugLog("warn", "authjs-warning", { code })
      },
    },
    callbacks: {
      async jwt({ token, user }) {
        if (user) {
          token.id = user.id
          token.name = user.name || user.username
          token.username = user.username
          token.image = user.image || generateAvatarUrl(token.name as string)
        }
        return token
      },
      async session({ session, token }) {
        if (token && session.user) {
          session.user.id = token.id as string
          session.user.name = token.name as string
          session.user.username = token.username as string
          session.user.image = token.image as string

          const db = createDb()
          let userRoleRecords = await db.query.userRoles.findMany({
            where: eq(userRoles.userId, session.user.id),
            with: { role: true },
          })

          if (!userRoleRecords.length) {
            const defaultRole = await getDefaultRole()
            const role = await findOrCreateRole(db, defaultRole)
            await assignRoleToUser(db, session.user.id, role.id)
            userRoleRecords = [{
              userId: session.user.id,
              roleId: role.id,
              createdAt: new Date(),
              role: role
            }]
          }

          session.user.roles = userRoleRecords.map(ur => ({
            name: ur.role.name,
          }))

          const userAccounts = await db.query.accounts.findMany({
            where: eq(accounts.userId, session.user.id),
          })

          session.user.providers = userAccounts.map(account => account.provider)
        }

        return session
      },
    },
    session: {
      strategy: "jwt",
    },
  }
})

export async function register(username: string, password: string) {
  const db = createDb()

  const existing = await db.query.users.findFirst({
    where: eq(users.username, username)
  })

  if (existing) {
    throw new Error("用户名已存在")
  }

  const hashedPassword = await hashPassword(password)

  const [user] = await db.insert(users)
    .values({
      username,
      password: hashedPassword,
    })
    .returning()

  return user
}
