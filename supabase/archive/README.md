# Migrații arhivate

Fișierele din acest folder **nu mai sunt aplicate**. Sunt păstrate doar ca istoric.

Au fost înlocuite de `supabase/migrations/0001_baseline_schema.sql`, extras direct din baza de producție cu `supabase db dump --linked`.

## De ce

Setul de migrații din repo era incomplet și nu putea reconstrui baza de la zero:

- numerotarea sărea de la `0004` la `0011`; migrațiile `0001`–`0003` și `0005`–`0010` nu au existat niciodată în repo;
- împreună, aceste trei fișiere creau o singură tabelă (`document_chunks`), din cele 12 existente în bază;
- toate politicile RLS, enum-urile și funcțiile auxiliare existau doar în proiectul din cloud;
- `0012` nu a fost aplicată complet în producție — instrucțiunile ei de `DROP TRIGGER` nu au avut efect, triggerele vizate există în continuare.

## Conținut

| Fișier | Ce făcea |
|---|---|
| `0004_dms_embeddings.sql` | tabela `document_chunks`, indexul HNSW, prima variantă `match_document_chunks` |
| `0011_documents_ingest_status.sql` | variantă `match_document_chunks` bazată pe `auth.jwt()->>'tenant_id'` |
| `0012_unify_match_document_chunks.sql` | încercare de unificare a variantelor + `ingest_status` |

Neconcordanțele rămase între schemă și codul aplicației sunt documentate în [`../SCHEMA-GAPS.md`](../SCHEMA-GAPS.md).
