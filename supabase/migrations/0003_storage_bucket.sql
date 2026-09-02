-- ============================================================================
-- 0003 — Bucket-ul de storage pentru documente
-- ============================================================================
--
-- `supabase db dump` exportă doar schema `public`, deci bucket-ul și politicile
-- de storage nu au ajuns în migrația de bază. Fără ele, încărcarea documentelor
-- eșuează pe orice mediu nou.
--
-- Politicile sunt replicate după producție, cu o singură diferență: acolo există
-- și un set paralel de politici bazate pe `auth.jwt() ->> 'tenant_id'`. Acel
-- claim nu există în token-urile emise de Supabase Auth în acest proiect, deci
-- politicile respective nu acordă niciodată acces. Păstrăm doar setul care
-- funcționează, cel bazat pe `current_tenant_id()`.
--
-- Convenția de cale este `<tenant_id>/<client_sau_deal_id>/<document_id>.<ext>`,
-- stabilită în `uploadDocumentAction`. Primul segment fiind tenant_id-ul, e
-- suficient să comparăm `storage.foldername(name)[1]` cu tenantul curent.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('crm-documents', 'crm-documents', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "documents_storage_select_same_tenant" ON storage.objects;
CREATE POLICY "documents_storage_select_same_tenant"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'crm-documents'
  AND (storage.foldername(name))[1] = (public.current_tenant_id())::text
  AND EXISTS (SELECT 1 FROM public.documents d WHERE d.storage_path = objects.name)
);

DROP POLICY IF EXISTS "documents_storage_insert_same_tenant" ON storage.objects;
CREATE POLICY "documents_storage_insert_same_tenant"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'crm-documents'
  AND (storage.foldername(name))[1] = (public.current_tenant_id())::text
);

DROP POLICY IF EXISTS "documents_storage_delete_same_tenant" ON storage.objects;
CREATE POLICY "documents_storage_delete_same_tenant"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'crm-documents'
  AND (storage.foldername(name))[1] = (public.current_tenant_id())::text
  AND EXISTS (SELECT 1 FROM public.documents d WHERE d.storage_path = objects.name)
);
