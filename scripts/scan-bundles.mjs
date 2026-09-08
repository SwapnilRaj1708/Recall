/**
 * Scans built bundles for credentials that must never ship.
 *
 * A plain text search for "service_role" is useless here: supabase-js is full
 * of JSDoc comments warning people not to use that key, and the extension is
 * built unminified so those comments survive. What actually matters is whether
 * a *JWT* with elevated privileges is embedded, so this decodes every
 * JWT-shaped string it finds and inspects the role claim.
 *
 *   node scripts/scan-bundles.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const TARGETS = [
  'apps/web/dist',
  'apps/extension/dist',
  'apps/desktop/dist',
];

/** Three base64url segments — the shape of a JWT. */
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

/** Roles that would be a genuine leak if found in a client bundle. */
const FORBIDDEN_ROLES = new Set(['service_role', 'supabase_admin', 'postgres']);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(js|html|css|json|map)$/.test(entry)) yield full;
  }
}

const findings = [];
let scanned = 0;
let anonKeysSeen = 0;

for (const target of TARGETS) {
  for (const file of walk(join(ROOT, target))) {
    scanned++;
    const content = readFileSync(file, 'utf8');

    for (const token of content.match(JWT) ?? []) {
      let claims;
      try {
        claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      } catch {
        continue; // Not really a JWT, just something JWT-shaped.
      }

      const role = claims.role ?? claims.rol ?? '(none)';
      if (FORBIDDEN_ROLES.has(role)) {
        findings.push({ file: relative(ROOT, file), role, issuer: claims.iss });
      } else if (role === 'anon') {
        anonKeysSeen++;
      }
    }

    // The private key that pins the extension's identity must never be bundled.
    if (content.includes('BEGIN PRIVATE KEY') || content.includes('BEGIN RSA PRIVATE KEY')) {
      findings.push({ file: relative(ROOT, file), role: 'PRIVATE KEY', issuer: '-' });
    }
  }
}

console.log(`Scanned ${scanned} built files.`);
console.log(`Found ${anonKeysSeen} anon key(s) — expected: they are designed to ship in clients.`);

if (findings.length === 0) {
  console.log('No privileged credentials found.');
  process.exit(0);
}

console.error('\nLEAKED CREDENTIALS:');
for (const f of findings) console.error(`  ${f.file}  role=${f.role}  iss=${f.issuer}`);
process.exit(1);
