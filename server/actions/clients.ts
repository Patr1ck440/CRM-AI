"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { getTenantContext } from "@/lib/guards"
import { type ActionResult, ok, fail } from "@/lib/action-result"
import { clientSchema, contactSchema } from "@/lib/validation/schemas"

export async function createClientAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = clientSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Date invalide")

  const ctx = await getTenantContext()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("clients")
    .insert({
      owner_id: ctx.userId,
      name: parsed.data.name,
      company: parsed.data.company || null,
      industry: parsed.data.industry || null,
      notes: parsed.data.notes || null,
      team_id: parsed.data.team_id || null,
    })
    .select("id")
    .single()

  if (error) return fail(error.message)
  revalidatePath("/dashboard/clients")
  return ok({ id: data.id })
}

export async function updateClientAction(id: string, input: unknown): Promise<ActionResult> {
  const parsed = clientSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Date invalide")

  const supabase = await createClient()

  const payload: Record<string, unknown> = {
    name: parsed.data.name,
    company: parsed.data.company || null,
    industry: parsed.data.industry || null,
    notes: parsed.data.notes || null,
  }
  // team_id nu apare in formularul de editare. Daca nu a fost trimis, il lasam
  // neatins — altfel am scoate clientul din echipa la fiecare salvare.
  if (parsed.data.team_id !== undefined) {
    payload.team_id = parsed.data.team_id || null
  }

  const { error } = await supabase.from("clients").update(payload).eq("id", id)

  if (error) return fail(error.message)
  revalidatePath("/dashboard/clients")
  revalidatePath(`/dashboard/clients/${id}`)
  return ok(undefined)
}

export async function deleteClientAction(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from("clients").delete().eq("id", id)
  if (error) return fail(error.message)
  revalidatePath("/dashboard/clients")
  return ok(undefined)
}

export async function upsertContactAction(input: unknown, id?: string): Promise<ActionResult> {
  const parsed = contactSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Date invalide")

  const supabase = await createClient()
  const payload = {
    client_id: parsed.data.client_id,
    full_name: parsed.data.full_name,
    email: parsed.data.email || null,
    phone: parsed.data.phone || null,
    position: parsed.data.position || null,
    is_primary: parsed.data.is_primary ?? false,
  }

  const { error } = id
    ? await supabase.from("contacts").update(payload).eq("id", id)
    : await supabase.from("contacts").insert(payload)

  if (error) return fail(error.message)
  revalidatePath(`/dashboard/clients/${parsed.data.client_id}`)
  return ok(undefined)
}

export async function deleteContactAction(id: string, clientId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from("contacts").delete().eq("id", id)
  if (error) return fail(error.message)
  revalidatePath(`/dashboard/clients/${clientId}`)
  return ok(undefined)
}
