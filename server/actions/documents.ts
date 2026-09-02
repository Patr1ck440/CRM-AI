"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { getTenantContext } from "@/lib/guards"
import { type ActionResult, ok, fail } from "@/lib/action-result"
import { documentSchema } from "@/lib/validation/document-schema"
import { fileTypeFromBuffer } from "file-type"
import { randomUUID } from "crypto"
import { ingestDocument } from "@/server/services/ingest"

export type DocumentListItem = {
  id: string
  file_name: string
  mime_type: string
  file_size: number
  created_at: string
  client_id: string | null
  deal_id: string | null
  ingest_status: "pending" | "processing" | "done" | "failed"
}

export async function listDocumentsAction(): Promise<ActionResult<DocumentListItem[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("documents")
    .select("id, file_name, mime_type, file_size, created_at, client_id, deal_id, ingest_status")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })

  if (error) return fail(error.message)
  return ok(data)
}

export async function createDocumentAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = documentSchema.safeParse(input)
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Date invalide")

  const ctx = await getTenantContext()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("documents")
    .insert({
      tenant_id: ctx.tenantId,
      uploaded_by: ctx.userId,
      file_name: parsed.data.file_name,
      mime_type: parsed.data.mime_type,
      file_size: parsed.data.file_size,
      storage_path: parsed.data.storage_path,
      client_id: parsed.data.client_id ?? null,
      deal_id: parsed.data.deal_id ?? null,
    })
    .select("id")
    .single()

  if (error) return fail(error.message)
  revalidatePath("/dashboard/documents")
  return ok({ id: data.id })
}

export async function deleteDocumentAction(id: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("documents")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)

  if (error) return fail(error.message)
  revalidatePath("/dashboard/documents")
  return ok(undefined)
}

// Aliniat cu §6 din plan: ingest suportă doar PDF (unpdf) și DOCX (mammoth), fără OCR.
// Orice alt tip e refuzat la upload — nu are sens să accepți fișiere pe care AI-ul nu le poate citi.
const ALLOWED_MIME_TO_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
}

export async function uploadDocumentAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const file = formData.get("file") as File | null
  const clientId = formData.get("client_id") as string | null
  const dealId = formData.get("deal_id") as string | null

  if (!file || file.size === 0) return fail("Niciun fișier selectat")

  // Limită 25MiB conform planului (§14)
  const MAX_SIZE = 25 * 1024 * 1024
  if (file.size > MAX_SIZE) return fail("Fișierul depășește limita de 25MB")

  const contextId = clientId || dealId
  if (!contextId) return fail("Trebuie selectat un client sau un deal")

  const ctx = await getTenantContext()
  const supabase = await createClient()

  // Citim conținutul O SINGURĂ DATĂ — îl folosim atât pentru verificarea
  // magic-bytes, cât și pentru upload (Buffer e acceptat direct de Supabase Storage)
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Validare prin magic-bytes — NU ne bazăm pe file.type (vine din browser, e falsificabil)
  const detected = await fileTypeFromBuffer(buffer)
  if (!detected || !(detected.mime in ALLOWED_MIME_TO_EXT)) {
    return fail("Tip de fișier nepermis. Sunt acceptate doar PDF și DOCX.")
  }

  // document_id generat AICI, înainte de insert — devine atât id-ul rândului,
  // cât și numele fizic al fișierului în storage (anti path-traversal/coliziune, conform planului §7)
  const documentId = randomUUID()
  const ext = ALLOWED_MIME_TO_EXT[detected.mime]
  const storagePath = `${ctx.tenantId}/${contextId}/${documentId}.${ext}`

  // 1. Upload în storage, la path-ul determinat de noi (nu de input-ul userului)
  const { error: uploadError } = await supabase.storage
    .from("crm-documents")
    .upload(storagePath, buffer, {
      contentType: detected.mime,
      upsert: false,
    })

  if (uploadError) return fail(`Eroare upload: ${uploadError.message}`)

  // 2. Validăm + inserăm rândul, cu id-ul deja generat
  const parsed = documentSchema.safeParse({
    file_name: file.name, // numele original, păstrat doar ca metadată, nu folosit în path
    mime_type: detected.mime,
    file_size: file.size,
    storage_path: storagePath,
    client_id: clientId || undefined,
    deal_id: dealId || undefined,
  })

  if (!parsed.success) {
    await supabase.storage.from("crm-documents").remove([storagePath])
    return fail(parsed.error.issues[0]?.message ?? "Date invalide")
  }

  const { data, error } = await supabase
    .from("documents")
    .insert({
      id: documentId, // suprascrie default-ul gen_random_uuid() — același UUID ca în storage path
      tenant_id: ctx.tenantId,
      uploaded_by: ctx.userId,
      file_name: parsed.data.file_name,
      mime_type: parsed.data.mime_type,
      file_size: parsed.data.file_size,
      storage_path: parsed.data.storage_path,
      client_id: parsed.data.client_id ?? null,
      deal_id: parsed.data.deal_id ?? null,
    })
    .select("id")
    .single()

  if (error) {
    await supabase.storage.from("crm-documents").remove([storagePath])
    return fail(error.message)
  }

  // Trigger ingest — apel direct, sincron, MVP simplu (nu webhook)
  const ingestResult = await ingestDocument(data.id)
  if (!ingestResult.ok) {
    console.error(`Ingest eșuat pentru ${data.id}: ${ingestResult.error}`)
  }

  revalidatePath("/dashboard/documents")
  return ok({ id: data.id })
}

export async function getDocumentUrlAction(
  documentId: string,
  mode: "preview" | "download"
): Promise<ActionResult<{ url: string; fileName: string }>> {
  const ctx = await getTenantContext()
  const supabase = await createClient()

  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("id, storage_path, file_name, tenant_id, deleted_at")
    .eq("id", documentId)
    .is("deleted_at", null)
    .single()

  if (docError || !doc) {
    return fail("Documentul nu a fost găsit")
  }

  if (doc.tenant_id !== ctx.tenantId) {
    return fail("Nu ai acces la acest document")
  }

  const { data: signed, error: signedError } = await supabase.storage
    .from("crm-documents")
    .createSignedUrl(
      doc.storage_path,
      60,
      mode === "download" ? { download: doc.file_name } : undefined
    )

  if (signedError || !signed) {
    return fail("Nu s-a putut genera link-ul")
  }

  return ok({ url: signed.signedUrl, fileName: doc.file_name })
}
