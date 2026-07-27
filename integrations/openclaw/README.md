# Ting Ting OpenClaw integration

This package contains the restricted `tingting-operations` Skill and
deterministic `tingtingctl` adapter.

## Configure

Set these values in the dedicated OpenClaw agent's secret/environment
configuration. Never write the token into the Skill, chat history, or a checked
in file.

```text
TINGTING_API_BASE_URL=https://<production-host>/api/automation/v1
TINGTING_AUTOMATION_TOKEN=<show-once-token>
TINGTING_DEFAULT_TIMEZONE=America/Vancouver
TINGTING_INPUT_DIRECTORY=/workspace/imports
```

The base URL is fixed at process startup. The CLI rejects arbitrary URL
arguments, non-HTTPS production hosts, path traversal, shell fragments, and
files outside `TINGTING_INPUT_DIRECTORY`.

## Install

Expose `skills/tingting-operations/scripts/tingtingctl.mjs` as the only allowed
executable for the dedicated OpenClaw agent. Configure its sandbox with:

- browser denied;
- general network denied except the exact Ting Ting API host;
- general shell and package installation denied;
- database, provider, hosting, and Cron tools denied;
- workspace access restricted to the dedicated workspace/import directory;
- owner sender/channel allowlist enabled.

Run the fake-server suite with:

```bash
pnpm --dir integrations/openclaw test
```

