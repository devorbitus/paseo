#!/usr/bin/env node
// Build a fork commit into its own release directory, ready for Ground Control to deploy.
//
//   node scripts/fork/stage-release.mjs [--ref fork/main] [--keep 3]
//
// Each release is a detached git worktree under ~/.paseo-fork/releases/<tag>-fork.<sha> with
// its own node_modules and built server. Releases are never edited after staging; deploying
// is repointing ~/.paseo-fork/current, and rolling back is pointing it back.
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  currentReleaseName,
  forkBaseTag,
  git,
  parseArgs,
  readReleaseManifest,
  releasesDir,
  run,
} from "./lib.mjs";

const { flags } = parseArgs(process.argv.slice(2));
const ref = flags.ref ?? "fork/main";
const keep = Number(flags.keep ?? 3);

const sha = git(["rev-parse", ref]);
const baseTag = forkBaseTag(sha);
const name = `${baseTag}-fork.${sha.slice(0, 9)}`;
const dir = join(releasesDir, name);

const existing = readReleaseManifest(name);
if (existing) {
  console.log(JSON.stringify({ status: "already_staged", ...existing }, null, 2));
  process.exit(0);
}

mkdirSync(releasesDir, { recursive: true });
if (!existsSync(dir)) {
  git(["worktree", "add", "--detach", dir, sha]);
}
run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: dir });
run("npm", ["run", "build:server"], { cwd: dir });

const patchLog = git(["log", "--reverse", "--format=%h %s", `${baseTag}..${sha}`]);
const manifest = {
  name,
  sha,
  base_tag: baseTag,
  patches: patchLog ? patchLog.split("\n") : [],
  staged_at: new Date().toISOString(),
};
writeFileSync(join(dir, "release.json"), `${JSON.stringify(manifest, null, 2)}\n`);

// Keep the live release plus the newest `keep` others; older ones go.
const live = currentReleaseName();
const others = readdirSync(releasesDir)
  .filter((entry) => entry !== live && entry !== name)
  .map((entry) => ({ entry, mtime: statSync(join(releasesDir, entry)).mtimeMs }))
  .sort((a, b) => b.mtime - a.mtime);
for (const { entry } of others.slice(Math.max(keep - 1, 0))) {
  git(["worktree", "remove", "--force", join(releasesDir, entry)]);
}

console.log(JSON.stringify({ status: "staged", dir, ...manifest }, null, 2));
