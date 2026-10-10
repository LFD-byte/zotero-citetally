// Packages src/ into build/<name>-<version>.xpi and writes build/update.json.
// Usage: node scripts/build.mjs
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const { repo, zoteroMinVersion, zoteroMaxVersion } = pkg.config;
const [owner] = repo.split("/");
if (owner === "OWNER") console.warn("warning: package.json config.repo is still a placeholder");

// The add-on ID must never change after the first release.
const addonID = pkg.config.addonID || `citation-counts@${owner.toLowerCase()}.github.io`;
const version = pkg.version;
const xpiName = `${pkg.name}-${version}.xpi`;
const releaseBase = `https://github.com/${repo}/releases`;

const out = join(root, "build");
const stage = join(out, "addon");
rmSync(out, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
// Plain file-by-file copy: fs.cpSync fails on some mounted/synced folders.
function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    const dst = join(to, name);
    if (statSync(src).isDirectory()) copyDir(src, dst);
    else copyFileSync(src, dst);
  }
}
copyDir(join(root, "src"), stage);

const manifestPath = join(stage, "manifest.json");
const manifest = readFileSync(manifestPath, "utf8")
  .replaceAll("__VERSION__", version)
  .replaceAll("__AUTHOR__", pkg.author)
  .replaceAll("__HOMEPAGE__", `https://github.com/${repo}`)
  .replaceAll("__ADDON_ID__", addonID)
  .replaceAll("__UPDATE_URL__", `${releaseBase}/latest/download/update.json`)
  .replaceAll("__MIN_VERSION__", zoteroMinVersion)
  .replaceAll("__MAX_VERSION__", zoteroMaxVersion);
JSON.parse(manifest); // validate
writeFileSync(manifestPath, manifest);

// Deterministic file list; manifest first.
function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [relative(stage, p)];
  });
}
const files = walk(stage).sort((a, b) => (a === "manifest.json" ? -1 : b === "manifest.json" ? 1 : a.localeCompare(b)));
const xpiPath = join(out, xpiName);
execFileSync("zip", ["-q", "-X", "-9", xpiPath, ...files], { cwd: stage });
if (!existsSync(xpiPath)) throw new Error("zip failed");

const hash = createHash("sha256").update(readFileSync(xpiPath)).digest("hex");
const update = {
  addons: {
    [addonID]: {
      updates: [
        {
          version,
          update_link: `${releaseBase}/download/v${version}/${xpiName}`,
          update_hash: `sha256:${hash}`,
          applications: {
            zotero: { strict_min_version: zoteroMinVersion, strict_max_version: zoteroMaxVersion },
          },
        },
      ],
    },
  },
};
writeFileSync(join(out, "update.json"), JSON.stringify(update, null, 2) + "\n");

console.log(`built ${relative(root, xpiPath)} (${files.length} files)`);
console.log(`  id: ${addonID}  repo: ${repo}  zotero: ${zoteroMinVersion} – ${zoteroMaxVersion}`);
console.log(`  sha256: ${hash}`);
