# Ghid de instalare — Nimbus CRM

Ghid complet pentru a rula aplicația pe un calculator nou.

Există două trasee. **Traseul A** (recomandat) rulează întreaga bază de date local, cu Docker — fără cont Supabase, fără proiect în cloud, fără nicio integrare de făcut. **Traseul B** se conectează la proiectul Supabase existent din cloud.

> Înainte de orice: citește [`supabase/SCHEMA-GAPS.md`](supabase/SCHEMA-GAPS.md). Schema bazei de date nu corespunde complet cu codul aplicației, iar unele funcționalități (onboarding-ul și toată secțiunea de administrare) nu funcționează încă. Aplicația pornește și se poate naviga prin ea, dar nu e completă.

---

## 1. Ce trebuie instalat

| Program | Versiune | De unde | Necesar pentru |
|---|---|---|---|
| **Node.js** | 20+ (testat pe 22) | <https://nodejs.org> — varianta LTS | ambele trasee |
| **Git** | recentă | <https://git-scm.com/downloads> | ambele trasee |
| **Docker Desktop** | recentă | <https://docker.com/products/docker-desktop> | doar traseul A |
| **Visual Studio Code** | opțional | <https://code.visualstudio.com> | editor |

Verifică:

```bash
node --version
```

---

## 2. Descarcă proiectul

```bash
git clone https://github.com/Patr1ck440/CRM-AI.git
```

```bash
cd CRM-AI
```

---

## 3. Instalează dependențele

```bash
npm install
```

Durează 1–3 minute. Folosește `npm`, nu `pnpm` — în repo există ambele lockfile-uri, dar `package-lock.json` e cel actual.

---

## 4. Traseul A — baza de date local, cu Docker (recomandat)

Pornește Docker Desktop și așteaptă să scrie „Engine running". Apoi:

```bash
npx supabase start
```

Prima rulare descarcă vreo 2–3 GB de imagini și durează 5–15 minute. Următoarele pornesc în sub un minut.

Comanda pornește local PostgreSQL, Auth, Storage și pgvector, și aplică singură migrațiile din `supabase/migrations/`, construind toată schema. La final afișează un bloc cu adrese și chei.

Ia din acel bloc trei valori și pune-le în `.env.local` (vezi secțiunea 6):

| Din output | În `.env.local` |
|---|---|
| `API_URL` (`http://127.0.0.1:54321`) | `NEXT_PUBLIC_SUPABASE_URL` |
| `ANON_KEY` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `SERVICE_ROLE_KEY` | `SUPABASE_SERVICE_ROLE_KEY` |

Dacă ai închis terminalul, le reafișezi oricând cu:

```bash
npx supabase status
```

Adrese utile cât timp rulează:

- **<http://127.0.0.1:54323>** — Supabase Studio: interfață grafică peste baza locală, unde vezi tabelele și datele.
- **<http://127.0.0.1:54324>** — Mailpit: aici ajung emailurile de confirmare a contului. Local nu se trimite niciun email real, deci te poți înregistra cu orice adresă inventată și apeși linkul de confirmare de aici.

Ca să oprești totul:

```bash
npx supabase stop
```

Datele rămân salvate între porniri. Pentru a șterge tot și a reconstrui baza de la zero:

```bash
npx supabase db reset
```

---

## 5. Traseul B — proiectul Supabase din cloud

Doar dacă vrei să lucrezi pe datele reale, comune cu ceilalți.

1. Cere-i proprietarului acces la organizația Supabase.
2. Intră pe <https://supabase.com/dashboard> și alege proiectul.
3. **Project Settings → API**, de unde copiezi `Project URL`, cheia `anon` și cheia `service_role` în cele trei variabile din secțiunea 6.

**Atenție:** pe planul gratuit, Supabase pune proiectul pe pauză după inactivitate. Dacă aplicația pornește dar login-ul și toate listele dau eroare, verifică în dashboard dacă proiectul e `ACTIVE` și apasă *Restore*.

---

## 6. Fișierul `.env.local`

Creează în rădăcina proiectului un fișier numit exact **`.env.local`**. E în `.gitignore`, deci nu ajunge niciodată pe GitHub.

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<din npx supabase status>
SUPABASE_SERVICE_ROLE_KEY=<din npx supabase status>
OPENAI_API_KEY=sk-proj-<cheia ta>
INGEST_HMAC_SECRET=orice-sir-aleator
```

- **`OPENAI_API_KEY`** — din <https://platform.openai.com/api-keys>. Contul are nevoie de credit activ. Se folosește pentru indexarea documentelor și pentru răspunsurile chat-ului AI. Fără ea restul aplicației merge, dar tot ce ține de AI dă eroare.
- **`INGEST_HMAC_SECRET`** — orice șir aleator; nu mai e folosit activ, se păstrează pentru compatibilitate.

> Cheia `service_role` ocolește complet regulile de securitate RLS și se folosește doar pe server. Nu o pune niciodată într-o variabilă care începe cu `NEXT_PUBLIC_`, pentru că acelea ajung în browser.

---

## 7. Pornește aplicația

```bash
npm run dev
```

Deschide <http://localhost:3000>.

Pentru varianta de producție:

```bash
npm run build
```

```bash
npm start
```

---

## 8. Verificare că totul merge

1. Pagina de start se încarcă la `localhost:3000` → Node și dependențele sunt bune.
2. Te înregistrezi prin **„Creați-vă organizația"**, apoi confirmi emailul (local: din Mailpit, <http://127.0.0.1:54324>).
3. Te autentifici → cheile Supabase sunt corecte.
4. Încarci un PDF în **Documente**; după câteva secunde statusul devine **Indexat** → cheia OpenAI e validă.
5. În **Documente AI** alegi clientul și pui o întrebare → primești răspuns cu citări.

**Pasul 2 se va bloca la ecranul de configurare a organizației.** Nu e o greșeală de instalare: funcția `bootstrap_tenant` nu există în bază. Vezi [`supabase/SCHEMA-GAPS.md`](supabase/SCHEMA-GAPS.md), secțiunea 2.

Dacă pasul 4 rămâne pe „În așteptare" sau trece pe „Eșuat", problema e aproape sigur cheia OpenAI.

---

## 9. Se poate renunța complet la Supabase, cu baza „direct în cod"?

Pe scurt: **nu are sens, iar traseul A rezolvă deja problema reală.**

Aplicația nu folosește Supabase doar ca bază de date, ci pentru cinci lucruri simultan:

| Ce | Cum e folosit |
|---|---|
| Bază de date | PostgreSQL |
| Izolarea între organizații | Row Level Security — regulile sunt **în baza de date**, nu în cod |
| Autentificare | Supabase Auth (parole, confirmare email, sesiuni pe cookie) |
| Fișiere | Supabase Storage, bucket `crm-documents` |
| Căutare AI | `pgvector` + index HNSW |

O bază „în cod" (SQLite) nu are niciuna dintre ultimele patru: nu are Row Level Security, nu are pgvector, nu are sistem de autentificare și nu stochează fișiere. Toată izolarea între organizații ar trebui mutată din baza de date în cod, plus un sistem de login scris de la zero, plus căutare vectorială în JavaScript. E o rescriere a aplicației, cu un model de securitate mai slab.

Traseul A dă exact rezultatul dorit — toată baza pe calculatorul fiecăruia, o singură comandă, fără cont și fără cloud — păstrând PostgreSQL, RLS, Auth, Storage și pgvector așa cum sunt.

---

## 10. Probleme frecvente

| Simptom | Cauză probabilă |
|---|---|
| `next: not found` | Nu ai rulat `npm install` |
| `supabase start` dă eroare de Docker | Docker Desktop nu rulează |
| `Cannot find project ref` | Rulează `npx supabase init` întâi |
| Login dă eroare de rețea | Stiva locală e oprită, sau proiectul din cloud e pe pauză |
| Panoul redirecționează la login în buclă | Cheia `anon` nu corespunde cu URL-ul din `NEXT_PUBLIC_SUPABASE_URL` |
| Blocat la ecranul de configurare a organizației | Lipsește `bootstrap_tenant` — vezi `supabase/SCHEMA-GAPS.md` |
| Documentele rămân „În așteptare" | `OPENAI_API_KEY` lipsește sau e invalidă |
| Chat-ul AI zice „Nu am găsit informația" | Documentele nu sunt încă indexate |
| Portul 3000 e ocupat | `npm run dev -- -p 3001` |
