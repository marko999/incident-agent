# Incident Agent

An autonomous AI agent that responds to production incidents end-to-end: detects alerts, investigates with kubectl, reads source code, identifies the root cause, writes a fix, and opens a pull request — all without human intervention.

Built with [Microsoft Agent Framework](https://github.com/microsoft/agent-framework) + Azure OpenAI, running on AKS with Prometheus/AlertManager.

```
  Alert fires            Agent investigates         Agent fixes & opens PR
  HighErrorRate  ──>  kubectl logs, describe  ──>  fix/high-error-rate-20260307
  PodCrashLoop         read source code             "Fix: null ref in enrichUser()"
  OOMKilled            root cause analysis           + full incident report
```

## How It Works

```
┌──────────────┐     ┌───────────────┐     ┌──────────────┐     ┌────────────┐
│   Demo App   │────>│  Prometheus   │────>│ AlertManager │────>│  Webhook   │
│  (with bugs) │     │  (monitoring) │     │  (routing)   │     │  Receiver  │
└──────────────┘     └───────────────┘     └──────────────┘     └─────┬──────┘
                                                                      │
                                                                      v
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Incident Agent                                     │
│                                                                             │
│  1. Fetch alert details                                                     │
│  2. kubectl logs/describe/top/events  ──>  gather evidence                  │
│  3. Read source code (server.js, k8s manifests)                             │
│  4. Root cause analysis                                                     │
│  5. Write fix with write_file                                               │
│  6. git branch → commit → push → create PR                                 │
│                                                                             │
│  Tools: kubectl_get, kubectl_describe, kubectl_logs, kubectl_top,           │
│         kubectl_events, list_files, read_file, write_file,                  │
│         git_create_branch, git_diff, git_commit_and_push,                   │
│         create_pull_request                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Chaos Scenarios

The demo app has intentional bugs hidden behind feature flags, plus infrastructure misconfigurations the agent must diagnose and fix.

### Code Bugs

| Scenario | Alert | Root Cause |
|---|---|---|
| `error-rate` | HighErrorRate | Null reference — `enrichUser()` accesses missing profile |
| `db-conn-leak` | HighErrorRate | New Redis client created per request, never closed |
| `process-crash` | PodCrashLooping | Unhandled async exception calling undefined method |

### Infrastructure Bugs

| Scenario | Alert | Root Cause |
|---|---|---|
| `scale-down` | PodReplicaCountLow | Deployment scaled to 1 replica |
| `resource-squeeze` | ContainerOOMKilled | Memory limit set to 100Mi (too low) |
| `crash-loop` | PodCrashLooping | `NODE_OPTIONS=--max-old-space-size=10` causes OOM on startup |
| `db-down` | HighErrorRate | Redis scaled to 0 — all cache operations fail |

## Quick Start

### Prerequisites

- Azure subscription with AKS
- `az`, `kubectl`, `gh`, `python 3.13+`
- Azure OpenAI resource with a chat model deployment

### Setup

```bash
# 1. Clone and configure
git clone https://github.com/YOUR_ORG/incident-agent.git
cd incident-agent
cp config.env.example config.env   # fill in your values

# 2. Provision infrastructure
./scripts/01-cluster.sh            # AKS cluster
./scripts/02-monitoring.sh         # Prometheus + AlertManager + Grafana
./scripts/03-deploy-app.sh         # Demo app + Redis
./scripts/04-deploy-webhook.sh     # Alert webhook receiver

# 3. Install agent dependencies
python -m venv .venv
source .venv/bin/activate
pip install -r agent/requirements.txt
```

### Run a Scenario

```bash
source .venv/bin/activate
source config.env

# Terminal 1: port-forward the demo app
kubectl --kubeconfig ~/.kube/aks-incident-demo.config \
  port-forward -n demo-app svc/demo-app 8080:80

# Terminal 2: trigger an incident
./scripts/05-test-incident.sh error-rate

# Terminal 3: run the agent
cd agent && python run.py --alert HighErrorRate
```

The agent will investigate the alert, find the buggy code, fix it, and open a PR with a full incident report.

### Poll Mode (Automated)

```bash
cd agent && python run.py --poll 30
```

The agent polls the webhook for new alerts every 30 seconds and handles them autonomously.

## Tech Stack

| Component | Technology |
|---|---|
| Agent framework | [Microsoft Agent Framework](https://github.com/microsoft/agent-framework) (Python) |
| LLM | Azure OpenAI (GPT) |
| Demo app | Node.js + Express + Redis |
| Monitoring | Prometheus + AlertManager + Grafana |
| Infrastructure | AKS (Azure Kubernetes Service) |
| CI/CD | GitHub CLI (`gh`) for PR automation |

## Project Structure

```
agent/
  single_agent.py     # Agent orchestration — creates agent with 12 tools
  tools.py            # Tool definitions: kubectl, code read/write, git/GitHub
  run.py              # Entry point: fetch alerts, dispatch to agent
  prompt.md           # System prompt (investigation playbook)
  webhook-server.js   # Receives AlertManager webhooks
  Dockerfile          # Agent container image
  k8s/                # K8s manifests for in-cluster agent deployment
demo-app/
  server.js           # Express app with feature-flag bugs
  Dockerfile
  k8s/                # Deployment, Service, ServiceMonitor, Redis
monitoring/
  prometheus-values.yaml   # kube-prometheus-stack Helm values
  alert-rules.yaml         # PrometheusRule definitions (7 alerts)
scripts/
  01-cluster.sh       # Provision AKS
  02-monitoring.sh    # Deploy Prometheus stack
  03-deploy-app.sh    # Build & deploy demo app
  04-deploy-webhook.sh
  05-test-incident.sh # Trigger chaos scenarios + reset
```

## Agent Tools

The agent has 12 tools organized in three categories:

**Cluster Investigation** — gather evidence from the running cluster:
- `kubectl_get` — list pods, deployments, services
- `kubectl_describe` — detailed resource info, events, env vars
- `kubectl_logs` — application logs (including crashed containers)
- `kubectl_top` — CPU/memory usage
- `kubectl_events` — OOM kills, restarts, scheduling failures

**Code Analysis** — explore and modify the source:
- `list_files` — browse repository structure
- `read_file` — examine source code and configs
- `write_file` — apply fixes

**Git & GitHub** — deliver the fix:
- `git_create_branch` — branch from main
- `git_diff` — review changes
- `git_commit_and_push` — commit and push
- `create_pull_request` — open PR with incident report

## License

MIT
