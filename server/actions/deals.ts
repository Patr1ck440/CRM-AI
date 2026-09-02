"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { getTenantContext } from "@/lib/guards"
import { type ActionResult, ok, fail } from "@/lib/action-result"
import { dealSchema, changeStageSchema } from "@/lib/validation/schemas"

export async function createDealAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = dealSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Date invalide")

  const ctx = await getTenantContext()
  const supabase = await createClient()

  // Inherit the client's team so manager scoping stays consistent.
  const { data: client } = await supabase
    .from("clients")
    .select("team_id")
    .eq("id", parsed.data.client_id)
    .maybeSingle()

  const { data, error } = await supabase
    .from("deals")
    .insert({
      owner_id: ctx.userId,
      client_id: parsed.data.client_id,
      title: parsed.data.title,
      value_ron: parsed.data.value_ron,
      stage: parsed.data.stage ?? "lead",
      expected_close_date: parsed.data.expected_close_date || null,
      team_id: parsed.data.team_id || client?.team_id || null,
    })
    .select("id")
    .single()

  if (error) return fail(error.message)
  revalidatePath("/dashboard/deals")
  revalidatePath("/dashboard")
  return ok({ id: data.id })
}

export async function updateDealAction(id: string, input: unknown): Promise<ActionResult> {
  const parsed = dealSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Date invalide")

  const supabase = await createClient()

  const payload: Record<string, unknown> = {
    title: parsed.data.title,
    client_id: parsed.data.client_id,
    value_ron: parsed.data.value_ron,
    expected_close_date: parsed.data.expected_close_date || null,
  }
  // Vezi updateClientAction: formularul nu trimite team_id, deci nu-l resetam.
  if (parsed.data.team_id !== undefined) {
    payload.team_id = parsed.data.team_id || null
  }

  const { error } = await supabase.from("deals").update(payload).eq("id", id)

  if (error) return fail(error.message)
  revalidatePath("/dashboard/deals")
  revalidatePath(`/dashboard/deals/${id}`)
  return ok(undefined)
}

/** Stage change is validated again server-side by the DB trigger. */
export async function changeStageAction(input: unknown): Promise<ActionResult> {
  const parsed = changeStageSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Date invalide")

  const supabase = await createClient()
  const { error } = await supabase
    .from("deals")
    .update({
      stage: parsed.data.to_stage,
      lost_reason: parsed.data.to_stage === "lost" ? parsed.data.lost_reason : null,
    })
    .eq("id", parsed.data.deal_id)

  if (error) return fail(error.message)
  revalidatePath("/dashboard/deals")
  revalidatePath(`/dashboard/deals/${parsed.data.deal_id}`)
  revalidatePath("/dashboard")
  return ok(undefined)
}

export async function deleteDealAction(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from("deals").delete().eq("id", id)
  if (error) return fail(error.message)
  revalidatePath("/dashboard/deals")
  return ok(undefined)
}
