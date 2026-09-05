#!/usr/bin/env node
// Inspects a production build (and its release archive when present) for the
// guarantees the README and PRIVACY document make: minimal permissions, no
// remote executable code, no telemetry, no source maps, no dev fixtures.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const outputDir = process.argv[2] ?? ".output/chrome-mv3";
const failures = [];
const notes = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

if (!existsSync(outputDir)) {
  console.error(`No build found at ${outputDir}. Run \`pnpm build\` first.`);
  process.exit(1);
}

const files = walk(outputDir);
const manifest = JSON.parse(
  readFileSync(join(outputDir, "manifest.json"), "utf8"),
);

const expectedPermissions = ["activeTab", "scripting", "sidePanel", "storage"];
check(
  JSON.stringify([...(manifest.permissions ?? [])].sort()) ===
    JSON.stringify([...expectedPermissions].sort()),
  `Unexpected permissions: ${JSON.stringify(manifest.permissions)}`,
);
check(
  !manifest.host_permissions || manifest.host_permissions.length === 0,
  `Production builds must declare no host_permissions: ${JSON.stringify(manifest.host_permissions)}`,
);
check(
  JSON.stringify([...(manifest.optional_host_permissions ?? [])].sort()) ===
    JSON.stringify(
      ["http://127.0.0.1/*", "http://localhost/*", "http://[::1]/*"].sort(),
    ),
  `Optional host permissions must stay loopback-only: ${JSON.stringify(manifest.optional_host_permissions)}`,
);
check(
  /script-src 'self'/.test(
    manifest.content_security_policy?.extension_pages ?? "",
  ),
  "extension_pages CSP must pin script-src to 'self'",
);
check(manifest.manifest_version === 3, "Manifest version must be 3");

const sourceMaps = files.filter((file) => file.endsWith(".map"));
check(sourceMaps.length === 0, `Source maps present: ${sourceMaps.join(", ")}`);

const fixtures = files.filter((file) => /fixtures?\//.test(file));
check(fixtures.length === 0, `Dev fixtures present: ${fixtures.join(", ")}`);

const secrets = files.filter((file) => /(^|\/)\.env|\.pem$|\.key$/.test(file));
check(
  secrets.length === 0,
  `Secret-looking files present: ${secrets.join(", ")}`,
);

const scripts = files.filter((file) => /\.(js|mjs|html)$/.test(file));

// Documentation and error-message strings that are rendered or linked, never
// fetched. Anything outside this list is reported for a human decision.
const informationalOrigins = [
  "https://dequeuniversity.com",
  "https://act-rules.github.io",
  "https://www.w3.org",
  "http://www.w3.org",
  "https://github.com/dequelabs/axe-core",
  "https://github.com/zloirock/core-js",
  "https://react.dev/errors/",
  "https://www.deque.com",
  "https://accessibilityinsights.io",
];
// Loopback endpoints built from the validated allowlist survive minification as
// template literals with an interpolated host.
const loopbackPattern = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]|\$\{)/;
// Anything that would load or run code fetched at runtime.
const remoteCodePatterns = [
  /<script[^>]+src=["']https?:/i,
  /import\s*\(\s*["'`]https?:/,
  /importScripts\s*\(\s*["'`]?https?:/,
  /new\s+Worker\s*\(\s*["'`]https?:/,
];
// Dynamic evaluation of bundled strings. Forbidden in first-party bundles;
// axe-core ships its own template engine inside scanner.js, which is bundled,
// local, and reviewable rather than remote.
const dynamicCodePatterns = [/new\s+Function\s*\(/, /[^.\w]eval\s*\(/];
const dynamicCodeException = "scanner.js";

const unexpectedUrls = [];
const remoteCode = [];
const dynamicCode = [];
const telemetry = [];
for (const file of scripts) {
  const text = readFileSync(file, "utf8");
  const name = relative(outputDir, file);
  for (const match of text.matchAll(/https?:\/\/[^\s"'`)]+/g)) {
    const url = match[0];
    const allowed =
      loopbackPattern.test(url) ||
      informationalOrigins.some((origin) => url.startsWith(origin));
    if (!allowed) unexpectedUrls.push(`${name}: ${url}`);
  }
  for (const pattern of remoteCodePatterns)
    if (pattern.test(text)) remoteCode.push(`${name}: ${pattern}`);
  for (const pattern of dynamicCodePatterns)
    if (pattern.test(text)) {
      if (name === dynamicCodeException)
        notes.push(
          `bundled dynamic evaluation in ${name} (axe-core template engine): ${pattern}`,
        );
      else dynamicCode.push(`${name}: ${pattern}`);
    }
  if (/\b(gtag|mixpanel|amplitude|segment\.io|sentry)\b/i.test(text))
    telemetry.push(name);
}
check(
  remoteCode.length === 0,
  `Remotely loaded code: ${remoteCode.join(", ")}`,
);
check(
  dynamicCode.length === 0,
  `Dynamic code evaluation in a first-party bundle: ${dynamicCode.join(", ")}`,
);
check(
  unexpectedUrls.length === 0,
  `Unexpected URLs: ${unexpectedUrls.slice(0, 10).join(", ")}`,
);
check(
  telemetry.length === 0,
  `Telemetry vendor present: ${telemetry.join(", ")}`,
);

const totalBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
notes.push(`files: ${files.length}`);
notes.push(`unpacked size: ${(totalBytes / 1024 / 1024).toFixed(2)} MiB`);
notes.push(`permissions: ${JSON.stringify(manifest.permissions)}`);

const archives = existsSync(".output")
  ? readdirSync(".output").filter((entry) => entry.endsWith(".zip"))
  : [];
for (const archive of archives)
  notes.push(
    `archive: .output/${archive} (${(statSync(join(".output", archive)).size / 1024).toFixed(0)} KiB)`,
  );

for (const note of notes) console.log(`  ${note}`);
if (failures.length > 0) {
  console.error("\nBuild verification failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("\nBuild verification passed.");
