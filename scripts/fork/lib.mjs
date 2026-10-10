// Shared paths and helpers for the devorbitus fork's release pipeline.
// See scripts/fork/README.md for how the pieces fit together.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, readlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const forkHome = process.env.PASEO_FORK_HOME ?? join(homedir(), ".paseo-fork");
export const releasesDir = join(forkHome, "releases");
export const currentLink = join(forkHome, "current");
export const deploysDir = join(forkHome, "deploys");
export const groundControlInbox =
  process.env.GROUND_CONTROL_INBOX ??
  join(homedir(), "code", "ground-control", "commands", "inbox");
export const deployService = "paseo-daemon";

export function git(args, options = {}) {
  return execFileSync("git", args, { cwd: options.cwd ?? repoRoot, encoding: "utf8" }).trim();
}

export function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: options.cwd ?? repoRoot, stdio: "inherit", env: options.env });
}

// The CLI that talks to the operator's main daemon (default home, port 6767). Rehearsals point
// it at a throwaway daemon with PASEO_FORK_DAEMON_HOME.
const daemonHomeArgs = process.env.PASEO_FORK_DAEMON_HOME
  ? ["--home", process.env.PASEO_FORK_DAEMON_HOME]
  : [];

export function cli(args, options = {}) {
  const entry = join(options.cliRoot ?? repoRoot, "packages", "cli", "dist", "index.js");
  return execFileSync(process.execPath, [entry, ...args, ...daemonHomeArgs], {
    encoding: "utf8",
    env: { ...process.env, ...options.env },
  });
}

export function cliJson(args, options = {}) {
  return JSON.parse(cli([...args, "--json"], options));
}

export function currentReleaseName() {
  if (!existsSync(currentLink)) return null;
  return basename(readlinkSync(currentLink));
}

export function readReleaseManifest(name) {
  const path = join(releasesDir, name, "release.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

// Newest stable upstream tag (vX.Y.Z, no prerelease suffix).
export function latestStableTag() {
  const tags = git(["tag", "-l", "v*", "--sort=-v:refname"]).split("\n");
  const stable = tags.find((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  if (!stable) throw new Error("No stable upstream tag found");
  return stable;
}

export function forkBaseTag(ref) {
  return git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", "--exclude", "*-*", ref]);
}

export function spawnDetached(command, args, options) {
  return spawn(command, args, { ...options, detached: true, stdio: options.stdio ?? "ignore" });
}

export async function waitFor(check, { timeoutMs, intervalMs, description }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise((done) => setTimeout(done, intervalMs));
  }
}

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const next = argv[i + 1];
      const hasValue = next !== undefined && !next.startsWith("--");
      flags[arg.slice(2)] = hasValue ? next : true;
      if (hasValue) i++;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}
