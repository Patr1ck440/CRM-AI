CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter_client_id uuid DEFAULT NULL,
  filter_deal_id uuid DEFAULT NULL
)
RETURNS TABLE (
  chunk_id uuid,
  content text,
  page_number int,
  file_name text,
  document_id uuid,
  similarity float
)
LANGUAGE plpgsql
SET statement_timeout = '5s'
AS $$
BEGIN
  IF (filter_deal_id IS NULL) = (filter_client_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one of filter_client_id or filter_deal_id must be provided';
  END IF;

  RETURN QUERY
  SELECT
    dc.id AS chunk_id,
    dc.content,
    dc.page_number,
    d.file_name,
    d.id AS document_id,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM document_chunks dc
  JOIN documents d ON d.id = dc.document_id
  WHERE
    dc.tenant_id = (auth.jwt()->>'tenant_id')::uuid
    AND (filter_client_id IS NULL OR d.client_id = filter_client_id)
    AND (filter_deal_id IS NULL OR d.deal_id = filter_deal_id)
    AND (1 - (dc.embedding <=> query_embedding)) >= match_threshold
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
