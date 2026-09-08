import { isBlank, normalizeText } from '@recall/core';
import { configured, getBackgroundRuntime } from './runtime.js';

/**
 * The extension's background worker.
 *
 * Two jobs, both about visibility and speed of capture:
 *
 *   1. Keep the toolbar badge showing how many open tasks there are, so the
 *      list keeps existing even when nothing is open.
 *   2. Provide the fastest capture path in the whole product — the omnibox,
 *      where `td buy milk` + Enter stores a task without opening any UI.
 *
 * Manifest V3 tears this worker down after a few seconds of idleness, so
 * nothing is kept in memory that is not also in `chrome.storage.local`, and
 * every handler is written to work from a cold start.
 */

const SYNC_ALARM = 'recall-sync';
const SYNC_PERIOD_MINUTES = 1;
const CONTEXT_MENU_ID = 'recall-capture-selection';

/* ------------------------------------------------------------------- badge */

async function refreshBadge(): Promise<void> {
  if (!configured) {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#b4741a' });
    await chrome.action.setTitle({ title: 'Recall — not configured' });
    return;
  }

  try {
    const { engine } = await getBackgroundRuntime();
    const open = engine.getOpenTasks().length;
    const status = engine.getStatus();

    await chrome.action.setBadgeText({ text: open === 0 ? '' : String(open) });
    await chrome.action.setBadgeBackgroundColor({
      // Amber when something is queued, so a sync problem is visible without
      // being intrusive about it.
      color: status.pending > 0 || status.failed > 0 ? '#b4741a' : '#5b5bd6',
    });
    await chrome.action.setTitle({
      title: open === 0 ? 'Recall — nothing to remember' : `Recall — ${open} open`,
    });
  } catch (error) {
    console.warn('[recall] could not refresh the badge', error);
  }
}

/* -------------------------------------------------------------- scheduling */

async function syncAndRefresh(): Promise<void> {
  if (!configured) return;
  try {
    const { engine } = await getBackgroundRuntime();
    await engine.syncNow();
  } catch (error) {
    // A failed background sync is expected when offline. The outbox keeps the
    // work, so there is nothing to recover here.
    console.warn('[recall] background sync failed', error);
  } finally {
    await refreshBadge();
  }
}

function ensureAlarm(): void {
  chrome.alarms.get(SYNC_ALARM, (existing) => {
    if (!existing) {
      chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
    }
  });
}

/* ---------------------------------------------------------------- capture */

async function capture(text: string): Promise<boolean> {
  if (isBlank(text)) return false;
  const { engine } = await getBackgroundRuntime();
  await engine.capture(text);
  // Push straight away rather than waiting for the next alarm: the worker may
  // be killed within seconds, and the capture should be on the server by then.
  await engine.syncNow().catch(() => {
    /* Queued locally; the next alarm or the popup will deliver it. */
  });
  await refreshBadge();
  return true;
}

/* ----------------------------------------------------------------- wiring */

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Add "%s" to Recall',
      contexts: ['selection'],
    });
  });
  void syncAndRefresh();
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  void syncAndRefresh();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) void syncAndRefresh();
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  const text = normalizeText(info.selectionText ?? '');
  if (text.length > 0) void capture(text);
});

/* ---------------------------------------------------------------- omnibox */

/**
 * `td <text>` in the address bar, then Enter. No window, no click, no waiting —
 * the shortest capture path the browser can offer.
 */
chrome.omnibox.setDefaultSuggestion({
  description: 'Add to Recall: <match>%s</match>',
});

chrome.omnibox.onInputChanged.addListener((input, suggest) => {
  const text = normalizeText(input);
  suggest(
    text.length === 0
      ? []
      : [{ content: text, description: `Add to Recall: <match>${escapeXml(text)}</match>` }],
  );
});

chrome.omnibox.onInputEntered.addListener((input) => {
  void capture(input);
});

/** The omnibox description is parsed as XML, so raw user text has to be escaped. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ------------------------------------------------------- cross-context sync */

// The popup writes through the same chrome.storage, so this keeps the badge
// honest when tasks change while the worker happens to be alive.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (Object.keys(changes).some((key) => key.startsWith('t:'))) void refreshBadge();
});

// A cold start still needs the badge and the alarm in place.
ensureAlarm();
void syncAndRefresh();
