#!/usr/bin/env node
// Build the fork's personal iOS app and upload it to TestFlight.
//
//   node scripts/fork/ios-release.mjs [--ref fork/main] [--force]
//
// Skips when nothing that ships in the app changed since the last upload (--force builds anyway).
// Builds locally with `eas build --local` (the Mac's Xcode, no EAS cloud minutes) in a scratch
// checkout, then `eas submit`s the .ipa. TestFlight offers it to the operator's phone; uploading
// needs no approval because it doesn't touch the daemon or any agent.
//
// Needs the one-time setup from scripts/fork/ios-setup-wizard.sh: ~/.paseo-fork/ios.env and the
// Keychain items paseo-fork-asc-api-key and paseo-fork-expo-token.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { forkHome, git, parseArgs, run } from "./lib.mjs";

const { flags } = parseArgs(process.argv.slice(2));
const ref = flags.ref ?? "fork/main";
const iosEnvPath = join(forkHome, "ios.env");
const lastShippedPath = join(forkHome, "ios-last.json");
const buildDir = join(forkHome, "ios-build");
// What ends up in the app binary. Daemon-only changes don't need a new iOS build.
const appPaths = [
  "packages/app",
  "packages/client",
  "packages/protocol",
  "packages/plugin",
  "packages/highlight",
  "packages/expo-two-way-audio",
  "patches",
  "package-lock.json",
];

function readIosEnv() {
  if (!existsSync(iosEnvPath)) {
    throw new Error(`${iosEnvPath} is missing; run scripts/fork/ios-setup-wizard.sh first`);
  }
  const values = {};
  for (const line of readFileSync(iosEnvPath, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) values[match[1]] = match[2];
  }
  for (const key of ["APPLE_TEAM_ID", "ASC_APP_ID", "ASC_KEY_ID", "ASC_ISSUER_ID", "EXPO_OWNER"]) {
    if (!values[key]) throw new Error(`${key} is missing from ${iosEnvPath}; rerun the wizard`);
  }
  return values;
}

function writeIosEnv(key, value) {
  const lines = readFileSync(iosEnvPath, "utf8")
    .split("\n")
    .filter((line) => line && !line.startsWith(`${key}=`));
  writeFileSync(iosEnvPath, `${[...lines, `${key}=${value}`].join("\n")}\n`);
}

function keychain(service) {
  return execFileSync(
    "security",
    ["find-generic-password", "-a", process.env.USER, "-s", service, "-w"],
    {
      encoding: "utf8",
    },
  ).trim();
}

function eas(args, env, options = {}) {
  return execFileSync("npx", ["--no-install", "eas", ...args], {
    cwd: join(buildDir, "packages", "app"),
    env,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
}

const sha = git(["rev-parse", ref]);
const last = existsSync(lastShippedPath) ? JSON.parse(readFileSync(lastShippedPath, "utf8")) : null;
if (last && !flags.force) {
  const changed = git(["diff", "--name-only", `${last.sha}..${sha}`, "--", ...appPaths]);
  if (!changed) {
    console.log(JSON.stringify({ status: "unchanged", sha, last_shipped: last }, null, 2));
    process.exit(0);
  }
}

const iosEnv = readIosEnv();
const ascKeyDir = mkdtempSync(join(tmpdir(), "paseo-fork-asc-"));
const ascKeyPath = join(ascKeyDir, `AuthKey_${iosEnv.ASC_KEY_ID}.p8`);
writeFileSync(ascKeyPath, Buffer.from(keychain("paseo-fork-asc-api-key"), "base64"), {
  mode: 0o600,
});

try {
  // A scratch checkout: eas.json gets the operator's App Store Connect app id, and native build
  // output never lands in the fork worktree or a deploy release.
  mkdirSync(forkHome, { recursive: true });
  if (existsSync(buildDir)) {
    git(["checkout", "--detach", "--force", sha], { cwd: buildDir });
    git(["clean", "-fdx", "-e", "node_modules"], { cwd: buildDir });
  } else {
    git(["worktree", "add", "--detach", buildDir, sha]);
  }
  run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: buildDir });
  // The JS bundle imports these workspace packages from their built output.
  run("npm", ["run", "build:client"], { cwd: buildDir });
  run("npm", ["run", "build:plugin"], { cwd: buildDir });
  run("npm", ["run", "build", "--workspace=@getpaseo/expo-two-way-audio"], { cwd: buildDir });

  const buildCounter = (last?.build_counter ?? 0) + 1;
  const env = {
    ...process.env,
    APP_VARIANT: "personal",
    EXPO_TOKEN: keychain("paseo-fork-expo-token"),
    EXPO_APPLE_TEAM_ID: iosEnv.APPLE_TEAM_ID,
    EXPO_ASC_API_KEY_PATH: ascKeyPath,
    EXPO_ASC_KEY_ID: iosEnv.ASC_KEY_ID,
    EXPO_ASC_ISSUER_ID: iosEnv.ASC_ISSUER_ID,
    PASEO_PERSONAL_EXPO_OWNER: iosEnv.EXPO_OWNER,
    PASEO_PERSONAL_EAS_PROJECT_ID: iosEnv.EAS_PROJECT_ID ?? "",
  };

  if (!iosEnv.EAS_PROJECT_ID) {
    // First release: create the operator's EAS project. app.config.js is dynamic, so EAS can't
    // write the id back; read it from project:info and keep it in ios.env.
    eas(["init", "--non-interactive", "--force"], env);
    const info = eas(["project:info"], env, { capture: true });
    const projectId = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/.exec(
      info,
    )?.[1];
    if (!projectId) throw new Error(`Could not read the EAS project id from:\n${info}`);
    writeIosEnv("EAS_PROJECT_ID", projectId);
    env.PASEO_PERSONAL_EAS_PROJECT_ID = projectId;
  }

  const appConfig = JSON.parse(
    execFileSync(
      process.execPath,
      ["-e", 'import("./app.config.js").then((m) => console.log(JSON.stringify(m.default.expo)))'],
      {
        cwd: join(buildDir, "packages", "app"),
        env,
        encoding: "utf8",
      },
    ),
  );
  // Stock build number per version, then a counter, so every upload is unique and increasing.
  env.PASEO_PERSONAL_IOS_BUILD_NUMBER = `${appConfig.ios.buildNumber}.${buildCounter}`;

  const easJsonPath = join(buildDir, "packages", "app", "eas.json");
  const easJson = JSON.parse(readFileSync(easJsonPath, "utf8"));
  easJson.submit.personal = { ios: { ascAppId: iosEnv.ASC_APP_ID } };
  writeFileSync(easJsonPath, `${JSON.stringify(easJson, null, 2)}\n`);

  const ipa = join(buildDir, "paseo-devorbitus.ipa");
  rmSync(ipa, { force: true });
  eas(
    [
      "build",
      "--platform",
      "ios",
      "--profile",
      "personal",
      "--local",
      "--non-interactive",
      "--output",
      ipa,
    ],
    env,
  );
  eas(
    ["submit", "--platform", "ios", "--profile", "personal", "--path", ipa, "--non-interactive"],
    env,
  );

  const shipped = {
    sha,
    version: appConfig.version,
    build_number: env.PASEO_PERSONAL_IOS_BUILD_NUMBER,
    build_counter: buildCounter,
    submitted_at: new Date().toISOString(),
  };
  writeFileSync(lastShippedPath, `${JSON.stringify(shipped, null, 2)}\n`);
  console.log(JSON.stringify({ status: "submitted", ...shipped }, null, 2));
} finally {
  rmSync(ascKeyDir, { recursive: true, force: true });
}
