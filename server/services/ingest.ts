"use server"

import { createHash } from "crypto"
import { createAdminClient } from "@/server/supabase/admin"
import { parseDocument } from "@/lib/ai/parse-document"
import { chunkText } from "@/lib/ai/chunking"
import { embedMany } from "ai"
import { openai } from "@ai-sdk/openai"

type IngestResult =
  | { ok: true; chunksInserted: number; chunksSkippedDuplicate: number }
  | { ok: false; error: string }

// Trebuie să rămână text-embedding-3-small: 1536 dimensiuni, exact cât declară
// coloana document_chunks.embedding și semnătura match_document_chunks.
const EMBEDDING_MODEL = "text-embedding-3-small"

export async function ingestDocument(documentId: string): Promise<IngestResult> {
  const admin = createAdminClient()

  /** Marchează documentul ca eșuat și propagă eroarea către apelant. */
  async function failWith(error: string): Promise<IngestResult> {
    await admin.from("documents").update({ ingest_status: "failed" }).eq("id", documentId)
    return { ok: false, error }
  }

  // 1. Citim rândul `documents` — tenant_id/context vin EXCLUSIV din DB, niciodată din input extern
  const { data: doc, error: docError } = await admin
    .from("documents")
    .select("id, tenant_id, file_name, mime_type, storage_path, deleted_at, ingest_status")
    .eq("id", documentId)
    .single()

  if (docError || !doc) {
    // Fără rând nu avem ce marca — ieșim direct.
    return { ok: false, error: "Document inexistent" }
  }
  if (doc.deleted_at) {
    return { ok: false, error: "Document șters, ingest anulat" }
  }

  // Lock optimistic: dacă un alt apel e deja în lucru sau a terminat, nu reprocesăm.
  if (doc.ingest_status === "processing") {
    return { ok: false, error: "Ingest deja în curs pentru acest document" }
  }
  if (doc.ingest_status === "done") {
    return { ok: true, chunksInserted: 0, chunksSkippedDuplicate: 0 }
  }

  const allowedMimeTypes = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]
  if (!allowedMimeTypes.includes(doc.mime_type)) {
    return failWith(`MIME neacceptat pentru ingest: ${doc.mime_type}`)
  }

  await admin.from("documents").update({ ingest_status: "processing" }).eq("id", doc.id)

  // 2. Descărcăm fișierul din storage
  const { data: fileBlob, error: downloadError } = await admin.storage
    .from("crm-documents")
    .download(doc.storage_path)

  if (downloadError || !fileBlob) {
    return failWith("Nu am putut descărca fișierul din storage")
  }

  const buffer = Buffer.from(await fileBlob.arrayBuffer())

  // 3. Parse — PDF scanat (fără text extractabil) → failed, fără OCR (out of scope MVP)
  let pages
  try {
    pages = await parseDocument(buffer, doc.mime_type)
  } catch (e) {
    return failWith(`Eroare parsare: ${(e as Error).message}`)
  }

  const totalText = pages.map((p) => p.text).join(" ").trim()
  if (totalText.length === 0) {
    return failWith("Niciun text extractabil (posibil PDF scanat, fără OCR în MVP)")
  }

  // 4. Chunking per pagină (păstrăm page_number per chunk).
  //    Deduplicăm pe content_sha ÎNAINTE de insert: două pagini identice ar produce
  //    același sha, iar un singur INSERT nu poate atinge de două ori aceeași cheie.
  type PendingChunk = { content: string; pageNumber: number | null; contentSha: string }
  const pending: PendingChunk[] = []
  const seenSha = new Set<string>()

  for (const page of pages) {
    if (!page.text.trim()) continue
    for (const c of chunkText(page.text)) {
      const contentSha = createHash("sha256").update(c.content).digest("hex")
      if (seenSha.has(contentSha)) continue
      seenSha.add(contentSha)
      pending.push({ content: c.content, pageNumber: page.pageNumber, contentSha })
    }
  }

  if (pending.length === 0) {
    return failWith("Niciun chunk generat din text")
  }

  // 5. Embeddings în batch
  let embeddings: number[][]
  try {
    const result = await embedMany({
      model: openai.textEmbeddingModel(EMBEDDING_MODEL),
      values: pending.map((p) => p.content),
    })
    embeddings = result.embeddings
  } catch (e) {
    return failWith(`Eroare la generarea embeddings: ${(e as Error).message}`)
  }

  // 6. Un singur upsert pentru toate chunk-urile — dedupe pe (document_id, content_sha).
  //    Varianta anterioară făcea un round-trip per chunk, ceea ce pe un PDF de câteva
  //    zeci de pagini însemna sute de cereri secvențiale către Postgres.
  const rows = pending.map((chunk, i) => ({
    tenant_id: doc.tenant_id, // explicit din rândul documents, niciodată din input
    document_id: doc.id,
    page_number: chunk.pageNumber,
    chunk_index: i,
    content: chunk.content,
    content_sha: chunk.contentSha,
    embedding: embeddings[i],
  }))

  const { data: insertData, error: insertError } = await admin
    .from("document_chunks")
    .upsert(rows, { onConflict: "document_id,content_sha", ignoreDuplicates: true })
    .select("id")

  if (insertError) {
    return failWith(`Eroare insert chunks: ${insertError.message}`)
  }

  const inserted = insertData?.length ?? 0

  const { error: statusError } = await admin
    .from("documents")
    .update({ ingest_status: "done" })
    .eq("id", doc.id)

  if (statusError) {
    return { ok: false, error: `Chunks salvate, dar statusul nu a putut fi marcat: ${statusError.message}` }
  }

  return { ok: true, chunksInserted: inserted, chunksSkippedDuplicate: rows.length - inserted }
}
