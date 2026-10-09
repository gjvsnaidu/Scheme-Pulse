# SchemePulse

Discover the support you deserve. SchemePulse turns a plain-language description of someone's situation into a ranked, explained list of government schemes they may qualify for.

The catalog starts with a small set of curated entries from public myScheme and Ministry of MSME pages, each linked to its source. No synthetic demo schemes are loaded by default. Records whose full eligibility rules are not expressible in the app remain `Need info`, never a positive eligibility decision.

## What is in the box

| Layer | Implementation |
|---|---|
| Frontend | React 18 + TypeScript + Vite, plain CSS with light and dark themes, reduced-motion support |
| API | Node 22, Express, TypeScript, zod validation |
| Database | PostgreSQL (`pg`) with append-only SQL migrations. With no `DATABASE_URL` it runs on embedded Postgres (PGlite), so `npm run dev` needs no setup |
| Eligibility | Deterministic rule engine. Rules live in the database (`eligibility_rules`), never in code, and no language model can override them |
| Ranking | Six scored components (eligibility, need, location, benefit, deadline, preference) with admin-configurable weights, stored per component so every score is explainable |
| AI layer | `AiProvider` interface. Default `rules` provider is deterministic. `anthropic` provider (optional) extracts profiles and rephrases grounded answers; output is validated and falls back to rules on any failure |
| Search | Postgres full-text search (`websearch_to_tsquery`, ranked) over name, summary, department, category and goal |
| Auth | bcrypt, 15-minute JWT access token, rotating one-time refresh token in an httpOnly cookie, RBAC (`user`, `admin`) |
| Documents | MIME + magic-byte validation, 5 MB limit, local disk or S3-compatible storage. Status is only `self_declared` or `uploaded`, never "verified" |
| Notifications | Idempotent deadline job (hourly in-process, or `POST /api/admin/jobs/deadlines`), in-app plus optional SMTP email |
| Admin | Scheme create/edit with version history, review workflow, ingestion with duplicate detection (always lands as draft), analytics, weights, audit log |
| Official sync | Scheduled, allowlisted JSON feed pipeline with stable source IDs, change hashes, run history and review-gated updates |
| Privacy | Data export (JSON) and full account deletion |
| Ops | Dockerfile (multi-stage, non-root, healthcheck), docker-compose with Postgres, Render blueprint, GitHub Actions CI |

```
Browser (React SPA)
   │  /api/*  (JWT bearer + httpOnly refresh cookie)
Express  ── routes ──► services ──► engine (pure: eligibility, scoring, parser)
   │                      │
   │                      └─► ai/ (provider interface, grounded assistant)
   ├─► Postgres (pg)  or embedded PGlite
   ├─► storage (local | S3)      ├─► mailer (SMTP | log)
```

## Run it

**Zero setup (embedded database):**
```bash
npm run install:all
cp .env.example server/.env   # optional; defaults work
npm run dev:server            # API on :4000
npm run dev:web               # UI on :5173 (proxies /api)
```
Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` to get an admin account on startup.

No portal feed is configured by default. To connect a documented government JSON API/export, set `OFFICIAL_SCHEME_FEEDS` in `server/.env` to a JSON array of sources. Each endpoint must use HTTPS on a `gov.in` or `nic.in` host; an optional `token` is sent as a bearer token. Feed records must be normalized to this contract:
```json
{"items":[{"externalId":"stable-source-id","updatedAt":"2026-10-08T00:00:00Z","sourceUrl":"https://department.gov.in/scheme","scheme":{"slug":"department-scheme","name":"Scheme name","department":"Department","category":"Education","benefitText":"Benefit details","rules":[{"field":"age","op":"gte","value":18,"label":"Age"}],"documents":[]}}]}
```
The complete `scheme` object must satisfy the scheme validation schema. Sync runs once at startup and every `OFFICIAL_SCHEME_SYNC_MINUTES` (default 60); an admin can also run or inspect feeds in **Admin → Sources**. New records are drafts. Changes to published records return to review. Missing records are not automatically archived because feeds may be partial. A source-specific adapter is required when a portal's documented response does not match this normalized format.

For public portals without a machine-readable feed, the app also includes a lightweight importer that can pull HTML listings into draft records with a source URL and manual verification rule. Use it for public myScheme and IPPB listings when you have a reliable page or export URL:
```bash
npm --prefix server run import:portals -- myscheme
npm --prefix server run import:portals -- ippb
```
The importer respects the app’s trust model: imported records are drafted and marked for department confirmation before they can be treated as verified or eligible.

**Docker with Postgres:**
```bash
cp .env.example .env   # set POSTGRES_PASSWORD, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
   docker compose up --build
# open http://localhost:4000
```

**Single process, no Docker:** `npm run build && npm start` serves the API and the built SPA together.

**Hosting:** the Dockerfile runs anywhere that runs containers. `render.yaml` is a ready blueprint (web service + managed Postgres). Behind HTTPS set `COOKIE_SECURE=true` and `CORS_ORIGIN` to your public URL. For uploads on platforms without persistent disks, set `STORAGE_DRIVER=s3` and `npm i @aws-sdk/client-s3` in `server/`.

## Tests and checks
```bash
npm test            # 30 tests: engine, scoring, parser, and the full API against real Postgres semantics
npm run typecheck   # server and web, strict mode
```

## API (all under `/api`)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me` |
| Profile | `POST /profiles/parse` (public, saves nothing), `GET/PUT/PATCH /profiles/me` |
| Schemes | `GET /schemes?q=&category=&page=&pageSize=`, `POST /schemes/search`, `GET /schemes/:slug`, `GET /categories`, `GET /compare?ids=a,b` |
| Recommendations | `POST /recommendations` (guest with `{profile}` or signed in), `GET /recommendations` |
| Eligibility | `POST /eligibility/check`, `POST /eligibility/simulate` (never modifies the profile) |
| Assistant | `POST /ai/chat` returns text, intent, provider and the scheme cards it refers to |
| Library | `GET/POST /saved-schemes`, `DELETE /saved-schemes/:id`, `GET/POST /applications`, `GET/PATCH /applications/:id` |
| Documents | `GET /documents`, `POST /documents/declare`, `POST /documents/upload`, `GET /documents/:id/file`, `DELETE /documents/:id` |
| Alerts | `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` |
| Privacy | `GET /privacy/export`, `DELETE /privacy/account` |
| Admin | `GET/POST /admin/schemes`, `PUT /admin/schemes/:id`, `GET /admin/schemes/:id/versions`, `POST /admin/schemes/:id/review`, `POST /admin/ingest`, `GET /admin/sources`, `POST /admin/sources/sync`, `GET /admin/analytics`, `GET/PUT /admin/weights`, `GET /admin/audit`, `GET /admin/users`, `POST /admin/jobs/deadlines` |
| Ops | `GET /health` |

Errors are always `{ "error": { "code", "message", "details?" } }` with plain-language messages.

### Eligibility rule format
A scheme's rules are rows like `{ "field": "income", "op": "lte", "value": 300000, "label": "Family income" }`. Fields: `age`, `income`, `state`, `occupation`, `gender`, `category`. Operators: `between`, `lte`, `gte`, `in`, `eq`. Missing profile data yields `unknown` (shown as "Need info"), never a guess. A passed deadline makes a scheme not eligible. Add a scheme or a rule without changing code.

## Safety and trust behaviours
- AI-extracted details are always shown for confirmation and are saved only if the user chooses.
- The assistant answers from stored records and rule results. The optional LLM only rephrases supplied facts, and scheme cards come from the database, not from model output.
- Signed-in users can rate recommendations. A regularized per-user logistic ranker uses those ratings and the six saved score components to tune future ordering after it has both positive and negative examples; it never changes eligibility rules. Feedback is included in data export and removed with the account.
- A scheme can be marked **verified** only if it has an official source URL. Editing a published scheme sends it back to review.
- Application tracking is labelled as the user's personal record. There is no integration with any application authority and no fake status.
- Unknown deadlines and sources are shown as unknown; no URLs are invented.

## Verified in the build environment
Server typecheck, web typecheck, 35 passing tests, both production builds, and a single-process production run exercised over HTTP (static SPA, SPA fallback, login, admin analytics, search).

## Not verified here (please test before relying on it)
Docker image build and compose with a real Postgres server (the `pg` code path), the Render blueprint, the S3 driver, SMTP delivery, the Anthropic provider, and the UI in a real browser (including mobile layout and a screen-reader pass). The sandbox had no Docker, browser or live external services.

## Deliberate differences from the original brief
- **Express + raw SQL migrations** instead of NestJS + Prisma, and **Vite + React** instead of Next.js: smaller surface that could be built and tested end to end. Module boundaries (`routes/`, `services/`, `engine/`, `ai/`) map to the requested modules.
- **Plain CSS** instead of Tailwind, shadcn/ui and Framer Motion.
- **No Redis/BullMQ**: the deadline job is in-process and idempotent; add a queue when you scale to many workers.
- **No pgvector**: search is Postgres full-text. The `AiProvider` interface is where embeddings would plug in.

## Not implemented
OCR and document-content extraction, voice input and speech output, multilingual UI (8 languages), command palette, push/SMS notifications, a visual admin form for rules (the editor is JSON), source-specific portal adapters, end-to-end browser tests, and accessibility certification. An official feed endpoint and any required credentials/resource IDs must be supplied by the operator before automatic source sync can run. CSRF relies on `SameSite=Lax`, bearer-token auth for state-changing calls, and a restricted CORS origin.
