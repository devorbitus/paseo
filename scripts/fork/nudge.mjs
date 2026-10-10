#!/usr/bin/env node
// Ground Control post_deploy hook: resume interrupted agents and report the outcome.
//
// Reads the record quiet-wait.mjs wrote, tells each agent that was still mid-turn at restart to
// continue, and messages the requesting agent with the deploy result. Runs after the daemon is
// back up (deployed or rolled back); does nothing to agents if the daemon is down.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cli, deploysDir } from "./lib.mjs";

const deployId = process.env.GC_DEPLOY_ID;
if (!deployId) throw new Error("GC_DEPLOY_ID is not set; run this as a Ground Control hook");
const outcome = process.env.GC_DEPLOY_OUTCOME ?? "failed";
const release = process.env.GC_DEPLOY_RELEASE ?? "unknown";
const previous = process.env.GC_DEPLOY_PREVIOUS_RELEASE || "none";
const detail = process.env.GC_DEPLOY_MESSAGE ?? "";
const recordPath = join(deploysDir, `${deployId}.json`);
const record = existsSync(recordPath)
  ? JSON.parse(readFileSync(recordPath, "utf8"))
  : { interrupted: [], requester: null };

const daemonUp = outcome === "deployed" || outcome === "rolled_back";
if (!daemonUp) {
  console.log(JSON.stringify({ outcome, nudged: [], reported: false, reason: "daemon is down" }));
  process.exit(0);
}

const runningRelease = outcome === "deployed" ? release : previous;
const nudged = [];
for (const agent of record.interrupted) {
  try {
    cli([
      "send",
      "--no-wait",
      agent.id,
      agent.work === "background"
        ? `The Paseo harness restarted for a deploy (now running ${runningRelease}), which stopped your background work (shells, monitors or subagents). Restart whatever you still need and continue.`
        : `The Paseo harness restarted for a deploy (now running ${runningRelease}), which interrupted your turn. Continue where you left off.`,
    ]);
    nudged.push(agent.id);
  } catch (error) {
    console.error(`Could not nudge ${agent.id}: ${error}`);
  }
}

let reported = false;
const requester =
  (process.env.GC_DEPLOY_REQUESTED_BY ?? "").replace(/^agent:/, "") || record.requester;
if (requester) {
  const summary =
    outcome === "deployed"
      ? `Deploy ${deployId} finished: the daemon is healthy on ${release} (was ${previous}).`
      : `Deploy ${deployId} rolled back: ${release} failed its health check, so the daemon is back on ${previous}. ${detail}`;
  try {
    cli([
      "send",
      "--no-wait",
      requester,
      `${summary} Agents resumed after the restart: ${nudged.length}. Tell the operator the result.`,
    ]);
    reported = true;
  } catch (error) {
    console.error(`Could not report to ${requester}: ${error}`);
  }
}

console.log(JSON.stringify({ outcome, nudged, reported }));
