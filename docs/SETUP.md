# Setting up Recall

Follow this once. After it, everything is `pnpm dev`.

Steps A and B can be done in parallel — the Rust install is slow and mostly
unattended, so start it first and do the Supabase setup while it runs.

---

## 0. Try it before setting anything up

The whole interface runs against an in-memory server with no account and no
configuration, so you can see what you are setting up before you set it up:

```bash
pnpm install
```

```bash
pnpm dev:demo
```

Open <http://localhost:5173>. Capture, edit, complete, reorder, delete and undo
all work; nothing leaves your machine and nothing is kept when you stop it.

---

## A. Rust toolchain — needed for the Windows app and widget

Only the desktop app needs this. The web app and the Chrome extension work
without it.

```bash
winget install --id Rustlang.Rustup -e
```

```bash
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

That second one is 3–6 GB and takes 20–40 minutes. Then **open a new terminal**
and check:

```bash
rustc --version
```

WebView2 is already installed on your machine (version 152), so there is
nothing else to add.

---

## B. Supabase project

### B1. Create it

1. Go to <https://supabase.com> and sign in.
2. **New project**. Name it `recall`, pick the region closest to you.
3. Generate a database password and save it in your password manager. You will
   not need it for day-to-day use, but you cannot recover it later.
4. Wait for provisioning to finish (a minute or two).

### B2. Create the table

1. Open **SQL Editor** → **New query**.
2. Paste the entire contents of [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql).
3. Run it. You should see `Success. No rows returned`.
4. New query again, paste [`supabase/migrations/0002_position_collation.sql`](../supabase/migrations/0002_position_collation.sql), run it.

Together these create the `tasks` table, the row-level security policies, the
`push_tasks` merge function, the ordering collation, and realtime.

Run the migrations in order, and run both. Both are idempotent, so re-running
either is harmless.

### B3. Collect the two values

**Project Settings → API**, and copy:

| Field | Where it goes |
| --- | --- |
| **Project URL** | `VITE_SUPABASE_URL` |
| **anon / public** key | `VITE_SUPABASE_ANON_KEY` |

Both of these are designed to ship inside client applications — they authorise
nothing on their own, and the row-level security policies from B2 are what
actually protect your data.

> **Never put the `service_role` key in this project.** It bypasses row-level
> security entirely. It is not needed anywhere in Recall.

---

## C. Google sign-in

### C1. Create the OAuth client

1. <https://console.cloud.google.com> → create a project (any name).
2. **APIs & Services → OAuth consent screen** → **External** → fill in the app
   name and your own email → add **your own email address as a test user**.
   You do not need to publish or verify the app; a test user can sign in
   indefinitely.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
4. Application type: **Web application**.
5. Under **Authorised redirect URIs**, add exactly one entry — your Supabase
   callback, with your own project ref substituted:

   ```
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```

6. Create it, and keep the **Client ID** and **Client secret** on screen.

### C2. Give them to Supabase

**Supabase → Authentication → Sign In / Providers → Google**: enable it, paste
the Client ID and Client secret, save.

### C3. Set the site URL and allow the redirect URLs

Both live under **Supabase → Authentication → URL Configuration**, and the
first one is easy to skip.

**Site URL** is the address Supabase falls back to when a client asks to be
sent somewhere that is *not* on the redirect list. It does not warn — sign-in
appears to work and then lands on the wrong host, carrying a `?code=` that the
receiving origin cannot exchange. While you are only running locally, set it to
`http://localhost:5173`; once the app is deployed (step F), change it to the
deployed URL, with no trailing slash and no wildcard.

**Redirect URLs** is the allowlist. Add all of these:

```
http://localhost:5173/**
https://pjiekdodejbjdcplokfknpjigncnbinf.chromiumapp.org/*
http://localhost:47821/*
http://localhost:47822/*
http://localhost:47823/*
```

What each one is for:

- **5173** — the web app in development.
- **chromiumapp.org** — the Chrome extension. That subdomain is derived from
  the extension's ID, which is pinned by the `key` field in its manifest so it
  never changes. (If you ever regenerate it with `pnpm --filter @recall/extension key`,
  the new URL is printed and written to `apps/extension/extension-id.txt`.)
- **47821–47823** — the Windows app. It listens on a loopback port to catch the
  sign-in redirect; three ports so a busy one is not a dead end.

Add your Vercel URL here too once you have one (step F).

---

## D. Configure the apps

Three `.env` files, same two values in each:

```bash
cp apps/web/.env.example apps/web/.env
cp apps/desktop/.env.example apps/desktop/.env
cp apps/extension/.env.example apps/extension/.env
```

Edit each and fill in the Project URL and anon key from step B3. All `.env`
files are git-ignored.

---

## E. Run it

**Web app**

```bash
pnpm dev:web
```

**Windows app and widget** (needs step A)

```bash
pnpm dev:desktop
```

The first Rust build takes several minutes; later ones are seconds. Three
windows appear: the main window, the widget, and a hidden capture bar on
`Ctrl+Alt+Space`.

**Chrome extension**

```bash
pnpm build:extension
```

Then in Chrome: `chrome://extensions` → turn on **Developer mode** → **Load
unpacked** → select `apps/extension/dist`.

---

## F. Deploy the web app (optional, but this is what puts it on your phone)

1. Push the repository to GitHub.
2. <https://vercel.com> → **Add New → Project** → import the repository.
3. Leave Build Command, Output Directory and Install Command empty, and set
   Root Directory to either the repository root or `apps/web`. Both work:
   Vercel reads `vercel.json` from inside the Root Directory, not from the
   repository root, so there is one at [each](../vercel.json)
   [location](../apps/web/vercel.json), with paths relative to itself. A test
   keeps their routing identical and asserts both point at the same build
   output.

   > Getting this wrong is quiet rather than loud. Vercel detects the Vite app,
   > proposes `apps/web` as the root, and if no config is visible there it
   > falls back to its framework preset — the build succeeds and only the very
   > last step fails, with *No Output Directory named "dist" found*.
5. Add two environment variables: `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_ANON_KEY`.
6. Deploy, then go back to **Supabase → Authentication → URL Configuration**
   and make *both* changes from step C3:
   - add `https://<your-app>.vercel.app/**` to **Redirect URLs**, and
     optionally `https://<your-app>-*.vercel.app/**` so preview deployments can
     sign in too;
   - change **Site URL** to `https://<your-app>.vercel.app`.

   Adding only the redirect URL is the more common half-fix. Leaving Site URL
   on localhost means anything Supabase declines to redirect quietly goes to a
   dev server instead of the deployed app.
7. On your phone, open the URL in Chrome → menu → **Add to Home screen**. It
   installs as an app and works offline.

---

## Building the Windows installer

```bash
pnpm build:desktop
```

The installer lands in
`apps/desktop/src-tauri/target/release/bundle/nsis/Recall_0.1.0_x64-setup.exe`
and is about **1.8 MB**. It installs for the current user only, so it needs no
administrator rights.

The first release build takes around nine minutes — the release profile uses
full LTO for a smaller binary. Later builds are much quicker. If you would
rather trade a little size for faster builds, change `lto = true` to
`lto = "thin"` in `apps/desktop/src-tauri/Cargo.toml`.

---

## Checking it worked

```bash
pnpm test
```

All offline — no account or network needed.

Then, once your `.env` files exist, check the project itself:

```bash
pnpm test:live
```

This uses only the anon key and never touches your tasks. It confirms the table
and the `push_tasks` function were created, that row-level security really is
refusing anonymous reads and writes, that the realtime channel connects, and
that Google sign-in is enabled. If the migration half-applied, this is what
tells you.
