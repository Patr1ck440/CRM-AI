import { NextResponse } from "next/server"
import { embed, generateText } from "ai"
import { openai } from "@ai-sdk/openai"
import { createClient } from "@/lib/supabase/server"
import { getTenantContext } from "@/lib/guards"
import { aiDocumentsQuerySchema } from "@/lib/validation/ai-documents-schema"

export const runtime = "nodejs"

// Model de chat folosit pentru sinteza răspunsului. Embedding-ul TREBUIE să rămână
// text-embedding-3-small (1536 dimensiuni) — e aceeași dimensiune cu vectorii
// scriși la ingest și cu semnătura vector(1536) a funcției match_document_chunks.
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini"
const EMBEDDING_MODEL = "text-embedding-3-small"

const MATCH_THRESHOLD = 0.3
const MATCH_COUNT = 8

const SYSTEM_PROMPT = `Ești un asistent care răspunde STRICT pe baza fragmentelor de document primite.

Reguli:
- Răspunde exclusiv din fragmentele furnizate. Nu completa din cunoștințe generale.
- Dacă fragmentele nu conțin răspunsul, spune clar: "Nu am găsit informația în documentele asociate."
- Răspunde în limba română, concis și la obiect.
- Când citezi o cifră, o dată sau o clauză, menționează numele fișierului din care provine.`

type MatchRow = {
  id: string
  document_id: string
  page_number: number | null
  chunk_index: number
  content: string
  similarity: number
  file_name: string
  mime_type: string
}

export async function POST(request: Request) {
  // 1. Autentificare. Spre deosebire de un Server Component, aici nu putem face
  //    redirect() — un fetch() din client are nevoie de un status code.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ ok: false, error: "Neautentificat" }, { status: 401 })
  }

  const ctx = await getTenantContext()

  // 2. Validare input
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: "Corp de cerere invalid" }, { status: 400 })
  }

  const parsed = aiDocumentsQuerySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Date invalide" },
      { status: 400 },
    )
  }

  const { question, client_id: clientId, deal_id: dealId } = parsed.data

  // 3. Verificăm că userul chiar are acces la contextul cerut. Interogarea trece
  //    prin clientul legat de RLS, deci un id din alt tenant (sau din afara
  //    vizibilității rolului) nu întoarce niciun rând.
  if (clientId) {
    const { data } = await supabase.from("clients").select("id").eq("id", clientId).maybeSingle()
    if (!data) {
      return NextResponse.json({ ok: false, error: "Client inexistent sau inaccesibil" }, { status: 403 })
    }
  } else if (dealId) {
    const { data } = await supabase.from("deals").select("id").eq("id", dealId).maybeSingle()
    if (!data) {
      return NextResponse.json({ ok: false, error: "Deal inexistent sau inaccesibil" }, { status: 403 })
    }
  }

  // 4. Embedding pentru întrebare
  let questionEmbedding: number[]
  try {
    const { embedding } = await embed({
      model: openai.textEmbeddingModel(EMBEDDING_MODEL),
      value: question,
    })
    questionEmbedding = embedding
  } catch (e) {
    console.error("AI documents — embedding failed:", e)
    return NextResponse.json(
      { ok: false, error: "Nu am putut procesa întrebarea (embedding indisponibil)" },
      { status: 502 },
    )
  }

  // 5. Căutare vectorială. filter_tenant_id vine din contextul de sesiune,
  //    NICIODATĂ din body — funcția e SECURITY DEFINER și e fail-closed pe el.
  const { data: matches, error: matchError } = await supabase.rpc("match_document_chunks", {
    query_embedding: questionEmbedding,
    match_threshold: MATCH_THRESHOLD,
    match_count: MATCH_COUNT,
    filter_tenant_id: ctx.tenantId,
    filter_document_id: null,
    filter_client_id: clientId ?? null,
    filter_deal_id: dealId ?? null,
  })

  if (matchError) {
    console.error("AI documents — match_document_chunks failed:", matchError)
    return NextResponse.json(
      { ok: false, error: `Eroare la căutarea în documente: ${matchError.message}` },
      { status: 500 },
    )
  }

  const chunks = (matches ?? []) as MatchRow[]

  if (chunks.length === 0) {
    return NextResponse.json({
      ok: true,
      answer:
        "Nu am găsit niciun fragment relevant în documentele asociate acestui context. " +
        "Verifică dacă există documente încărcate și dacă indexarea lor s-a finalizat.",
      citations: [],
    })
  }

  // 6. Context pentru model — numerotăm sursele ca modelul să le poată referi
  const contextBlock = chunks
    .map((c, i) => {
      const page = c.page_number ? `, pagina ${c.page_number}` : ""
      return `[Sursa ${i + 1} — ${c.file_name}${page}]\n${c.content}`
    })
    .join("\n\n---\n\n")

  let answer: string
  try {
    const result = await generateText({
      model: openai(CHAT_MODEL),
      system: SYSTEM_PROMPT,
      prompt: `Fragmente din documente:\n\n${contextBlock}\n\n---\n\nÎntrebare: ${question}`,
    })
    answer = result.text
  } catch (e) {
    console.error("AI documents — generateText failed:", e)
    return NextResponse.json(
      { ok: false, error: "Nu am putut genera răspunsul (model indisponibil)" },
      { status: 502 },
    )
  }

  // 7. Citări — un rând per (document, pagină), în ordinea relevanței
  const seen = new Set<string>()
  const citations = chunks
    .filter((c) => {
      const key = `${c.document_id}:${c.page_number ?? "-"}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((c) => ({
      id: c.id,
      file_name: c.file_name,
      page_number: c.page_number,
    }))

  return NextResponse.json({ ok: true, answer, citations })
}
