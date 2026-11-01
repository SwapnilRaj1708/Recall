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

### Selected text, a link, or the page itself

Right-click, and:

- on selected text → **Add "…" to Recall**
- on a link → **Add link to Recall**
- anywhere on the page → **Add this page to Recall**, which saves its address

The toolbar icon shows a green ✓ for a moment to say it is saved. This is the
browser's version of sharing: Chrome does not let an extension join its own
Share menu, but the right-click menu is as close to hand.

### Sharing from another app on your phone

In YouTube, Instagram, or anything with a **Share** button: Share → **Recall**.
The link is saved, a **Link saved** toast appears, and you never leave the app
you were in. See [On your phone](#on-your-phone) for when it reaches your
other devices.

---

## Working with the list

The same interactions everywhere:

| Action | How |
| --- | --- |
| Complete | Click the checkbox. Click again to undo. |
| Edit | Click the text, type, **Enter** to save, **Esc** to discard. |
| Open a link | Links (`https://…` or `www.…`) are underlined; click one to open it in a new browser tab. Clicking the rest of the text still edits. On the phone's home-screen widget, tap the task — its links are listed above the editor. |
| Delete | Hover the row, click the bin. A toast offers **Undo**. |
| Reorder | Drag the handle on the left of a row. |

New captures go to the **top** of the list — the thing you just remembered is
the thing most at risk of being forgotten again. If you read your list as a
queue instead, turn on **Settings → List → Add tasks to the bottom**.

Completed tasks are hidden by default. Turn on **Show completed tasks** in
settings to keep them visible underneath. Or turn on **Clear completed tasks
daily**, and at midnight everything you finished is deleted — recoverably, like
any delete. If no device is open at midnight, it happens the next time one is,
and the phone widget stops showing yesterday's finished tasks straight away.

Both of those follow your account, like Customize below: set them once and
every device agrees.

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

Recall has a native Android app with a home-screen widget, so your list can sit
on the home screen the way it sits on your desktop.

### Installing

Build the signed release from `apps/mobile`:

```bash
pnpm android:release
```

The APK lands in
`apps/mobile/src-tauri/gen/android/app/build/outputs/apk/universal/release/`.
With the phone plugged in and USB debugging on, `adb install -r` that file; or
copy it to the phone and open it there, allowing the install when Android asks.

Every update has to be signed with the same key as the first install — Android
refuses anything else. Keep `recall-release.jks` and its password safe; losing
either means uninstalling, and signing in again from scratch.

Open Recall, tap **Continue with Google**, and your list downloads. The app is
the same one as everywhere else: same list, same settings, same gestures.

### The widget

Long-press the home screen → **Widgets** → **Recall**, and drop it where you
want it. It resizes from two cells by one up to the whole screen, and scrolls
when the list is longer than it is.

| Action | How |
| --- | --- |
| Complete | Tap the dot on the left. Tap again to undo. Done tasks drop below the open ones, greyed out and struck through. |
| Edit or delete | Tap the text. The editor opens with the keyboard already up; **OK** saves, **Delete** removes it. |
| Open a link | Links are underlined. Tap the task, then tap the link shown above the editor. |
| Add | Tap anywhere on the strip down the right edge below the sync button. |
| Sync | Tap the arrows at the top of the right edge. |

### Sharing into Recall

Share from any app — a video in YouTube, a reel in Instagram, a page in Chrome
— and pick **Recall**. Nothing opens: the link is saved, **Link saved** appears
at the bottom of the screen, and you are still in the app you shared from.

The link is on your phone straight away, and on the widget. If you have used
the Recall app in the last hour or so, it is also sent to the server there and
then, so it reaches your desktop in seconds. Otherwise it is sent the next time
you open Recall — the same as anything added on the widget. It is never lost
either way.

Recall shows up for anything shared as text, which is how almost every app
shares a link. Sharing a photo or a file is not supported.

### How the widget stays in sync

The widget draws from a copy of the list the app leaves for it, so it appears
instantly and works with no signal. What you do on the widget shows on the
widget straight away, but it reaches your other devices **the next time the
Recall app opens** — the app picks up everything the widget queued, first
thing, every time it comes to the front. The sync button is a shortcut for
exactly that: it opens the app, which syncs and hands you back.

Changes made elsewhere reach the widget the same way, when the app next runs.

Until it has been sent, a task changed on the widget or offline shows in the
app in a warm amber, with a marked left edge — and since new captures always go
to the top, anything just added from the widget is the first thing you see.
Once the sync lands it turns the normal colour. Nothing needs doing about it; it
only means "not safe anywhere else yet".

If the widget says **Open Recall to sign in**, that is literally it: the app is
signed out, and the widget has nothing to show until it is not.

The web app still works on a phone too — open your deployed address in Chrome,
menu → **Add to Home screen** — but it has no widget.

---

## Making it look how you want

Settings → Appearance, on every surface:

- **Theme** — light, dark, or follow Windows.
- **Accent** — six presets.
- **Row height** — from compact to comfortable.
- **Text size** — 85% to 140%.

You only set this once. Appearance is shared by every window on the machine, so
changing the accent in the desktop app recolours the widget straight away —
neither window needs restarting, and the widget has no settings screen of its
own. The widget still renders it its own way: a little denser than the main
window, and translucent where the main window is solid, because it is the only
one with your desktop behind it.

Host settings — Start with Windows, the quick-capture shortcut, whether
completed tasks stay listed — belong to the window that set them. Keeping the
widget on top is the widget's own setting: the pin on the widget and the switch
in the main window's settings are two controls for the same thing, and the
widget comes back exactly as you left it.

### Customize

Settings → Customize styles the widgets and the task list itself, and unlike
Appearance it follows your account: choose a font on the desktop and your phone
uses it too.

- **Widget** — background colour and transparency, border colour (or none), and
  rounded corners (none, small, medium, large). These apply to both the Windows
  widget and the phone's home-screen widget.
- **Tasks** — font size, font colour, completed font colour, typeface (system,
  serif, mono, condensed), weight, italic, and margins on each side of a row.
  These apply to every list: the apps, the website, the extension, and both
  widgets.

Every option has **Default**, which is not a fixed value but "however this
surface looked before" — so the two widgets keep their own natural corners and
borders, and text keeps following light and dark mode, until you choose
otherwise. The transparency slider that used to sit in Appearance lives here
now, beside the background it always applied to.

On the phone, colours, corners and borders need Android 12 or newer; on older
versions the widget keeps its original look.

If you want something the controls do not cover, it is all in
`packages/ui/src/tokens.css`, and a change there applies to every surface at
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
