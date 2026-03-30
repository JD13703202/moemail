import { getAuthDebugSnapshot } from "@/lib/auth-debug"

export const runtime = "edge"

export async function GET() {
  const snapshot = await getAuthDebugSnapshot()

  return Response.json(snapshot, {
    headers: {
      "Cache-Control": "no-store, max-age=0",
    },
  })
}
