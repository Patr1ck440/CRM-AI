# Neconcordanțe între schema bazei de date și codul aplicației

Document generat în urma unui audit al bazei de producție (`hruwsmlumhbevbulviob`), comparată cu codul din acest repo.

**Concluzia pe scurt:** schema din baza de date provine dintr-un design mai vechi decât codul aplicației. Nu e vorba de câteva bug-uri izolate, ci de o desincronizare structurală. Zone întregi din aplicație — tot onboarding-ul și toată secțiunea de administrare — nu pot funcționa pe schema actuală, indiferent cât de corect e codul.

Nicio modificare din acest document **nu a fost aplicată** bazei de producție.

---

## 1. Valori de enum pe care codul le scrie, dar care nu există în bază

Coloanele sunt tipate cu aceste enum-uri, deci Postgres respinge orice altă valoare cu `invalid input value for enum`.

| Enum | Valori în bază | Valori folosite de cod | Lipsesc |
|---|---|---|---|
| `deal_stage` | `lead, qualified, proposal, negotiation, won, lost` | `lead, contacted, offer_sent, won, lost` | **`contacted`, `offer_sent`** |
| `team_role` | `lead, member` | `manager, member` | **`manager`** |
| `activity_type` | `call, email, meeting, note, task` | `call, meeting, note` | — (codul e un subset, OK) |
| `app_role` | `owner, admin, manager, agent` | `admin, manager, agent` | — (codul e un subset, OK) |

**Impact:**

- Pipeline-ul e practic blocat. Tranzițiile definite în `lib/validation/schemas.ts` sunt `lead → contacted → offer_sent → won`, dar `contacted` și `offer_sent` nu există în bază. Singura mutare care funcționează din `lead` este spre `lost`.
- `setTeamMemberAction` eșuează de fiecare dată când se alege rolul „Manager".

---

## 2. Funcții RPC apelate de aplicație, inexistente în bază

| Funcție | Apelată din | Ce se rupe |
|---|---|---|
| `bootstrap_tenant` | `server/actions/auth.ts:14` | Un utilizator nou nu-și poate crea organizația. Rămâne blocat la `/onboarding` la nesfârșit. |
| `accept_invitation` | `server/actions/auth.ts:30` | Invitațiile nu pot fi acceptate. |
| `set_member_role` | `server/actions/admin.ts:65` | Rolurile nu pot fi schimbate. |

Asta explică de ce baza conține un singur profil: fluxul de înregistrare nu a funcționat niciodată complet.

---

## 3. Politici RLS lipsă pentru scriere

Când RLS e activ și nicio politică nu acoperă operația, Postgres o refuză tăcut (afectează 0 rânduri). Situația actuală:

| Tabelă | RLS | Operații permise | Ce se rupe |
|---|---|---|---|
| `clients` | da | SELECT, INSERT, UPDATE, DELETE | — |
| `contacts` | da | SELECT, INSERT, UPDATE, DELETE | — |
| `deals` | da | SELECT, INSERT, UPDATE, DELETE | — |
| `documents` | da | SELECT, INSERT, UPDATE, DELETE | — |
| `activities` | da | SELECT, INSERT | `deleteActivityAction` nu face nimic |
| `document_chunks` | da | SELECT, INSERT | ștergerea chunk-urilor nu e posibilă din client |
| `profiles` | da | **doar SELECT** | `setUserActiveAction` (activare/dezactivare) nu face nimic |
| `teams` | da | **doar SELECT** | crearea și ștergerea echipelor eșuează |
| `team_memberships` | da | **doar SELECT** | adăugarea/eliminarea membrilor eșuează |
| `invitations` | da | **doar SELECT** | crearea și revocarea invitațiilor eșuează |
| `deal_stage_history` | da | **doar SELECT** | scris de un trigger care nu există (vezi 5) |
| `tenants` | **NU** | — | vezi 4 |

**Efect cumulat:** întreaga secțiune `/dashboard/admin` este nefuncțională.

---

## 4. Problemă de securitate: `tenants` fără RLS

Tabela `public.tenants` are Row Level Security **dezactivat** și nicio politică. Cheia `anon` este publică prin construcție — ajunge în browser la fiecare vizitator. Oricine o extrage poate citi și modifica toate rândurile din `tenants`, adică lista tuturor organizațiilor din sistem.

Remedierea **nu** e doar activarea flag-ului. Următoarea comandă, rulată singură, blochează complet accesul la tabelă și strică aplicația:

```sql
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
```

E nevoie de politici scrise odată cu ea — minim o politică de SELECT care să limiteze fiecare utilizator la propriul `tenant_id`.

---

## 5. Triggere învechite pe `documents`

| Trigger | Ce face | Problemă |
|---|---|---|
| `document_ingest` | `http_request('http://localhost:3000/api/documents/ingest', ...)` | Ruta a fost ștearsă în commit-ul `147076d`. La fiecare încărcare de document se face o cerere HTTP către un endpoint inexistent, cu timeout de 5s. Adresa e hardcodată pe `localhost:3000`, deci în producție ar fi oricum greșită. |
| `on_document_created` | `trigger_document_ingest()` | Migrația 0012 conține explicit `DROP TRIGGER IF EXISTS on_document_created` — dar triggerul încă există, deci **0012 nu a fost aplicată complet**. |
| `trigger_document_ingest` | `notify_document_ingest()` | Notificare `pg_notify` pe care nimic nu o ascultă. |

Ingest-ul se face acum sincron, direct din `uploadDocumentAction` — toate cele trei triggere sunt reziduuri.

Nu există **niciun** trigger pe `deals` care să valideze tranzițiile de etapă, deși `server/actions/deals.ts` comentează că „stage change is validated again server-side by the DB trigger". Nu există nici trigger care să populeze `deal_stage_history`.

---

## 6. Modelul de vizibilitate pe roluri nu e implementat

Pagina de prezentare afirmă: *„Agentul vede doar ce deține, managerul vede echipa, adminul vede întreaga organizație."*

În realitate, toate politicile de SELECT filtrează exclusiv pe `tenant_id`. Un agent vede toți clienții și toate oportunitățile din organizație, exact ca un administrator. Rolurile sunt stocate și afișate, dar nu influențează accesul la date.

---

## 7. Suprapuneri de funcții

Există patru variante simultane ale `match_document_chunks`. Migrația 0012 și-a propus să le unifice, dar `DROP`-ul ei acoperea o singură semnătură. Aplicația apelează RPC-ul cu argumente numite, deci PostgREST alege corect varianta cu 7 parametri — nu se rupe nimic azi. Riscul e că una dintre variantele rămase rulează fără `SECURITY DEFINER` și se bazează pe un claim `tenant_id` din JWT care nu există.

Rezolvat de migrația `0002_cleanup_match_overloads.sql`, care nu a fost încă aplicată producției.

---

## Ce ar fi nevoie pentru ca aplicația să funcționeze integral

Direcția recomandată este **alinierea bazei la cod** (codul e coerent și mai dezvoltat decât schema, iar baza conține aproape zero date: 1 organizație, 1 utilizator, 1 client, 0 oportunități).

Ar fi nevoie de o migrație care:

1. adaugă `contacted` și `offer_sent` în `deal_stage`, și `manager` în `team_role`;
2. creează `bootstrap_tenant`, `accept_invitation` și `set_member_role`;
3. adaugă politicile RLS de scriere lipsă, restrânse la administratori acolo unde e cazul;
4. activează RLS pe `tenants`, împreună cu politicile aferente;
5. șterge cele trei triggere reziduale de pe `documents`;
6. opțional, adaugă triggerul de validare a tranzițiilor și pe cel de istoric al etapelor.

Punctele 2, 3 și 4 sunt SQL sensibil din punct de vedere al securității și trebuie revizuite înainte de aplicare.
