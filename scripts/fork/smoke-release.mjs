#!/usr/bin/env node
// Prove a staged release works before it is offered for deploy.
//
//   node scripts/fork/smoke-release.mjs <release-name> [--port 6795] [--model claude/claude-haiku-4-5]
//
// Starts the release as a throwaway daemon (empty home, no relay, no plugins) on a spare port,
// then runs two real scheduled agents through it:
//   A. no mode: the agent must write a file without any permission prompt, and succeed.
//   B. Always Ask: the run must fail naming the tool it waited on, with no prompt left open.
// Never touches the operator's daemon on port 6767.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, releasesDir, spawnDetached, waitFor } from "./lib.mjs";

const { positional, flags } = parseArgs(process.argv.slice(2));
const [name] = positional;
if (!name) throw new Error("Usage: smoke-release.mjs <release-name>");
const releaseDir = join(releasesDir, name);
if (!existsSync(join(releaseDir, "release.json"))) throw new Error(`${name} is not staged`);

const port = Number(flags.port ?? 6795);
const host = `127.0.0.1:${port}`;
const model = flags.model ?? "claude/claude-haiku-4-5";
const scratch = mkdtempSync(join(tmpdir(), "paseo-fork-smoke-"));
const home = join(scratch, "home");
mkdirSync(home);
const cliEntry = join(releaseDir, "packages", "cli", "dist", "index.js");

function cli(args) {
  return execFileSync(process.execPath, [cliEntry, ...args, "--host", host], { encoding: "utf8" });
}

function makeRepo(label) {
  const dir = join(scratch, label);
  mkdirSync(dir);
  execFileSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# smoke\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync(
    "git",
    ["-c", "user.email=smoke@localhost", "-c", "user.name=smoke", "commit", "-qm", "init"],
    {
      cwd: dir,
    },
  );
  return dir;
}

const prompt =
  "Create a file named smoke-proof.txt in the current directory containing the word ok, using a tool. Then reply with exactly: done";

function createSchedule(cwd, mode) {
  const modeArgs = mode ? ["--mode", mode] : [];
  const created = JSON.parse(
    cli([
      "schedule",
      "create",
      "--provider",
      model,
      ...modeArgs,
      "--cwd",
      cwd,
      "--every",
      "1h",
      "--run-now",
      "--max-runs",
      "1",
      "--json",
      prompt,
    ]),
  );
  return created.id;
}

async function finishedRun(scheduleId) {
  return await waitFor(
    () => {
      const inspected = JSON.parse(cli(["schedule", "inspect", scheduleId, "--json"]));
      const run = inspected.runs?.at(-1);
      return run && (run.status === "succeeded" || run.status === "failed") ? run : null;
    },
    { timeoutMs: 6 * 60_000, intervalMs: 3_000, description: `schedule ${scheduleId} to finish` },
  );
}

const daemon = spawnDetached(process.execPath, [cliEntry, "daemon", "run", "--home", home], {
  cwd: releaseDir,
  env: { ...process.env, PASEO_LISTEN: host, PASEO_RELAY_ENABLED: "false" },
  stdio: ["ignore", "ignore", "ignore"],
});

const checks = [];
let passed = false;
try {
  await waitFor(
    async () => {
      const response = await fetch(`http://${host}/api/health`).catch(() => null);
      return response?.ok ?? false;
    },
    { timeoutMs: 180_000, intervalMs: 1_000, description: "smoke daemon health" },
  );
  // Health answers before providers finish loading; schedule creation needs them.
  await waitFor(
    () => {
      try {
        cli(["schedule", "ls", "--json"]);
        return true;
      } catch {
        return false;
      }
    },
    { timeoutMs: 120_000, intervalMs: 2_000, description: "smoke daemon to accept requests" },
  );

  const repoA = makeRepo("no-mode");
  const repoB = makeRepo("always-ask");
  const runA = await finishedRun(createSchedule(repoA, null));
  const runB = await finishedRun(createSchedule(repoB, "default"));
  const proof = join(repoA, "smoke-proof.txt");
  const pending = cli(["permit", "ls"]).trim().split("\n").slice(1).filter(Boolean);

  checks.push(
    {
      check: "A (no mode) succeeded",
      ok: runA.status === "succeeded",
      detail: runA.error ?? runA.output,
    },
    {
      check: "A wrote its file",
      ok: existsSync(proof) && readFileSync(proof, "utf8").includes("ok"),
    },
    {
      check: "B (Always Ask) failed naming the tool",
      ok: runB.status === "failed" && /waiting for permission to use \w+/.test(runB.error ?? ""),
      detail: runB.error,
    },
    { check: "B left no prompt open", ok: pending.length === 0, detail: pending.join("; ") },
  );
  passed = checks.every((entry) => entry.ok);
} catch (error) {
  checks.push({ check: "smoke run completed", ok: false, detail: String(error) });
} finally {
  try {
    process.kill(-daemon.pid, "SIGTERM");
  } catch {}
  await waitFor(
    () => {
      try {
        process.kill(daemon.pid, 0);
        return false;
      } catch {
        return true;
      }
    },
    { timeoutMs: 30_000, intervalMs: 500, description: "smoke daemon to stop" },
  ).catch(() => process.kill(-daemon.pid, "SIGKILL"));
  rmSync(scratch, { recursive: true, force: true });
}

console.log(JSON.stringify({ release: name, passed, checks }, null, 2));
process.exit(passed ? 0 : 1);
