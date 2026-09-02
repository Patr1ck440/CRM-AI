# Ghid de instalare — Nimbus CRM

Ghid complet pentru a rula aplicația pe un calculator nou.

---

## 1. Ce trebuie instalat înainte

| Program | Versiune | De unde |
|---|---|---|
| **Node.js** | 20 sau mai nou (testat pe 22) | <https://nodejs.org> — varianta LTS |
| **Git** | orice versiune recentă | <https://git-scm.com/downloads> |
| **Visual Studio Code** | opțional, doar ca editor | <https://code.visualstudio.com> |

Verifică după instalare, într-un terminal:

```bash
node --version
```

Dacă răspunde cu `v20.x` sau mai mult, e în regulă.

---

## 2. Descarcă proiectul

```bash
git clone https://github.com/Patr1ck440/CRM-AI.git
```

Apoi intră în folder:

```bash
cd CRM-AI
```

---

## 3. Instalează dependențele

```bash
npm install
```

Durează 1–3 minute. Folosește `npm`, nu `pnpm` — în repo există ambele lockfile-uri, dar `package-lock.json` este cel actual.

---

## 4. Configurează variabilele de mediu

Creează în rădăcina proiectului un fișier numit exact **`.env.local`** (fișierul e în `.gitignore`, deci nu ajunge niciodată pe GitHub — aici stau toate secretele).

Conținutul, cu 5 variabile:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
OPENAI_API_KEY=sk-proj-...
INGEST_HMAC_SECRET=un-sir-aleator-oarecare
```

De unde iei fiecare:

- **Cele trei chei `SUPABASE_*`** — vezi secțiunea 5.
- **`OPENAI_API_KEY`** — din <https://platform.openai.com/api-keys>. Contul are nevoie de credit activ; e folosită pentru embeddings (indexarea documentelor) și pentru răspunsurile chat-ului AI. Fără ea, restul aplicației merge, dar tot ce ține de AI dă eroare.
- **`INGEST_HMAC_SECRET`** — orice șir aleator. Nu mai e folosit activ în cod, dar îl păstrăm pentru compatibilitate.

> Nu pune niciodată aceste valori în cod și nu le trimite pe chat/email. Fișierul `.env.local` rămâne doar local.

---

## 5. Baza de date

Aplicația folosește **Supabase** (PostgreSQL găzduit) pentru patru lucruri simultan: baza de date, autentificarea utilizatorilor, stocarea fișierelor PDF/DOCX și căutarea vectorială `pgvector`.

### ⚠️ Limitare importantă în acest moment

**Repo-ul nu conține schema completă a bazei de date.** În `supabase/migrations/` există doar 4 migrații (0004, 0011, 0012, 0013), care creează o singură tabelă — `document_chunks`. Restul de 11 tabele (`tenants`, `profiles`, `teams`, `team_memberships`, `invitations`, `clients`, `contacts`, `deals`, `activities`, `deal_stage_history`, `documents`), toate politicile RLS și funcțiile `bootstrap_tenant`, `accept_invitation`, `set_member_role` **există doar în proiectul Supabase existent**, nu și în git. Migrațiile 0001–0003 și 0005–0010 lipsesc.

Consecință practică: momentan **nu se poate reconstrui baza de la zero din acest repo**.

### Varianta care funcționează azi

Cere-i proprietarului proiectului acces la organizația Supabase existentă, apoi:

1. Intră pe <https://supabase.com/dashboard>.
2. Alege proiectul.
3. **Project Settings → API**, de unde copiezi:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - cheia `anon` / `public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - cheia `service_role` → `SUPABASE_SERVICE_ROLE_KEY`

> Cheia `service_role` ocolește complet regulile de securitate RLS. Se folosește doar pe server. Nu o pune niciodată într-o variabilă care începe cu `NEXT_PUBLIC_`, pentru că acelea ajung în browser.

**Atenție:** pe planul gratuit, Supabase pune proiectul pe pauză după o perioadă de inactivitate. Dacă aplicația pornește dar login-ul și toate listele dau eroare, verifică în dashboard dacă proiectul e `ACTIVE` și apasă *Restore* dacă e pe pauză.

### Varianta recomandată pe termen lung

Odată ce schema completă ajunge în `supabase/migrations/`, oricine va putea rula întreaga bază **local**, fără cont Supabase, cu Docker Desktop instalat:

```bash
npx supabase start
```

Comanda pornește local PostgreSQL + Auth + Storage + pgvector și aplică singură migrațiile din repo, apoi afișează un `API URL` și cheile locale, pe care le pui în `.env.local`. Asta e soluția reală la „să nu se complice cu Supabase" — vezi secțiunea 8.

---

## 6. Pornește aplicația

```bash
npm run dev
```

Deschide <http://localhost:3000>.

Primul cont creat prin **„Creați-vă organizația"** devine automat administrator. Supabase trimite un email de confirmare care trebuie apăsat înainte de prima autentificare.

Pentru varianta de producție:

```bash
npm run build
```

```bash
npm start
```

---

## 7. Verificare rapidă că totul merge

1. Pagina de start se încarcă la `localhost:3000` → Node și dependențele sunt în regulă.
2. Te poți autentifica → cheile Supabase sunt corecte și proiectul e activ.
3. Panoul de control se încarcă fără eroare → baza de date și RLS răspund.
4. Încarci un PDF în **Documente** și după câteva secunde statusul devine **Indexat** → `OPENAI_API_KEY` e validă.
5. În **Documente AI** alegi clientul și pui o întrebare despre document → primești răspuns cu citări.

Dacă pasul 4 rămâne pe „În așteptare" sau trece pe „Eșuat", problema e aproape sigur cheia OpenAI.

---

## 8. Se poate renunța complet la Supabase?

Pe scurt: **da, dar nu prin mutarea bazei „în cod"** — iar varianta cu Docker rezolvă deja problema reală.

Aplicația nu folosește Supabase doar ca bază de date, ci pentru patru lucruri:

| Ce face | Cum e folosit acum |
|---|---|
| Bază de date | PostgreSQL |
| Securitatea datelor | Row Level Security — izolarea între organizații e aplicată **în baza de date**, nu în cod |
| Autentificare | Supabase Auth (parole, confirmare email, sesiuni pe cookie) |
| Fișiere | Supabase Storage (bucket `crm-documents`) |
| Căutare AI | `pgvector` + indexul HNSW |

**De ce nu merge cu o bază „în cod" (SQLite):** SQLite nu are Row Level Security, nu are pgvector, nu are sistem de autentificare și nu are stocare de fișiere. Toată izolarea între organizații ar trebui rescrisă din baza de date în cod, plus un sistem de login de la zero, plus căutare vectorială în JavaScript. Practic e o rescriere a aplicației, cu un model de securitate mai slab.

**Soluția corectă, care dă exact ce vrei:** Supabase rulează local, în Docker, pe calculatorul fiecăruia. Persoana instalează Docker Desktop, rulează `npx supabase start` și are toată baza pe calculatorul ei — fără cont Supabase, fără proiect în cloud, fără nicio integrare de făcut. Codul rămâne neschimbat; se schimbă doar URL-ul și cheile din `.env.local`.

Singura condiție ca asta să funcționeze este ca schema completă să fie în `supabase/migrations/` — vezi limitarea din secțiunea 5.

---

## 9. Probleme frecvente

| Simptom | Cauză probabilă |
|---|---|
| `next: not found` | Nu ai rulat `npm install` |
| Login dă eroare de rețea | Proiectul Supabase e pe pauză, sau `NEXT_PUBLIC_SUPABASE_URL` e greșit |
| Panoul redirecționează la login în buclă | Cheia `anon` nu corespunde cu URL-ul proiectului |
| Documentele rămân „În așteptare" | `OPENAI_API_KEY` lipsește sau e invalidă |
| Chat-ul AI zice „Nu am găsit informația" | Documentele nu sunt încă indexate (status ≠ Indexat) |
| Portul 3000 e ocupat | `npm run dev -- -p 3001` |
