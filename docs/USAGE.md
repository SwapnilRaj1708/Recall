# Using Recall

## The idea

Recall is one list that follows you. Whatever you capture on one screen is on
every other screen a moment later, and the Windows widget keeps it in front of
you while you work so you do not have to remember to go and look.

---

## Capturing

Ranked by speed. The first one is the point of the whole product.

### Anywhere in Windows — `Ctrl` `Alt` `Space`

A small bar appears in the middle of the screen, already focused.

- Type, press **Enter** → saved, bar disappears.
- **Ctrl+Enter** → saved, bar stays open for the next thought.
- **Esc** → cancel.

This works over full-screen applications and games. You never have to find a
window first.

**If that combination is already taken**, Recall says so rather than silently
doing nothing. Global shortcuts are first-come-first-served across the whole
machine, and graphics drivers, launchers and chat apps all claim the popular
ones. At startup Recall works down a short list —

1. `Ctrl+Alt+Space`
2. `Ctrl+Shift+Space`
3. `Ctrl+Alt+N`
4. ``Ctrl+Shift+\``
5. ``Ctrl+Alt+\``

— and takes the first one the machine will give it. **Settings → Windows** shows
which one is actually live, and you can type any combination you prefer there.
If it cannot be registered, the field says so instead of pretending.

### In Chrome — the address bar

Type `r`, a space, then the task, and press **Enter**.

The space is what hands the address bar over to Recall — without it Chrome just
searches for what you typed.

No window opens, nothing loads, and you keep the tab you were on.

### The widget

Click the field at the top and type. It keeps focus after each Enter, so three
thoughts in a row is three Enters and no clicks.

### The extension popup — a keyboard shortcut

Opens with the capture field focused.

The manifest suggests `Ctrl+Shift+Y`, but **treat that as a suggestion only**.
Chrome hands out shortcuts first-come-first-served and keeps the good ones for
itself; if the suggestion is taken, Chrome assigns *nothing* rather than
warning you, and the shortcut silently does nothing.

So the extension does not claim a shortcut it might not have. **Settings** shows
the binding Chrome actually gave it, or says "Not set". To choose your own, go
to `chrome://extensions/shortcuts`.

Two combinations to avoid: `Alt+Shift+R` is Chrome's own Reading Mode, and
`Ctrl+Shift+Space` is the desktop app's global quick capture, which wins
system-wide including inside Chrome.

### Selected text on a page

Select it, right-click → **Add "…" to Recall**.

---

## Working with the list

The same interactions everywhere:

| Action | How |
| --- | --- |
| Complete | Click the checkbox. Click again to undo. |
| Edit | Click the text, type, **Enter** to save, **Esc** to discard. |
| Delete | Hover the row, click the bin. A toast offers **Undo**. |
| Reorder | Drag the handle on the left of a row. |

New captures go to the **top** of the list — the thing you just remembered is
the thing most at risk of being forgotten again.

Completed tasks are hidden by default. Turn on **Show completed tasks** in
settings to keep them visible underneath.

Deleted tasks are recoverable for 30 days, not just until the toast fades.

---

## The Windows widget

A small translucent panel that sits on your desktop.

- **Move it** — drag the top strip.
- **Resize it** — drag any edge.
- Position and size are remembered across restarts.
- **Pin / unpin** — the `⋮` menu. Pinned means it stays above other windows.
- **Hide it** — the `⋮` menu, or **Esc** in an empty capture field.
- **Bring it back** — the tray icon, or the pin button in the main window.

The tray icon (bottom-right of the taskbar):

- **Left click** — open the main window.
- **Right click** — open, quick capture, show/hide widget, quit.

Closing the main window does not quit Recall — the widget, the tray icon and
the global shortcut keep working, and reopening is instant from the tray. Quit
properly from the tray menu.

The main window is built when you first open it rather than at startup, because
each open window costs around 85 MB and this one is opened deliberately and
occasionally. The widget and the capture bar stay resident, since both have to
respond instantly.

**Start with Windows** is in Settings → Windows. When Recall starts this way it
comes up in the tray and the widget without a main window stealing focus during
sign-in.

---

## The main window

For everything the widget deliberately leaves out.

| Shortcut | Action |
| --- | --- |
| `Ctrl` `N` | Focus the capture field |
| `Ctrl` `F` | Search |
| `Ctrl` `,` | Settings |

Search filters as you type; **Esc** clears it. Reordering is disabled while a
search is active, because dragging within a filtered view would move things
somewhere you cannot see.

---

## Chrome extension

The toolbar badge shows how many open tasks you have — a quiet reminder that
does not interrupt anything. It turns amber when something has not reached the
server yet.

The popup runs a live connection while it is open, so it reflects changes from
your other devices as they happen. When it is closed, the extension still syncs
in the background about once a minute to keep the badge honest.

---

## On your phone

Open your deployed web address in Chrome, then menu → **Add to Home screen**. It
installs as a normal app, works offline, and syncs when it reconnects.

Note that this is an app icon, not a home-screen widget — Android home-screen
widgets need a native app, which this stack cannot produce. If the always-on-
screen list on your phone matters more than having one app, keep using your
current phone app for that and let Recall cover the desktop and browser.

---

## Making it look how you want

Settings → Appearance, on every surface:

- **Theme** — light, dark, or follow Windows.
- **Accent** — six presets.
- **Transparency** — how much of your desktop shows through the widget.
- **Row height** — from compact to comfortable.
- **Text size** — 85% to 140%.

You only set this once. Appearance is shared by every window on the machine, so
changing the accent in the desktop app recolours the widget straight away —
neither window needs restarting, and the widget has no settings screen of its
own. The widget still renders it its own way: a little denser than the main
window, and translucent where the main window is solid, because it is the only
one with your desktop behind it.

Host settings — always-on-top, Start with Windows, the quick-capture shortcut,
whether completed tasks stay listed — belong to the window that set them.

If you want something the sliders do not cover — a different accent colour,
different corner rounding, more spacing between rows — it is all in
`packages/ui/src/tokens.css`, and a change there applies to all four surfaces at
once.

---

## Knowing whether it synced

There is a small indicator in the header of every surface. It stays quiet when
everything is fine, because a permanent "synced" badge is just noise. It speaks
up when it matters:

| It says | It means |
| --- | --- |
| A green dot | Connected and live. |
| *Syncing* | A push or pull is in flight. |
| *n pending* | Captured locally, not yet on the server. It will get there. |
| *Offline* | No network. Everything still works; changes are queued. |
| *n not saved* | The server refused a change. Open Settings → Sync → Retry. |

Nothing in that table means data was lost. Captures live in local storage and a
durable queue from the moment you press Enter, and they survive a crash, a
reboot, and a week without network.
