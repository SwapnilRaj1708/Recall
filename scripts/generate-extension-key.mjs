/**
 * Pins the Chrome extension's identity.
 *
 * By default Chrome derives an unpacked extension's ID from its folder path,
 * so the ID changes between machines and checkouts. That would be a nuisance
 * anywhere; here it is a blocker, because Google sign-in redirects to
 * `https://<extension-id>.chromiumapp.org/` and that exact URL has to be on
 * Supabase's allow-list before sign-in can work at all.
 *
 * Embedding the public key in the manifest fixes the ID for good, so the
 * redirect URL can be registered once and never revisited.
 *
 *   node scripts/generate-extension-key.mjs
 *
 * The private key is written outside version control and is only needed if you
 * later want to pack a .crx; losing it does not affect the pinned ID.
 */

import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSION_DIR = join(ROOT, 'apps', 'extension');
const PRIVATE_KEY_PATH = join(EXTENSION_DIR, 'key.pem');
const MANIFEST_PATH = join(EXTENSION_DIR, 'manifest.json');

/** Chrome's ID scheme: SHA-256 of the DER public key, first 16 bytes, nibbles mapped to a–p. */
function extensionIdFrom(publicKeyDer) {
  const digest = createHash('sha256').update(publicKeyDer).digest();
  return [...digest.subarray(0, 16)]
    .flatMap((byte) => [byte >> 4, byte & 0x0f])
    .map((nibble) => String.fromCharCode(97 + nibble))
    .join('');
}

let privateKeyPem;
if (existsSync(PRIVATE_KEY_PATH)) {
  privateKeyPem = readFileSync(PRIVATE_KEY_PATH, 'utf8');
  console.log('Reusing the existing key at apps/extension/key.pem');
} else {
  const generated = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  privateKeyPem = generated.privateKey;
  writeFileSync(PRIVATE_KEY_PATH, privateKeyPem, { mode: 0o600 });
  console.log('Generated a new key at apps/extension/key.pem (git-ignored)');
}

const { createPublicKey } = await import('node:crypto');
const publicKeyDer = createPublicKey(privateKeyPem).export({ type: 'spki', format: 'der' });
const manifestKey = publicKeyDer.toString('base64');
const extensionId = extensionIdFrom(publicKeyDer);
const redirectUrl = `https://${extensionId}.chromiumapp.org/`;

if (existsSync(MANIFEST_PATH)) {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  manifest.key = manifestKey;
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('Wrote the public key into apps/extension/manifest.json');
}

writeFileSync(
  join(EXTENSION_DIR, 'extension-id.txt'),
  `${extensionId}\n${redirectUrl}\n`,
);

console.log('');
console.log(`  Extension ID : ${extensionId}`);
console.log(`  Redirect URL : ${redirectUrl}`);
console.log('');
console.log('Add that redirect URL to Supabase → Authentication → URL Configuration');
console.log('→ Redirect URLs, or Google sign-in from the extension will be rejected.');
