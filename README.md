# Notofire Import Control Tower

Internal application for managing imports for Notofire, ATC (Atlanta Telecables) and Valuecon —
from internal requirement through PO, payments, production, shipping, customs and delivery, to
landed cost and closure.

It is a **human-in-the-loop** system. It automates organisation, calculation and reminders; it
never makes a commercial decision. Throughout, it holds **Received** apart from **Verified**, and
**Calculated** apart from **Approved**.

## Setup

This app needs its **own** Supabase project — not the `notofire-tender` project shared by the
tender and bid apps. This one enables Row Level Security, which those two deliberately do not.

### Automated (one token, everything else scripted)

1. Generate a token at
   [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens).

2. Put it in `.env.local`:

   ```bash
   cp .env.local.example .env.local
   ```

   ```
   SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxxxxxxxxxx
   ```

3. Run it:

   ```bash
   npm run db:setup
   ```

   This creates the project in `ap-south-1`, waits for it to come up, retrieves the API keys,
   writes them into `.env.local`, applies the migrations, and configures auth. Safe to re-run — an
   existing project of the same name is adopted rather than duplicated.

### Manual, if you prefer

Create the project yourself, then fill in `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` from
Project Settings, and run `npm run db:apply`.

For `SUPABASE_DB_URL`, use the **Supavisor pooler in session mode**:

```
postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Two things that will waste your time otherwise. The direct host `db.<ref>.supabase.co` **does not
resolve** on current Supabase projects — it is no longer provisioned, whatever older docs say. And
port **5432 is session mode, 6543 is transaction mode**; transaction mode mishandles the
multi-statement DDL in these migrations, so use 5432. Note the username is `postgres.<ref>`, not
`postgres`.

### Access

Sign-in is **email and password**. Login does not send an email, so it does not use Supabase's
built-in mail quota. Signups stay disabled: an administrator creates each account, and the first
one is seeded from the environment.

```bash
# In .env.local — the password is never written into source.
INITIAL_ADMIN_EMAIL=admin@example.com
INITIAL_ADMIN_PASSWORD=choose-a-long-password

npm run auth:seed                         # create that admin (safe to re-run)
npm run auth:allow -- --list              # who can sign in
npm run auth:allow -- --revoke old@x.com  # remove an auth user
```

Re-running the seed does not create a duplicate. It sets the password when the account is first
prepared for password login, then leaves that password alone. `npm run auth:seed -- --reset-password`
replaces it from `INITIAL_ADMIN_PASSWORD`.

Further people are added under Settings by an admin, with an initial password. Forgot password
emails a one-time link that expires in 60 minutes. That email uses your SMTP settings
(`AUTH_SMTP_HOST`, `AUTH_SMTP_FROM`, and usually `AUTH_SMTP_PORT`, `AUTH_SMTP_USER`,
`AUTH_SMTP_PASSWORD`), not Supabase's mailer.

Two layers do the work, and they use different keys on purpose:

- **The gate** (`src/proxy.ts`, `src/lib/supabase/auth.ts`) reads the session with the *anon* key
  and blocks anything without one. It runs in middleware rather than a layout because Next still
  evaluates the page underneath a layout guard — and because Server Actions post to the route they
  live on, the same check gates every mutation, not just the UI.
- **The data** (`src/lib/supabase/server.ts`) is read with the *service-role* key, server-side only.
  RLS is on for every table with nothing granted to `anon`, so the public anon key that ships to the
  browser cannot touch application data through the REST API even though anyone can read it out of
  the page source.

`requireUser()` in the app layout is a second lock: if a route ever falls outside the middleware
matcher, it fails closed rather than open.

Work is attributed to a single **operator** profile, separate from whoever is signed in — migration
012 seeds one. `profiles` still carries roles, so per-user permissions are a migration on top rather
than a rebuild.

### Verifying

```bash
npm run db:verify
```

Checks the live project rather than the SQL: all 38 tables and 20 views present, **RLS enabled on
every table**, seed data in place, and the identifier and alert functions answering.

### Then

```bash
npm run dev
```

Open it and log in with the seeded email and password — see **Access** above.

### If every page says "Could not read from the database"

Almost always TLS, not credentials. Node ships its own list of certificate
authorities and **ignores the operating system trust store**. On a machine behind a
TLS-inspecting corporate proxy or antivirus, the intercepting root CA is installed in
the OS store only, so every outbound HTTPS call from the server fails with
`UNABLE_TO_VERIFY_LEAF_SIGNATURE` — while `curl` and other tools on the same machine
work fine, which makes it look like an app bug.

`npm run dev` and `npm start` already pass `--use-system-ca`, which tells Node to trust
the OS store. If you run Next some other way, set it yourself:

```bash
NODE_OPTIONS=--use-system-ca npx next dev
```

Never "fix" this with `NODE_TLS_REJECT_UNAUTHORIZED=0`. That disables certificate
verification for the whole process — including the calls carrying your service-role key.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server on :3000 |
| `npm run build` | Production build |
| `npm test` | Unit tests for the deterministic engines |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | ESLint |
| `npm run db:setup` | Create/adopt the Supabase project, apply migrations, configure auth |
| `npm run db:apply` | Apply pending SQL migrations |
| `npm run db:verify` | Check the live database matches what the migrations promise |
| `npm run auth:configure` | Set site URL, redirect allow list, and disable signups |
| `npm run auth:seed` | Create the initial admin from `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD` |
| `npm run auth:allow -- --list` | List auth users (`--revoke` removes one) |
| `npm run archive:scan` | Read the historical folder tree into reviewable CSVs |
| `npm run archive:load` | Load the reviewed CSVs as closed imports and documents |
| `npm run archive:drive` | Fill in each archived document's Google Drive link |

## Loading the historical archive

Three steps, each safe to re-run and each leaving a record of where every row came from.

```bash
npm run archive:scan
```

Walks the old folder tree into `archive-scan/imports.csv` and `archive-scan/documents.csv`. Open
`imports.csv` and set the `action` column: only rows saying exactly `import` are loaded. Rows marked
`REVIEW` are folders that either share a supplier and value with another folder — one order stored
twice — or carry no value in the name. Deciding which is the real order is a judgement about the
business, so the scan flags them rather than merging them. Re-scanning keeps decisions already made.

```bash
npm run archive:load -- --dry-run
npm run archive:load
```

Loads them as status **Closed**: these are finished orders being recorded for history, and marking
them active would fill the Action Centre with alerts about shipments that arrived months ago.

### Linking the files to Drive

The load records *where* each document came from but leaves its link empty, because at that point
the files exist only on the laptop. Once the archive is uploaded to Drive:

1. Run `scripts/drive-manifest.gs` in your own Google account — the steps are at the top of that
   file. It lists every uploaded file with its Drive id and writes `drive-manifest.csv`.
2. Save that CSV as `archive-scan/drive-manifest.csv`.
3. ```bash
   npm run archive:drive -- --dry-run
   npm run archive:drive
   ```

The app holds no Drive credentials and needs none — the listing is produced inside your account and
arrives here as a plain CSV. Matching is on the **full archive path**, never the file name: dozens
of imports each contain a `PROFORMA INVOICE.pdf`, and a name match would scatter the wrong links
across the archive. Whether you uploaded the three `Import - …` folders directly or nested them
inside a parent is worked out from the manifest, so neither needs configuring.

Documents already carrying a link are left alone unless you pass `--force`. Anything the manifest
does not cover — a file left behind, two Drive files sharing one path — is reported and skipped
rather than guessed at.

Check the **"Not in Drive"** count before assuming an upload finished. Drive silently skips files
whose names are very long, so a folder can arrive looking complete with one document missing; the
first run of this backfill hit exactly that, on a 180-character filename. Those documents keep their
row and their history and simply have no link until the file is uploaded and the backfill re-run.

## WhatsApp intake

Operational updates arrive as WhatsApp messages. Forward the important ones to a dedicated chat and
they are captured, matched to an import, and left for you in **Inbox**.

The pipeline is deliberately one-directional and stops short of your records:

```
Meta Cloud API → /api/whatsapp → communications → matcher → Inbox → you link it → timeline
```

**Nothing a supplier says writes to an import.** The matcher's answer is a proposal carrying its
reasons — matched on PO number, air waybill, container, bill of entry — and an import is linked only
when you press the button. A message it cannot place stays unmatched rather than being filed
somewhere plausible: a wrong confident match is worse than none, because you have no reason to doubt
it.

Sender recognition works off the only four phone numbers the schema holds — supplier contacts, their
WhatsApp number, CHAs and overseas agents. A bank, customs office or transporter has no phone on
record anywhere, so those read as **Unknown**. That is honest rather than broken, and the role is
never inferred from the words.

### Setting it up

Optional — the Inbox works without any of this, using **Add a message** to paste one in by hand.

1. Create a Meta Business account and a WhatsApp Business app. The number you register **cannot
   already be on consumer WhatsApp**, so a spare number is needed.
2. Put `WHATSAPP_APP_SECRET` and a `WHATSAPP_VERIFY_TOKEN` you invent into `.env.local`.
3. Point Meta's webhook at `https://your-app/api/whatsapp` and subscribe to `messages`.

The endpoint verifies Meta's `X-Hub-Signature-256` over the raw request body before touching the
database, and refuses everything when no secret is set — an unauthenticated write endpoint is worse
than a broken one. Redelivery is safe: a unique index on the provider message id means a repeated
webhook conflicts instead of duplicating.

### Attachments

Recorded, dated and counted down — not filed. The app holds no Drive credentials by design, so an
attachment shows its name, type and the date WhatsApp will delete it (about 30 days), and you save
it to Drive yourself. Automatic filing would need OAuth this app deliberately does not carry.

### Reading messages

There are no cron jobs anywhere in this system, so interpretation runs immediately after the webhook
has answered. If that is cut short, the message is still safely stored and the Inbox shows
**Parse N unread** — the retry is a person looking, exactly like the alert engine.

## Architecture notes

**Zero recurring cost.** No AI inference, no paid services, files stay in Google Drive rather than
paid storage. The alert engine is a **SQL view evaluated at read time** — there are no cron jobs,
which both avoids Vercel Hobby's 2-job / once-daily limit and means the dashboard is accurate the
instant it loads. The one open question is Vercel's Hobby tier being licensed for non-commercial
use; nothing here depends on Vercel specifically.

**Identifiers are permanent.** Every import gets `IMP-YYYY-NNNN`, allocated atomically. This exists
because the current folder tree names imports by value and has already produced collisions —
`TC FIRE USD $102000.00` and `TC FIRE USD 102,000.00` are two folders for one order.

**One import = one commercial order.** Lots and partial dispatches are shipments beneath it, so
Thermocable's three lots are one import with three shipments.

**Nothing is hardcoded that the business might change.** Companies are rows, not constants. Every
threshold the alert engine uses lives in `app_settings` and is editable in Settings — including the
IDPMS closure window, which defaults to 90 days but should be confirmed with the bank.

**Status is set by a human, not derived.** Real imports skip stages freely — a courier import has
no PO, no production and no freight arrangement — so any transition is permitted and logged rather
than blocked.

**The audit log is written by a database trigger**, not application code, so no code path can
change a tracked row without leaving a record. It is select-only through the API.

## Layout

```
src/app/(app)/       the application (sidebar layout)
src/proxy.ts         request guard — only checks that Supabase is configured
src/lib/supabase/    server (service role, request paths) · admin (scripts)
src/lib/             deterministic engines — fy, po-number, settings
supabase/migrations/ numbered SQL, applied in order
scripts/             setup, auth and archive tooling — see Commands
archive-scan/        the historical tree as reviewable CSVs, plus the Drive manifest
```

## Build status

**All twelve phases are built.**

| Phase | What it gives you |
|---|---|
| 1 Foundation | Auth, roles, companies, configuration, audit triggers, identifier sequences |
| 2 Control tower | Imports, dashboard with Action Centre, Next Action, timeline, audit trail |
| 3 Masters | Suppliers, contacts, bank details with supersede history, CHAs and overseas agents |
| 4 Payments | Schedule calculation, approval, paid confirmation, refunds, IDPMS closure |
| 5 Production | Goods-ready dates kept apart — promised, revised, actual — plus dated supplier updates and PI lines |
| 6 Shipments | Lots beneath one order, per-mode fields, ETA revisions, the in-transit board |
| 7 Documents | Document types, versioning, per-mode checklists, Drive links, Verification Centre |
| 8 Customs & delivery | Bill of Entry and duty verified separately, customs queries, delivery and discrepancies |
| 9 Tasks | Per-import and standalone, with comments and due-date alerts |
| 10 Email templates | Deterministic `{{placeholder}}` substitution, prepared for review — never sent |
| 11 Landed cost & closure | Cost lines with human-entered FX, roll-up, approval, close and reopen |
| 12 Reports | Portfolio, payment exposure, supplier and shipping performance, duty, document compliance |

Thirty-eight tables, twenty views, RLS on every one.

## Testing

```bash
npm test
```

133 tests. The schema ones matter most: `src/lib/schema.test.ts` runs the **real migration files**
against an in-process Postgres (PGlite), so a broken view or constraint fails locally instead of on
first contact with the live database. It has already caught three bugs that would each have failed
the first `db:setup`:

- the audit trigger reading `NEW.id` on `app_settings`, which is keyed by `key` and has no `id`
- `create or replace view` refusing to absorb a new column into a view that selects `imports.*`
- `supersede_bank_account` inserting the new row before retiring the old one, violating the
  one-current-account index

The rest cover the arithmetic and the rules that cost money when they are wrong: a payment schedule
always sums to the invoice (the last instalment absorbs the rounding), INR is never derived without
a human-entered rate — in the landed cost a line with no rate contributes *nothing* rather than
being converted at a guess — the Bill of Entry and the duty are verified separately, a revised ETA
supersedes the original without erasing it, and financial-year and PO number rendering reproduce
the real formats from the archive.
#   I m p o r t _ A p p  
 