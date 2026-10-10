#!/usr/bin/env node
// Ground Control pre_deploy hook: hold the restart until no agent is mid-turn.
//
// Waits up to PASEO_FORK_QUIET_TIMEOUT_SECONDS (default 900) for every agent on the operator's
// daemon to be out of a turn, ignoring the agent that requested the deploy. Whatever is still
// running when it gives up is recorded so the post_deploy hook can tell those agents to continue.
// Always exits 0: the operator already approved the deploy, so waiting is a courtesy, not a gate.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliJson, deploysDir } from "./lib.mjs";

const deployId = process.env.GC_DEPLOY_ID;
if (!deployId) throw new Error("GC_DEPLOY_ID is not set; run this as a Ground Control hook");
const requester = (process.env.GC_DEPLOY_REQUESTED_BY ?? "").replace(/^agent:/, "");
const timeoutMs = Number(process.env.PASEO_FORK_QUIET_TIMEOUT_SECONDS ?? 900) * 1000;
const busyStatuses = new Set(["running", "initializing"]);

function busyAgents() {
  const agents = cliJson(["ls", "-g"]);
  return agents
    .filter((agent) => busyStatuses.has(agent.status) && agent.id !== requester)
    .map((agent) => ({ id: agent.id, name: agent.name }));
}

const startedAt = Date.now();
let busy = busyAgents();
while (busy.length > 0 && Date.now() - startedAt < timeoutMs) {
  await new Promise((done) => setTimeout(done, 10_000));
  busy = busyAgents();
}

mkdirSync(deploysDir, { recursive: true });
const record = {
  deploy_id: deployId,
  release: process.env.GC_DEPLOY_RELEASE,
  requester: requester || null,
  waited_seconds: Math.round((Date.now() - startedAt) / 1000),
  interrupted: busy,
};
writeFileSync(join(deploysDir, `${deployId}.json`), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify(record));
