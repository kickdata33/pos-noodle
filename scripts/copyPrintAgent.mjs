// Runs before `next build` (npm "prebuild"): publishes the Print Agent's files under
// public/print-agent/ so the installer can download them from the shop's own site, and writes
// manifest.json listing what to fetch. public/print-agent/ is a build artifact (gitignored);
// the source of truth is print-agent/.
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const src = path.join(root, "print-agent");
const out = path.join(root, "public", "print-agent");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const agentFiles = ["package.json", "package-lock.json"];
for (const dir of ["src", "ps"]) {
  for (const f of readdirSync(path.join(src, dir))) agentFiles.push(`${dir}/${f}`);
}
agentFiles.push("uninstall.ps1");

for (const f of agentFiles) {
  const from = f === "uninstall.ps1" ? path.join(src, "install", f) : path.join(src, f);
  mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
  cpSync(from, path.join(out, f));
}
cpSync(path.join(src, "install", "setup.ps1"), path.join(out, "setup.ps1"));
writeFileSync(path.join(out, "manifest.json"), JSON.stringify({ version: 1, files: agentFiles }, null, 2));
console.log(`print-agent: published ${agentFiles.length} files to public/print-agent/`);
