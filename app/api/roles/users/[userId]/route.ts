import { auth, checkPermission } from "@/lib/auth"
import { createDb } from "@/lib/db"
import { apiKeys, userRoles, users } from "@/lib/schema"
import { PERMISSIONS, ROLES } from "@/lib/permissions"
import { eq } from "drizzle-orm"

export const runtime = "edge"

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const canManageUsers = await checkPermission(PERMISSIONS.PROMOTE_USER)

    if (!canManageUsers) {
      return Response.json({ error: "权限不足" }, { status: 403 })
    }

    const session = await auth()
    const currentUserId = session?.user?.id

    if (!currentUserId) {
      return Response.json({ error: "未授权" }, { status: 401 })
    }

    const { userId } = await params

    if (!userId) {
      return Response.json({ error: "缺少用户 ID" }, { status: 400 })
    }

    if (userId === currentUserId) {
      return Response.json({ error: "不能删除当前登录账号" }, { status: 400 })
    }

    const db = createDb()

    const targetUser = await db.query.users.findFirst({
      where: eq(users.id, userId),
      with: {
        userRoles: {
          with: {
            role: true,
          },
        },
      },
    })

    if (!targetUser) {
      return Response.json({ error: "用户不存在" }, { status: 404 })
    }

    if (targetUser.userRoles.some((userRole) => userRole.role.name === ROLES.EMPEROR)) {
      return Response.json({ error: "不能删除皇帝账号" }, { status: 400 })
    }

    await db.delete(apiKeys).where(eq(apiKeys.userId, userId))
    await db.delete(userRoles).where(eq(userRoles.userId, userId))
    await db.delete(users).where(eq(users.id, userId))

    return Response.json({
      success: true,
      deletedUser: {
        id: targetUser.id,
        username: targetUser.username,
        email: targetUser.email,
      },
    })
  } catch (error) {
    console.error("Failed to delete user:", error)
    return Response.json({ error: "删除用户失败" }, { status: 500 })
  }
}
