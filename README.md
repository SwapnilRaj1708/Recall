# Recall

One task list, on every screen you use.

A synchronised external-memory system: capture a thought in under two seconds
from anywhere, and keep it in front of you until it is done. Windows widget,
Windows app, Chrome extension, web app and installable phone PWA — all the same
list, syncing in near-real-time, all fully usable offline.

```bash
pnpm install && pnpm dev:demo
```

That runs the entire interface against an in-memory server. No account, no
configuration, nothing leaves your machine.

---

## Documentation

| | |
| --- | --- |
| [**docs/SETUP.md**](docs/SETUP.md) | Everything you need to do once, in order. |
| [**docs/USAGE.md**](docs/USAGE.md) | How to actually use it day to day. |
| [**docs/ARCHITECTURE.md**](docs/ARCHITECTURE.md) | How it works and why it is built this way. |

---

## What is here

```
packages/
  core/         Task model, sync engine, outbox, per-field merge, storage
                adapters, Supabase client. Plain TypeScript, no UI, no DOM
                outside the storage layer. This is where the real work is.
  ui/           Design tokens and primitives. Every visual decision in the
                product resolves to a variable in src/tokens.css.
  app/          Shared React: the task list, quick capture, auth gate,
                settings, and the four view layouts. All three shells render
                these same components.

apps/
  web/          Vite PWA → Vercel → also the phone app.
  desktop/      Tauri v2. Three windows (main, widget, global capture bar),
                tray icon, global hotkey, autostart.
  extension/    Chrome MV3. Popup, omnibox capture, context menu, badge.

supabase/
  migrations/   The schema, row-level security policies, the merge function,
                and the ordering collation. Two files, run in order, once.

scripts/        Icon generation, extension key pinning, live project check.
```

The three applications are shells: they own window management, OS integration
and sign-in mechanics, and no task logic whatsoever.

---

## Commands

| | |
| --- | --- |
| `pnpm dev:demo` | Full interface, in-memory server, no setup |
| `pnpm dev:web` | Web app against your Supabase project |
| `pnpm dev:desktop` | Windows app and widget (needs Rust) |
| `pnpm build:extension` | Build the extension, then load `apps/extension/dist` unpacked |
| `pnpm test` | Full offline test suite |
| `pnpm test:live` | Check a real Supabase project is set up correctly |
| `pnpm typecheck` | Typecheck every package |
| `pnpm build:desktop` | Windows installer (~1.8 MB, in `apps/desktop/src-tauri/target/release/bundle/nsis/`) |
| `pnpm scan` | Check built bundles for leaked credentials |

---

## Design notes worth knowing

**It is local-first.** Every surface holds a complete copy of the list and a
durable outbox. A mutation updates memory and the UI before its first `await`,
then persists, then queues for the server. Nothing waits on the network, and
nothing is lost if the network never comes back.

**Conflicts are resolved per field, not per row.** Each of `text`, `completed`,
`position` and `deleted` carries its own logical clock. If your phone renames a
task while your laptop — offline — completes it, both changes survive. Row-level
last-write-wins would discard one of them.

**Deletes are tombstones.** A hard delete cannot replicate to other devices and
cannot be undone. Deleted tasks stay recoverable for 30 days.

**Ordering uses fractional indices.** Moving a task rewrites one field on one
row, so two devices reordering at once merge instead of fighting.

**One merge function handles everything.** Offline reconnection, duplicate
delivery, out-of-order events and simultaneous edits all reduce to "here is
another version of this row", and are solved in one place — which is why that
function carries the heaviest test coverage in the project.

---

## Security

- Clients only ever hold the Supabase **anon key**, which authorises nothing on
  its own. Row-level security scoped to `auth.uid()` is what protects the data.
- Writes go through one SQL function that stamps `user_id` from the session, so
  a client cannot write into another list even if it tries.
- The `service_role` key is not used anywhere and must never be added.
- All configuration comes from git-ignored `.env` files. No secrets in source.
- The extension requests four permissions and access to `*.supabase.co` only.
