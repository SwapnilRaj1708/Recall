# Architecture

## What this is optimising for

Recall is an external memory system, not a task manager. Two properties matter
more than every feature combined:

1. **Capture friction ≈ 0** — a thought becomes a stored task in under two
   seconds, from wherever you already are.
2. **Passive visual persistence** — captured tasks stay in peripheral vision
   without anyone deciding to look at them.

Every decision below is downstream of those two, plus a third constraint that
follows from them: because this is standing in for someone's memory, **losing a
task is the worst thing the system can do**. A slow sync is an annoyance; a
dropped capture is a failure of the entire premise.

## Shape

```
                    ┌──────────────── Supabase ────────────────┐
                    │  Postgres · tasks table + RLS            │
                    │  Realtime · postgres_changes over WS     │
                    │  Auth · Google OAuth (PKCE)              │
                    └──────────────────────────────────────────┘
                         ▲                          │
              push_tasks() RPC          realtime push + delta pull
                         │                          ▼
        ┌────────────────────────────────────────────────────────┐
        │  @recall/core                                          │
        │  SyncEngine · Outbox · per-field LWW merge              │
        │  StorageAdapter (IndexedDB · chrome.storage · memory)   │
        └────────────────────────────────────────────────────────┘
                         │
        ┌────────────────┴────────────────┐
        │  @recall/ui      @recall/app    │   design tokens + shared React
        └────────────────┬────────────────┘
                         │
     ┌───────────────────┼────────────────────┐
     │                   │                    │
  apps/web          apps/desktop          apps/extension
  Vite PWA          Tauri v2              Chrome MV3
  → Vercel          main · widget         popup · omnibox
  → phone           · quick capture       · context menu
                    · tray · hotkey       · badge
```

The three applications are **shells**. They own window management, OS
integration and sign-in mechanics; they own no task logic at all. The list you
see in the widget is rendered by the same React components as the list in the
browser extension.

## Technology choices

| Decision | Why | What was rejected |
| --- | --- | --- |
| **Supabase** | Real Postgres, so the data outlives the product decisions made around it. Row-level security means clients only ever hold the anon key. Realtime gives push sync rather than polling. Free tier is far beyond one person's needs. | Firebase — Firestore's data model is harder to unwind later, and its offline layer does not behave the same in a Tauri WebView and an MV3 service worker. |
| **Tauri v2** | An 8 MB installer instead of ~150 MB, no bundled runtime, and it uses the WebView2 that Windows already ships. Real window transparency, always-on-top, tray and global shortcuts all work. See the memory note below: the RAM advantage is smaller than it is usually claimed to be. | Electron — the same Chromium cost at runtime, plus a second copy of it and a Node runtime on disk. |
| **Local-first with an outbox** | Directly implements "a network blip must never lose a task". Also makes every interaction instant, because nothing waits on a round trip. | Request/response — every capture becomes a spinner and an opportunity to lose data. |
| **Per-field last-write-wins** | Two devices touching different fields of one task while one is offline both keep their change. | Row-level LWW — silently discards one of them. |
| **Fractional indexing** | A reorder rewrites one field on one row, so concurrent reorders merge instead of fighting. | Integer positions — one drag becomes dozens of conflicting writes. |
| **Google OAuth only** | One provider, no passwords to store, no email deliverability to depend on. Sign in once per surface; the refresh token does the rest. | Email magic links — Supabase's built-in mailer is rate-limited to a few per hour, which turns "set up four devices" into an afternoon. |
| **Plain CSS custom properties** | The whole visual system is one token file, so "taller rows, less transparency, different accent" is a three-line change across four applications. | A utility framework — more build configuration per shell, and the tokens end up scattered anyway. |
| **No CRDT library** | One user, one list, per-field LWW. It converges. | Automerge / Yjs — real complexity, real bundle size, no benefit at this scale. |

### What the desktop app actually costs

Measured on Windows 11, release build, widget plus the hidden capture bar:

| | |
| --- | --- |
| Installer | **1.8 MB** |
| `recall.exe` | 4.0 MB |
| Memory, whole process tree | **~450 MB** |

The memory number deserves an honest explanation, because the usual claim
about Tauri is misleading. It breaks down as roughly 320 MB of fixed WebView2
overhead — the browser process, the GPU process, two utility processes, the
crash handler — plus about 65 MB per open window.

**That fixed cost is Chromium, and Tauri does not avoid it.** Tauri's real
advantages here are on disk and at install time: a 1.8 MB installer instead of
~150 MB, no second copy of Chromium, no bundled Node runtime, and it uses the
WebView2 that Windows already ships and already updates. At runtime, an
Electron build of this same app would land in the same region, somewhat higher
for the extra runtime.

Two things were done about it, and one deliberately was not:

- **The main window is created on first open, not at startup**, and destroyed
  on close. That is 85 MB saved for a window opened occasionally and on
  purpose. The widget and the capture bar stay resident because both have to
  respond instantly.
- **`--disable-gpu` saves about 55 MB** and is not enabled, because the
  widget's translucency leans on GPU compositing and a slower, worse-looking
  widget is a bad trade for 12%. It is a one-line change in
  `tauri.conf.json` if that trade ever looks right.
- Getting materially below this would mean not rendering HTML at all — a
  native Win32 or WinUI widget. That is a different project, and it would give
  up sharing every line of interface code with the web app and the extension,
  which is most of what makes this one maintainable.

## Data model

One table. The full definition is in
[`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql).

```
id                    uuid       client-generated, so a task has identity offline
user_id               uuid       stamped server-side from auth.uid()
text                  text
completed             boolean
completed_at          timestamptz
position              text       fractional index; lexicographic order is list order
deleted_at            timestamptz  tombstone — non-null means deleted
created_at            timestamptz

text_updated_at       timestamptz  ┐
completed_updated_at  timestamptz  │ per-field logical clocks
position_updated_at   timestamptz  │
deleted_updated_at    timestamptz  ┘

updated_at            timestamptz  derived: greatest of the four. display only
server_updated_at     timestamptz  server-assigned sync cursor
```

Three things here are load-bearing:

**Client-generated ids.** A task must exist and be referable the instant it is
typed, with no network. The server never assigns identity.

**Tombstones, not deletes.** A hard delete cannot replicate — other devices
would simply never hear about it — and cannot be undone. Tombstones are kept 30
days, which also gives a real undo long after the toast has gone.

**Per-field clocks.** The whole conflict story. See below.

## Synchronisation

### Writing

A mutation updates the in-memory map and notifies React **before its first
`await`**, then persists to local storage, then appends to the outbox. The UI
never renders a frame without the change in it, and never waits on the network.

The outbox holds **one entry per task, containing the whole local version of
that task** rather than a diff. This is a small decision with three consequences:

- Twenty keystroke-level edits to one task collapse into one entry and one push.
- A retry after an ambiguous timeout is always safe, because re-sending the same
  version is idempotent under last-write-wins.
- Fields the user did not touch carry old clocks, so sending the whole row
  cannot clobber someone else's newer change to a different field.

The flusher pushes in batches with exponential backoff and jitter (1 s → 60 s).
A permanently rejected entry is **parked, not discarded**: it stays in the
outbox, surfaces in the UI, and stops blocking everything queued behind it.

### Merging

Every version of a task that arrives from anywhere — a delta pull, a realtime
event, a peer window, the response to our own push — goes through one function:
`mergeTask` in [`packages/core/src/model/merge.ts`](../packages/core/src/model/merge.ts).

For each field, the version with the strictly newer clock wins. On an exact tie,
the incumbent stays. The SQL function applies the identical rule.

Because every situation reduces to "here is another version of this row",
offline reconnection, duplicate delivery, out-of-order delivery and simultaneous
edits are all the same problem, solved once. That is why that function has the
heaviest test coverage in the project.

Convergence relies on one more thing: **`push_tasks` returns the winning version
of every row it was given.** A client that loses a comparison finds out on the
same round trip rather than sitting on a divergent value.

### Reading

- **Realtime** — a `postgres_changes` subscription filtered to `user_id`.
- **Delta pull** — `server_updated_at > cursor`, oldest first, paged. Runs at
  startup, on reconnect, when the network returns, and on a slow safety-net
  timer for when a channel dies without saying so.

The pull deliberately reaches back a few seconds behind the stored cursor. A
row's cursor value is stamped when it is written but only becomes visible when
its transaction commits, so a row written just before the cursor can appear just
after it was read. Overlapping closes that window and costs nothing, because
merges are idempotent.

### Between windows

The Tauri widget and main window share one IndexedDB database and a
`BroadcastChannel`. A capture in the widget is in the main window's list in the
same frame, with no server round trip. The extension gets this free from
`chrome.storage.onChanged`, which is a large part of why it uses
`chrome.storage` rather than IndexedDB.

Preferences travel the same way, over `localStorage` and its `storage` event,
and are deliberately split in two. Appearance — theme, accent, row height, text
size, transparency — is **one shared record** for the whole machine, so a change
in the desktop app reaches the widget without either window restarting. This is
not a nicety: the widget has no settings screen, so a theme stored per-surface
is a theme nobody can ever change, which is exactly the bug an earlier version
shipped. Host settings — always-on-top, autostart, the hotkey, whether completed
tasks are listed — stay per-surface, because they genuinely belong to one
window.

Surfaces still differ in how they *render* that shared record rather than by
storing their own copy of it: `widgetTheme` runs denser and translucent for the
two windows that float over the desktop, and `opaqueTheme` drops transparency
everywhere else, where there is nothing behind the surface but the app's own
background and translucency would only cost legibility.

## Authentication

Google OAuth with PKCE, everywhere. The three shells differ only in how the
consent screen is opened and the redirect caught:

| Surface | Mechanism | Why |
| --- | --- | --- |
| Web | Ordinary browser redirect | Nothing else is needed. |
| Extension | `chrome.identity.launchWebAuthFlow` | The extension ID is pinned by the manifest `key`, so its `chromiumapp.org` redirect URL is stable and can be allow-listed once. |
| Desktop | System browser + loopback listener on 127.0.0.1 | The user is already signed in to Google there. A custom `recall://` scheme would need installer-time registration and would behave differently in `tauri dev` than in a real install. |

Everything after the redirect is shared code. Sessions persist via refresh
token, so signing in is a once-per-surface event.

## Reliability

What happens when things go wrong, and why:

| Situation | Behaviour |
| --- | --- |
| No network | Everything works. Captures queue; the UI says "Offline" rather than pretending. |
| Backend down | Same as no network. Exponential backoff, no spinning. |
| Process killed mid-capture | The task is already in local storage and the outbox. Delivered on next launch. |
| Session expired | The list stays visible and editable with a "sign in to sync" banner. Blocking the UI here would hide tasks and strand the outbox. |
| Signing out with unsynced work | Refused, with a count and a "sync first" prompt. Sign-out clears the local cache, so it must not run over a non-empty queue. |
| Local storage unavailable | Falls back to in-memory and *says so*. The task is still queued for the server. |
| Server rejects a change | Parked in the outbox and surfaced, never silently dropped. Retryable from settings. |
| Accidental delete | Undo in the toast; the tombstone keeps it recoverable for 30 days regardless. |

## Extending it

The shape was chosen so the obvious next features are additive:

- **A new field** — add a nullable column, a per-field clock, one `case` arm in
  the merge function and one in the SQL. No migration of existing rows.
- **Multiple lists** — a `list_id` column and a filter. The sync layer does not
  care.
- **Due dates, reminders, tags** — new fields, as above.
- **macOS / Linux** — Tauri already targets both; the shell code is the only
  platform-specific part.
- **A native mobile app** — `@recall/core` is plain TypeScript with no DOM
  dependency outside the storage adapters. A React Native shell would need one
  new `StorageAdapter`.

The deliberate omissions — projects, priorities, subtasks, recurring schedules —
are omitted because each one adds a decision to make at capture time, and
capture time is the one place where this product cannot afford decisions.
