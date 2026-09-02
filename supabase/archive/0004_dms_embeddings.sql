-- Migrare DMS & Embeddings - Aliniată cu implementarea existentă și planul din §6-§7

-- ============================================================================
-- 1. EXTENSII NECESARE
-- ============================================================================

-- pgvector pentru embeddings (dacă nu e deja activată)
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- 2. TABELE EXISTENTE (completate cu constrângeri lipsă)
-- ============================================================================

-- Documents table (ar trebui să existe deja din migrarea CRM)
-- Completați cu constrângerile specifice DMS dacă lipsesc:

-- Verificăm și adăugăm constraint-ul CHECK pentru exact un context (client XOR deal)
ALTER TABLE documents 
DROP CONSTRAINT IF EXISTS documents_context_check;

ALTER TABLE documents 
ADD CONSTRAINT documents_context_check 
CHECK (
    (client_id IS NULL AND deal_id IS NOT NULL) OR 
    (client_id IS NOT NULL AND deal_id IS NULL)
);

-- Index pentru căutări eficiente
CREATE INDEX IF NOT EXISTS idx_documents_tenant_context 
ON documents(tenant_id, client_id, deal_id);

CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by 
ON documents(uploaded_by);

CREATE INDEX IF NOT EXISTS idx_documents_created_at 
ON documents(created_at DESC);

-- Index pentru soft delete
CREATE INDEX IF NOT EXISTS idx_documents_deleted_at 
ON documents(deleted_at) WHERE deleted_at IS NULL;

-- ============================================================================
-- 3. DOCUMENT_CHUNKS TABLE (cu vector și HNSW)
-- ============================================================================

-- Dacă tabela document_chunks nu există, o creăm
CREATE TABLE IF NOT EXISTS document_chunks (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    document_id uuid NOT NULL,
    page_number integer,
    chunk_index integer NOT NULL,
    content text NOT NULL,
    content_sha text NOT NULL,
    embedding vector(1536) NOT NULL, -- text-embedding-3-small are 1536 dimensions
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT document_chunks_pkey PRIMARY KEY (id),
    CONSTRAINT document_chunks_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
    CONSTRAINT document_chunks_document_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id),
    CONSTRAINT document_chunks_unique_document_chunk UNIQUE (document_id, content_sha),
    CONSTRAINT document_chunks_tenant_document_fk FOREIGN KEY (tenant_id, document_id) 
        REFERENCES public.documents(tenant_id, id)
);

-- Index pentru căutări rapide după document
CREATE INDEX IF NOT EXISTS idx_document_chunks_document 
ON document_chunks(document_id);

-- Index pentru tenant (RLS performance)
CREATE INDEX IF NOT EXISTS idx_document_chunks_tenant 
ON document_chunks(tenant_id);

-- ============================================================================
-- 4. HNSW INDEX PENTRU CĂUTARE SEMANTICĂ (vector similarity search)
-- ============================================================================

-- HNSW index pentru căutări rapide de similaritate
-- Settings optimizate conform planului (§6)
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_hnsw 
ON document_chunks 
USING hnsw (embedding vector_cosine_ops) 
WITH (m = 16, ef_construction = 64);

-- Notă: Setările HNSW se aplică în funcția RPC, nu la nivel de index
-- ALTER INDEX ... SET nu funcționează pentru hnsw.* parameters

-- ============================================================================
-- 5. FUNCȚIE RPC PENTRU CĂUTARE SEMANTICĂ (match_document_chunks)
-- ============================================================================

-- Funcție security definer pentru căutare semantică cu filtru tenant + context
-- Aliniată cu §6 din plan: filtru tenant_id explicit + XOR context obligatoriu

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
    -- Invariant XOR: exact un context trebuie să fie specificat
    -- (document_id SAU client_id/deal_id, dar nu ambele sau niciunul)
    IF (filter_document_id IS NOT NULL) AND 
       (filter_client_id IS NOT NULL OR filter_deal_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Nu se pot specifica atât document_id cât și client_id/deal_id simultan';
    END IF;
    
    IF (filter_document_id IS NULL) AND 
       (filter_client_id IS NULL AND filter_deal_id IS NULL) THEN
        RAISE EXCEPTION 'Trebuie specificat fie document_id, fie client_id/deal_id';
    END IF;
    
    -- Filtru client_id/deal_id trebuie să fie XOR
    IF (filter_client_id IS NOT NULL) AND (filter_deal_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Nu se pot specifica atât client_id cât și deal_id simultan';
    END IF;
    
    -- Validare tenant_id (fail-closed)
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
        (dc.embedding <=> query_embedding) AS similarity,
        d.file_name,
        d.mime_type
    FROM document_chunks dc
    JOIN documents d ON d.id = dc.document_id
    WHERE dc.tenant_id = filter_tenant_id
        -- Filtru document_id direct
        AND (filter_document_id IS NULL OR dc.document_id = filter_document_id)
        -- Filtru prin client_id sau deal_id (prin documents)
        AND (
            (filter_client_id IS NOT NULL AND d.client_id = filter_client_id) OR
            (filter_deal_id IS NOT NULL AND d.deal_id = filter_deal_id)
        )
        -- Filtru de similaritate
        AND (dc.embedding <=> query_embedding) < (1 - match_threshold)
        -- Nu returnăm chunk-uri din documente șterse
        AND d.deleted_at IS NULL
    ORDER BY dc.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Setări de performanță pentru funcție (hoisted conform planului §6)
ALTER FUNCTION match_document_chunks(
    vector(1536), float, int, uuid, uuid, uuid, uuid
) SET statement_timeout = '5s';

-- Notă: hnsw.iterative_scan se setează la nivel de sesiune în aplicație, nu în funcție

-- ============================================================================
-- 6. ROW LEVEL SECURITY (RLS) PENTRU DOCUMENTS & DOCUMENT_CHUNKS
-- ============================================================================

-- Documents RLS
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;

-- Policies pentru documents
DROP POLICY IF EXISTS "Users can view documents from their tenant" ON documents;
CREATE POLICY "Users can view documents from their tenant"
ON documents FOR SELECT
USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    AND deleted_at IS NULL
);

DROP POLICY IF EXISTS "Users can insert documents to their tenant" ON documents;
CREATE POLICY "Users can insert documents to their tenant"
ON documents FOR INSERT
WITH CHECK (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    AND uploaded_by = auth.uid()
);

DROP POLICY IF EXISTS "Users can update their documents" ON documents;
CREATE POLICY "Users can update their documents"
ON documents FOR UPDATE
USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    AND uploaded_by = auth.uid()
);

DROP POLICY IF EXISTS "Users can delete their documents" ON documents;
CREATE POLICY "Users can delete their documents"
ON documents FOR DELETE
USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    AND uploaded_by = auth.uid()
);

-- Document chunks RLS
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks FORCE ROW LEVEL SECURITY;

-- Policies pentru document_chunks (aceeași logică ca documents)
DROP POLICY IF EXISTS "Users can view document chunks from their tenant" ON document_chunks;
CREATE POLICY "Users can view document chunks from their tenant"
ON document_chunks FOR SELECT
USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
);

DROP POLICY IF EXISTS "Users can insert document chunks to their tenant" ON document_chunks;
CREATE POLICY "Users can insert document chunks to their tenant"
ON document_chunks FOR INSERT
WITH CHECK (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
);

-- ============================================================================
-- 7. STORAGE BUCKET & RLS POLICIES
-- ============================================================================

-- Creăm bucket-ul privat pentru documente (dacă nu există)
INSERT INTO storage.buckets (id, name, public) 
VALUES ('crm-documents', 'crm-documents', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policies pentru storage.objects
DROP POLICY IF EXISTS "Users can upload to their tenant folder" ON storage.objects;
CREATE POLICY "Users can upload to their tenant folder"
ON storage.objects FOR INSERT
WITH CHECK (
    bucket_id = 'crm-documents'
    AND (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')::text
    AND auth.uid() IN (
        SELECT id FROM profiles 
        WHERE tenant_id = (auth.jwt() ->> 'tenant_id')::uuid 
        AND is_active = true
    )
);

DROP POLICY IF EXISTS "Users can view objects in their tenant folder" ON storage.objects;
CREATE POLICY "Users can view objects in their tenant folder"
ON storage.objects FOR SELECT
USING (
    bucket_id = 'crm-documents'
    AND (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')::text
    AND auth.uid() IN (
        SELECT id FROM profiles 
        WHERE tenant_id = (auth.jwt() ->> 'tenant_id')::uuid 
        AND is_active = true
    )
);

DROP POLICY IF EXISTS "Users can delete their own documents" ON storage.objects;
CREATE POLICY "Users can delete their own documents"
ON storage.objects FOR DELETE
USING (
    bucket_id = 'crm-documents'
    AND (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')::text
    AND EXISTS (
        SELECT 1 FROM documents d 
        WHERE d.storage_path = storage.objects.name 
        AND d.uploaded_by = auth.uid()
    )
);

-- ============================================================================
-- 8. TRIGGER PENTRU INGEST AUTOMAT (Database Webhook)
-- ============================================================================

-- Funcție trigger care notifică ingest când un document nou e creat
CREATE OR REPLACE FUNCTION trigger_document_ingest()
RETURNS TRIGGER AS $$
BEGIN
    -- Trimitem notificare către ingest endpoint
    -- NOTĂ: Aceasta e o notificare PostgreSQL, nu HTTP
    -- Ingest endpoint-ul va fi apelat prin Database Webhook (pg_net)
    PERFORM pg_notify('document_ingest', jsonb_build_object(
        'document_id', NEW.id,
        'tenant_id', NEW.tenant_id,
        'file_name', NEW.file_name,
        'mime_type', NEW.mime_type
    )::text);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Creăm trigger-ul
DROP TRIGGER IF EXISTS on_document_created ON documents;
CREATE TRIGGER on_document_created
AFTER INSERT ON documents
FOR EACH ROW
EXECUTE FUNCTION trigger_document_ingest();

-- ============================================================================
-- 9. VIEWS PENTRU AI (ai.*_v) - EXCLUDE COLOANE SENSIBILE
-- ============================================================================

-- Schema AI pentru views sigure
CREATE SCHEMA IF NOT EXISTS ai;

-- View pentru documents (fără storage_path, token_hash, etc.)
CREATE OR REPLACE VIEW ai.documents_v AS
SELECT 
    id,
    tenant_id,
    client_id,
    deal_id,
    file_name,
    mime_type,
    file_size,
    uploaded_by,
    created_at,
    deleted_at
FROM documents;

-- View pentru document_chunks (fără content complet, doar metadata)
CREATE OR REPLACE VIEW ai.document_chunks_v AS
SELECT 
    id,
    tenant_id,
    document_id,
    page_number,
    chunk_index,
    -- Nu expunem content-ul complet în catalogul AI
    substring(content for 200) AS content_preview,
    content_sha,
    created_at
FROM document_chunks;

-- Grant-uri pentru views AI (doar pentru rolul authenticated)
GRANT USAGE ON SCHEMA ai TO authenticated;
GRANT SELECT ON ai.documents_v TO authenticated;
GRANT SELECT ON ai.document_chunks_v TO authenticated;

-- ============================================================================
-- 10. FUNCȚII HELPER PENTRU AUDIT ȘI LOG
-- ============================================================================

-- Funcție pentru logarea căutărilor AI (pe conexiune separată)
CREATE OR REPLACE FUNCTION log_document_search(
    p_tenant_id uuid,
    p_user_id uuid,
    p_query_text text,
    p_filter_type text,
    p_filter_id uuid,
    p_result_count integer,
    p_status text
) RETURNS void AS $$
BEGIN
    -- Logăm căutarea într-o tabelă de audit (pe conexiune separată)
    INSERT INTO audit_log (
        tenant_id,
        actor_id,
        action,
        resource_type,
        details,
        created_at
    ) VALUES (
        p_tenant_id,
        p_user_id,
        p_status,
        'document_search',
        jsonb_build_object(
            'query', p_query_text,
            'filter_type', p_filter_type,
            'filter_id', p_filter_id,
            'result_count', p_result_count
        ),
        now()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 11. CLEANUP & MAINTENANCE
-- ============================================================================

-- Funcție pentru cleanup documente șterse (hard delete)
CREATE OR REPLACE FUNCTION cleanup_deleted_documents()
RETURNS void AS $$
BEGIN
    -- Ștergem documentele marcate pentru ștergere acum > 30 zile
    DELETE FROM document_chunks 
    WHERE document_id IN (
        SELECT id FROM documents 
        WHERE deleted_at < now() - interval '30 days'
    );
    
    DELETE FROM documents 
    WHERE deleted_at < now() - interval '30 days';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funcție pentru vacuum și analyze pe document_chunks
CREATE OR REPLACE FUNCTION maintain_document_chunks()
RETURNS void AS $$
BEGIN
    VACUUM ANALYZE document_chunks;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 12. INDEXURI SUPLIMENTARE PENTRU PERFORMANȚĂ
-- ============================================================================

-- Index compus pentru căutări frecvente
CREATE INDEX IF NOT EXISTS idx_document_chunks_tenant_document_page
ON document_chunks(tenant_id, document_id, page_number);

-- Index pentru content_sha (dedupe)
CREATE INDEX IF NOT EXISTS idx_document_chunks_content_sha
ON document_chunks(content_sha);

-- ============================================================================
-- FINALIZARE
-- ============================================================================

-- Notificăm că migrarea a fost completată
DO $$
BEGIN
    RAISE NOTICE 'Migrare DMS & Embeddings completată cu succes!';
    RAISE NOTICE ' - Tabele: documents, document_chunks';
    RAISE NOTICE ' - Vector extension: pgvector (1536 dimensions)';
    RAISE NOTICE ' - HNSW index pentru căutări semantice';
    RAISE NOTICE ' - RLS activat și forțat pe toate tabelele';
    RAISE NOTICE ' - Storage bucket: crm-documents (privat)';
    RAISE NOTICE ' - Views AI: ai.documents_v, ai.document_chunks_v';
    RAISE NOTICE ' - Funcții RPC: match_document_chunks';
    RAISE NOTICE ' - Trigger ingest: trigger_document_ingest()';
END $$;