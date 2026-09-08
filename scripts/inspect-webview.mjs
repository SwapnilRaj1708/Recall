/**
 * Evaluate JavaScript inside a running Tauri window, over WebView2's debugging
 * protocol.
 *
 * There is no other way to see what the desktop app's DOM actually looks like:
 * release builds have no devtools, and screenshots cannot tell you whether an
 * attribute is present or a click handler fired.
 *
 *   1. Start the app with the debugger listening:
 *        $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9333"
 *        Start-Process ...\recall.exe
 *   2. node scripts/inspect-webview.mjs <window-title> "<expression>"
 *
 * e.g. node scripts/inspect-webview.mjs "Recall widget" "document.title"
 */

const port = process.env.RECALL_DEBUG_PORT ?? '9333';
const wanted = process.argv[2] ?? 'Recall widget';
const expression = process.argv[3] ?? 'document.title';

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
const target = targets.find((t) => t.type === 'page' && t.title === wanted);

if (!target) {
  console.error(`No window titled "${wanted}". Available:`);
  for (const t of targets.filter((t) => t.type === 'page')) {
    console.error(`  - ${t.title}  (${t.url.slice(0, 80)})`);
  }
  process.exit(1);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);

const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timed out')), 15_000);
  socket.addEventListener('open', () => {
    socket.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }),
    );
  });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== 1) return;
    clearTimeout(timer);
    socket.close();
    if (message.result?.exceptionDetails) {
      reject(new Error(message.result.exceptionDetails.text ?? 'evaluation threw'));
      return;
    }
    resolve(message.result?.result?.value);
  });
  socket.addEventListener('error', (event) => {
    clearTimeout(timer);
    reject(new Error(String(event.message ?? 'socket error')));
  });
});

console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
