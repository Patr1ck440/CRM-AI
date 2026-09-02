-- ============================================================================
-- Migrare 0013: curata suprapunerile ramase de match_document_chunks
-- ============================================================================
--
-- Migrarea 0012 si-a propus sa "unifice" functia, dar DROP-ul ei acoperea o
-- singura semnatura. In baza raman patru variante simultan:
--
--   1. (vector, float, int, uuid, uuid)              -- 0011, SECURITY INVOKER,
--                                                       filtreaza pe auth.jwt()->>'tenant_id'
--   2. (vector, uuid, uuid, float, int)              -- varianta veche, SECURITY DEFINER
--   3. (vector, float, int, uuid, uuid, uuid)        -- varianta cu p_tenant_id
--   4. (vector, float, int, uuid, uuid, uuid, uuid)  -- 0012, cea folosita de aplicatie
--
-- Aplicatia apeleaza RPC-ul cu argumente numite, deci PostgREST alege corect
-- varianta 4. Suprapunerile nu rup nimic azi, dar sunt un pericol: varianta 1
-- ruleaza fara SECURITY DEFINER si se bazeaza pe un claim `tenant_id` in JWT
-- care nu exista, iar orice apel viitor cu alt set de argumente poate cadea pe
-- ea in tacere si intoarce zero rezultate.
--
-- Pastram exclusiv varianta 4.
-- ============================================================================

DROP FUNCTION IF EXISTS public.match_document_chunks(vector, double precision, integer, uuid, uuid);
DROP FUNCTION IF EXISTS public.match_document_chunks(vector, uuid, uuid, double precision, integer);
DROP FUNCTION IF EXISTS public.match_document_chunks(vector, double precision, integer, uuid, uuid, uuid);

-- ============================================================================
-- ingest_status: 0012 o declara NOT NULL + CHECK, dar folosea ADD COLUMN
-- IF NOT EXISTS pe o coloana care exista deja, deci constrangerile nu s-au
-- aplicat niciodata. Le punem acum.
-- ============================================================================

UPDATE documents SET ingest_status = 'pending' WHERE ingest_status IS NULL;

ALTER TABLE documents ALTER COLUMN ingest_status SET NOT NULL;
ALTER TABLE documents ALTER COLUMN ingest_status SET DEFAULT 'pending';

ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_ingest_status_check;
ALTER TABLE documents ADD CONSTRAINT documents_ingest_status_check
  CHECK (ingest_status IN ('pending', 'processing', 'done', 'failed'));

-- ============================================================================
-- Verificare: trebuie sa ramana exact o singura functie
-- ============================================================================

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
  WHERE ns.nspname = 'public' AND p.proname = 'match_document_chunks';

  IF n <> 1 THEN
    RAISE EXCEPTION 'Asteptam o singura match_document_chunks, am gasit %', n;
  END IF;

  RAISE NOTICE 'Migrare 0013 completata: o singura match_document_chunks, ingest_status constrans';
END $$;
