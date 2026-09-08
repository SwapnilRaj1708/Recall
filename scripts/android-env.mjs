#!/usr/bin/env node
/**
 * Runs a Tauri Android command with a working toolchain environment.
 *
 * Getting an Android build going on Windows cost three failed builds, each
 * failing late and for a reason the error did not name:
 *
 *  - The NDK has to be found and exported as NDK_HOME.
 *  - Gradle's *launcher* JVM must be old enough to read the build script's
 *    class files. Gradle 8.14 cannot read Java 25, and the failure reads
 *    "Unsupported class file major version 69", which says nothing about JDKs.
 *    Both JDKs on the first machine this ran on were 25, including the one
 *    bundled with Android Studio — so "Android Studio is installed" is not
 *    evidence that a usable JDK is on the machine.
 *
 * So this resolves each piece, states what it picked, and refuses to start a
 * build that is going to fail twenty minutes later.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Gradle 8.14 runs on Java 8 through 24. Newer class files it cannot parse. */
const MAX_LAUNCHER_JAVA = 24;
const MIN_LAUNCHER_JAVA = 17;

const home = process.env.USERPROFILE ?? process.env.HOME ?? '';

function firstExisting(candidates) {
  return candidates.find((path) => path && existsSync(path)) ?? null;
}

function findAndroidSdk() {
  return firstExisting([
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(home, 'AppData', 'Local', 'Android', 'Sdk'),
    join(home, 'Android', 'Sdk'),
    '/usr/local/lib/android/sdk',
  ]);
}

/** Highest installed NDK, by numeric version rather than string order. */
function findNdk(sdk) {
  if (process.env.NDK_HOME && existsSync(process.env.NDK_HOME)) return process.env.NDK_HOME;
  const root = join(sdk, 'ndk');
  if (!existsSync(root)) return null;
  const versions = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    // A directory without source.properties is a half-finished download.
    .filter((entry) => existsSync(join(root, entry.name, 'source.properties')))
    .map((entry) => entry.name)
    .sort(compareVersions);
  const latest = versions.at(-1);
  return latest ? join(root, latest) : null;
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Read a JDK's feature version from its release file, without running it. */
function javaVersionOf(jdk) {
  const release = join(jdk, 'release');
  if (!existsSync(release)) return null;
  const match = /^JAVA_VERSION="?([0-9]+)/m.exec(readFileSync(release, 'utf8'));
  return match ? Number(match[1]) : null;
}

function candidateJdks() {
  const roots = [
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Microsoft',
    join(home, 'AppData', 'Local', 'Programs', 'Eclipse Adoptium'),
    '/usr/lib/jvm',
  ];

  const found = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.isDirectory() || entry.isSymbolicLink()) found.push(join(root, entry.name));
    }
  }
  // Android Studio's bundled runtime, which is not necessarily an old enough one.
  found.push('C:\\Program Files\\Android\\Android Studio\\jbr');
  if (process.env.JAVA_HOME) found.unshift(process.env.JAVA_HOME);
  return found.filter((path) => existsSync(path));
}

function findLauncherJdk() {
  const seen = [];
  for (const jdk of candidateJdks()) {
    const version = javaVersionOf(jdk);
    if (version === null) continue;
    seen.push({ jdk, version });
    if (version >= MIN_LAUNCHER_JAVA && version <= MAX_LAUNCHER_JAVA) return { jdk, version, seen };
  }
  return { jdk: null, version: null, seen };
}

const sdk = findAndroidSdk();
if (!sdk) {
  console.error(
    'Android SDK not found. Install it via Android Studio, or set ANDROID_HOME.\n' +
      'Expected at %LOCALAPPDATA%\\Android\\Sdk on Windows.',
  );
  process.exit(1);
}

const ndk = findNdk(sdk);
if (!ndk) {
  console.error(
    `No complete NDK under ${join(sdk, 'ndk')}.\n` +
      'Android Studio → SDK Manager → SDK Tools → tick "NDK (Side by side)".\n' +
      'Rust cross-compilation cannot proceed without it.',
  );
  process.exit(1);
}

const { jdk, version, seen } = findLauncherJdk();
if (!jdk) {
  console.error(
    `No JDK between ${MIN_LAUNCHER_JAVA} and ${MAX_LAUNCHER_JAVA} found; Gradle cannot run on the ones present.\n` +
      (seen.length
        ? `Found: ${seen.map((entry) => `Java ${entry.version} at ${entry.jdk}`).join('\n       ')}\n`
        : 'Found no JDKs at all.\n') +
      'A JDK newer than the maximum fails deep in the build with\n' +
      '"Unsupported class file major version", which does not mention Java at all.\n' +
      'Install one with:  winget install --id EclipseAdoptium.Temurin.21.JDK -e',
  );
  process.exit(1);
}

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error('Usage: node scripts/android-env.mjs <command> [args...]');
  process.exit(1);
}

console.error(`android: SDK  ${sdk}`);
console.error(`android: NDK  ${ndk}`);
console.error(`android: JDK  ${jdk} (Java ${version})`);

// A shell is needed on Windows to run the `.cmd` shims that pnpm and the Tauri
// CLI install; elsewhere it only gets in the way of argument quoting. The
// arguments come from this repo's own package scripts, never from user input.
const child = spawn(command[0], command.slice(1), {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: {
    ...process.env,
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk,
    NDK_HOME: ndk,
    JAVA_HOME: jdk,
  },
});

child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
