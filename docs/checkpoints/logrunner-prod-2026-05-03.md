# Logrunner Prod Checkpoint: 2026-05-03

This checkpoint records the known-good remote demo deployment state.

## Remote

- VM: `root@128.140.8.205`
- Agent folder: `logrunner-prod`
- Discord platform: `discord:1500432044038291466:1500432046852411496`
- Provider: `opencode`
- OpenAI base URL: `https://api.openai.com/v1`
- Default MultiBaas backend: `https://xc3cfwaywze7vcvhnzzvpobuq4.multibaas.com/`

## Commits

- Runtime/deploy rails: `06a9187722373cf590393ef6ef3575d8e76f4721`
- NanoClaw: `1b80c4129b15f1077ad2d0a85571015b3439fce2`

## Remote Manifest

```json
{
  "deployedAt": "2026-05-03T13:28:55Z",
  "runtimeCommit": "06a9187722373cf590393ef6ef3575d8e76f4721",
  "runtimeRelease": "/opt/logrunner-prod/releases/runtime-06a9187722373cf590393ef6ef3575d8e76f4721",
  "nanoclawCommit": "1b80c4129b15f1077ad2d0a85571015b3439fce2",
  "nanoclawRelease": "/opt/logrunner-prod/releases/nanoclaw-1b80c4129b15f1077ad2d0a85571015b3439fce2",
  "discordPlatformId": "discord:1500432044038291466:1500432046852411496",
  "agentFolder": "logrunner-prod",
  "agentProvider": "opencode",
  "openaiBaseUrl": "https://api.openai.com/v1",
  "multibaasBaseUrl": "https://xc3cfwaywze7vcvhnzzvpobuq4.multibaas.com/"
}
```

## Service Status

Verified active on the VM:

- `logrunner-prod.service`
- `logrunner-prod-webhook.service`
- `caddy.service`

## Liveness Checks

Backend profile check:

```text
Configured backends:
- `arbitrum-one-remote` - Arbitrum One (42161)
- `mainnet-remote` - Ethereum Mainnet (1)
```

Incident brief check:

```text
Brief: Security Council action froze `30,765.667501709008927568` ETH tied to the KelpDAO / rsETH incident, and the frozen funds sit at `0x0000000000000000000000000000000000000DA0`. Releasing them needs Arbitrum governance to move onchain.
```

Control-plane verification check:

```text
Verdict: yes, live event data shows Arbitrum governance control-plane activity.
```

## Restore / Redeploy

Deploy this checkpoint with:

```bash
cd /Users/danielbriskin/git/dbxe/amanita-deploy-rails
LOGRUNNER_REF=06a9187722373cf590393ef6ef3575d8e76f4721 \
NANOCLAW_REF=1b80c4129b15f1077ad2d0a85571015b3439fce2 \
scripts/deploy-logrunner-prod.sh
```

The deployed commits are also tagged as `logrunner-prod-working-2026-05-03` in their respective repositories.
