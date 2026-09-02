import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import type { AppRole } from "@/lib/rbac"

export type TenantContext = {
  userId: string
  email: string
  tenantId: string
  role: AppRole
  fullName: string | null
}

/** Returns the authenticated user or redirects to /login. */
export async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")
  return user
}

/**
 * Returns the full tenant context (profile). If the user is authenticated but
 * has no profile yet, redirects to onboarding. Inactive users are signed out.
 */
export async function getTenantContext(): Promise<TenantContext> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, tenant_id, email, full_name, role, is_active")
    .eq("id", user.id)
    .maybeSingle()

  if (error) throw new Error(`Nu am putut citi profilul: ${error.message}`)
  if (!profile) redirect("/onboarding")
  if (!profile.is_active) {
    await supabase.auth.signOut()
    redirect("/login?inactive=1")
  }

  return {
    userId: profile.id,
    email: profile.email,
    tenantId: profile.tenant_id,
    role: profile.role as AppRole,
    fullName: profile.full_name,
  }
}

export async function requireRole(roles: AppRole[]): Promise<TenantContext> {
  const ctx = await getTenantContext()
  if (!roles.includes(ctx.role)) redirect("/dashboard")
  return ctx
}
