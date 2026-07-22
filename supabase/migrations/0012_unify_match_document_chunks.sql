-- ============================================================================
-- Migrare 0012: Unifică match_document_chunks, adaugă ingest_status
-- ============================================================================
-- 
-- Context: avem două variante conflictuale:
--   0004: SECURITY DEFINER, tenant_id ca parametru explicit, 7 parametri total
--   0011: fără SECURITY DEFINER, tenant_id din auth.jwt(), 5 parametri
--
-- Soluție: păstrăm varianta 0004 (SECURITY DEFINER e obligatoriu pentru admin
-- client care nu are JWT), dar actualizăm semnătura să includă parametrii noi.
-- ============================================================================

-- Ștergem varianta veche (0011) — trebuie să meționăm exact semnătura
DROP FUNCTION IF EXISTS match_document_chunks(
  vector(1536), float, int, uuid, uuid
);

-- 1. Adăugăm coloana ingest_status pe documents (dacă nu există)
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS ingest_status text NOT NULL DEFAULT 'pending'
CHECK (ingest_status IN ('pending', 'processing', 'done', 'failed'));

CREATE INDEX IF NOT EXISTS idx_documents_ingest_status 
ON documents(ingest_status) WHERE ingest_status IN ('pending', 'processing', 'failed');

-- ============================================================================
-- 2. Funcție match_document_chunks — VERSIUNEA DEFINITIVĂ
-- ============================================================================
-- 
-- SECURITY DEFINER: rulează cu privilegiile creatorului (indiferent de rolul
-- apelantului), ceea ce permite admin client-ului (service_role) să execute
-- queries chiar și pe tabela document_chunks care are RLS activat.
--
-- filter_tenant_id e OBLIGATORIU (fail-closed) — nu ne bazăm pe auth.jwt()
-- pentru că admin client nu are JWT.
--
-- XOR invariant: se filtrează fie după document_id, fie după (client_id XOR deal_id),
-- niciodată ambele simultan.
-- ============================================================================

CREATE OR REPLACE FUNCTION match_document_chunks(
    query_embedding vector(1536),
    match_threshold float DEFAULT 0.7,
    match_count int DEFAULT 10,
    filter_tenant_id uuid DEFAULT NULL,
    filter_document_id uuid DEFAULT NULL,
    filter_client_id uuid DEFAULT NULL,
    filter_deal_id uuid DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    document_id uuid,
    page_number integer,
    chunk_index integer,
    content text,
    similarity float,
    file_name text,
    mime_type text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Invariant: exact una dintre cele 3 variante de filtrare
    -- (document_id, client_id, deal_id) trebuie să fie specificată
    IF (
        (filter_document_id IS NOT NULL)::int +
        (filter_client_id IS NOT NULL)::int +
        (filter_deal_id IS NOT NULL)::int
    ) <> 1 THEN
        RAISE EXCEPTION 'Trebuie specificat exact unul: document_id, client_id, sau deal_id';
    END IF;

    IF filter_tenant_id IS NULL THEN
        RAISE EXCEPTION 'filter_tenant_id este obligatoriu';
    END IF;

    RETURN QUERY
    SELECT 
        dc.id,
        dc.document_id,
        dc.page_number,
        dc.chunk_index,
        dc.content,
        1 - (dc.embedding <=> query_embedding) AS similarity,
        d.file_name,
        d.mime_type
    FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id
    WHERE dc.tenant_id = filter_tenant_id
        AND (filter_document_id IS NULL OR dc.document_id = filter_document_id)
        AND (filter_client_id IS NULL OR d.client_id = filter_client_id)
        AND (filter_deal_id IS NULL OR d.deal_id = filter_deal_id)
        AND (1 - (dc.embedding <=> query_embedding)) >= match_threshold
        AND d.deleted_at IS NULL
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Timeout riguros
ALTER FUNCTION match_document_chunks(
    vector(1536), float, int, uuid, uuid, uuid, uuid
) SET statement_timeout = '5s';

-- ============================================================================
-- 3. Index pentru content_sha (dedupe) și ingest_status
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_document_chunks_content_sha
ON document_chunks(content_sha);

-- ============================================================================
-- 4. Ștergem trigger-ul vechi care trimitea pg_notify (nu e folosit)
-- ============================================================================

DROP TRIGGER IF EXISTS on_document_created ON documents;
DROP FUNCTION IF EXISTS trigger_document_ingest();

-- Nu mai avem nevoie de trigger — ingest e apelat direct din server action.

-- ============================================================================
-- FINAL
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE 'Migrare 0012 completată: match_document_chunks unificată, ingest_status adăugat';
END $$;
