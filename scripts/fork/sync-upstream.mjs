#!/usr/bin/env node
// Rebase the fork's patch stack (fork/main) onto the newest stable upstream tag.
//
// Exit codes: 0 rebased or already current, 2 stopped on a conflict (the rebase is left in
// progress for the release agent to resolve), 1 anything else.
// Prints a JSON report: previous and new base tag, patches kept, patches dropped.
import { git, forkBaseTag, latestStableTag, parseArgs } from "./lib.mjs";

const { flags } = parseArgs(process.argv.slice(2));
const branch = flags.branch ?? "fork/main";

git(["fetch", "upstream", "--tags", "--quiet"]);
const target = flags.tag ?? latestStableTag();
const previousBase = forkBaseTag(branch);

function patchSubjects(base, ref) {
  const log = git(["log", "--reverse", "--format=%s", `${base}..${ref}`]);
  return log ? log.split("\n") : [];
}

const before = patchSubjects(previousBase, branch);
if (previousBase === target) {
  console.log(JSON.stringify({ status: "up_to_date", base: target, patches: before }, null, 2));
  process.exit(0);
}

if (git(["rev-parse", "--abbrev-ref", "HEAD"]) !== branch) {
  throw new Error(`Run from a worktree with ${branch} checked out`);
}

try {
  // --empty=drop retires patches upstream has already applied verbatim.
  git(["rebase", "--empty=drop", "--onto", target, previousBase, branch]);
} catch {
  const conflicted = git(["diff", "--name-only", "--diff-filter=U"]);
  console.log(
    JSON.stringify(
      {
        status: "conflict",
        previous_base: previousBase,
        target,
        conflicted_files: conflicted ? conflicted.split("\n") : [],
        next: "Resolve, `git add`, `git rebase --continue`, then run sync-upstream again.",
      },
      null,
      2,
    ),
  );
  process.exit(2);
}

const after = patchSubjects(target, branch);
console.log(
  JSON.stringify(
    {
      status: "rebased",
      previous_base: previousBase,
      base: target,
      patches: after,
      dropped: before.filter((subject) => !after.includes(subject)),
    },
    null,
    2,
  ),
);
