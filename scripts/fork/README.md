# Fork release pipeline (devorbitus only)

`main` on devorbitus/paseo is the newest stable upstream tag plus a short stack of fork-only
commits, one per change. These scripts keep it current and get it onto the operator's daemon.
Not for upstream.

| Step                                                                 | Script                         | Who runs it                          |
| -------------------------------------------------------------------- | ------------------------------ | ------------------------------------ |
| Rebase the patch stack onto the newest stable tag                    | `sync-upstream.mjs`            | release agent                        |
| Build a commit into `~/.paseo-fork/releases/<tag>-fork.<sha>`        | `stage-release.mjs`            | release agent                        |
| Run the build as a throwaway daemon with real scheduled agents       | `smoke-release.mjs <release>`  | release agent                        |
| Submit the deploy after the operator approves it in chat             | `request-deploy.mjs <release>` | release agent                        |
| Hold the restart until no agent is mid-turn (15 min cap)             | `quiet-wait.mjs`               | Ground Control `pre_deploy_command`  |
| Tell interrupted agents to continue; report to the requester         | `nudge.mjs`                    | Ground Control `post_deploy_command` |
| Run the release's daemon with the operator's login-shell environment | `run-daemon.sh <home>`         | Ground Control `start_command`       |

Ground Control's `paseo-daemon` service runs `~/.paseo-fork/current` against `~/.paseo` on
port 6767. Deploying repoints `current` and restarts; an unhealthy release is rolled back to
the previous one automatically. The desktop app runs with its built-in daemon turned off and
attaches to this one.

Rules that the scripts don't enforce:

- Every deploy restarts the operator's main daemon, which interrupts every running agent. Only
  submit one after the operator approved it in chat.
- A patch upstream ships verbatim drops out during the rebase. A patch upstream fixed
  differently is dropped only when its regression tests pass on upstream's code.
- Releases are never edited after staging. Fix the commit and stage a new release.

The release agent follows the `paseo-fork-release` skill in `scripts/fork/skill/SKILL.md`.

## Personal iOS app

The fork's iOS app ("Paseo (devorbitus)", `com.devorbitus.paseo`) installs beside the App Store
app and ships to TestFlight. One-time account setup, run at the Mac:

```bash
scripts/fork/ios-setup-wizard.sh
```

It saves non-secret values to `~/.paseo-fork/ios.env` and the App Store Connect API key and Expo
token to the login Keychain.
