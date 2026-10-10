#!/usr/bin/env node
// Ask Ground Control to deploy a staged release to the operator's daemon.
//
//   node scripts/fork/request-deploy.mjs <release-name> --agent <requesting-agent-id> --reason "<why>"
//
// Only run this after the operator approved the deploy in chat. Ground Control waits for the
// harness to go quiet, restarts the daemon on the new release, rolls back if it is unhealthy,
// and then messages the requesting agent with the outcome. End your turn after submitting:
// the restart waits for running turns, including yours.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deployService, groundControlInbox, parseArgs, readReleaseManifest } from "./lib.mjs";

const { positional, flags } = parseArgs(process.argv.slice(2));
const [release] = positional;
if (!release || typeof flags.agent !== "string" || typeof flags.reason !== "string") {
  throw new Error('Usage: request-deploy.mjs <release-name> --agent <agent-id> --reason "<why>"');
}
if (!readReleaseManifest(release)) throw new Error(`${release} is not staged`);
if (!existsSync(groundControlInbox))
  throw new Error(`Ground Control inbox not found: ${groundControlInbox}`);

const id = `paseo-deploy-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
const command = {
  id,
  target: deployService,
  action: "deploy",
  release,
  requested_by: `agent:${flags.agent}`,
  requested_at: new Date().toISOString(),
  reason: flags.reason,
};

// Write beside the inbox and rename in, so Ground Control never reads a partial file.
const staging = join(groundControlInbox, "..", "tmp");
mkdirSync(staging, { recursive: true });
const temp = join(staging, `${id}.json`);
writeFileSync(temp, `${JSON.stringify(command, null, 2)}\n`);
renameSync(temp, join(groundControlInbox, `${id}.json`));

console.log(JSON.stringify({ submitted: id, release }, null, 2));
