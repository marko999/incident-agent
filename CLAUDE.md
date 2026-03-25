# Incident Agent — Project Context

## What this is
An AI-powered incident response agent. A demo app runs in AKS with intentional bugs behind feature flags. When chaos is triggered, alerts fire, and the agent investigates, finds the root cause, fixes the code, and creates a PR.

## Infrastructure

### AKS Cluster
- Kubeconfig: `~/.kube/aks-incident-demo.config`
- Always use: `kubectl --kubeconfig ~/.kube/aks-incident-demo.config`
- NEVER use the default kubeconfig

### Namespaces
- `demo-app`: demo app (2 replicas), Redis (1 replica), agent webhook
- `monitoring`: Prometheus, AlertManager, Grafana

### Azure Container Registry
- Build: `az acr build --registry $ACR_NAME --image demo-app:latest demo-app/`
- After build: `kubectl --kubeconfig ~/.kube/aks-incident-demo.config rollout restart deployment/demo-app -n demo-app`

### Azure OpenAI
- Auth: `DefaultAzureCredential` (no API key needed, uses `az login`)
- Endpoint and deployment name configured via `config.env`

### GitHub
- Auth: `gh` CLI (already authenticated)

## Running the Agent

```bash
# Always activate venv and source config first
source .venv/bin/activate
source config.env

# Run against a specific alert type
cd agent && python run.py --alert HighErrorRate

# Run against live pending alerts from webhook
cd agent && python run.py

# Poll mode
cd agent && python run.py --poll 30
```

The agent clones the repo to `/tmp/incident-agent-workdir` for its git operations — it never touches your working directory.

## Port-Forward

Many tests require port-forwarding the demo app:

```bash
kubectl --kubeconfig ~/.kube/aks-incident-demo.config port-forward -n demo-app svc/demo-app 8080:80
```

Run this in the background before triggering chaos scenarios that need HTTP access to the app.

## Chaos Scenarios

### Triggering
```bash
./scripts/05-test-incident.sh <scenario>
```

### Available Scenarios

**Code bugs (feature flag + traffic):**
| Scenario | Command | Alert | What it does |
|---|---|---|---|
| error-rate | `./scripts/05-test-incident.sh error-rate` | HighErrorRate | Enables userEnrichment, sends invalid user IDs |
| db-conn-leak | `./scripts/05-test-incident.sh db-conn-leak` | HighErrorRate | Enables dbCache, sends traffic to exhaust Redis connections |
| process-crash | `./scripts/05-test-incident.sh process-crash` | PodCrashLooping | Enables asyncProcessing, triggers unhandled exception |

**Infra bugs (kubectl mutations):**
| Scenario | Command | Alert | What it does |
|---|---|---|---|
| scale-down | `./scripts/05-test-incident.sh scale-down` | PodReplicaCountLow | Scales demo-app to 1 replica |
| resource-squeeze | `./scripts/05-test-incident.sh resource-squeeze` | ContainerOOMKilled | Sets memory limit to 100Mi |
| crash-loop | `./scripts/05-test-incident.sh crash-loop` | PodCrashLooping | Injects NODE_OPTIONS=--max-old-space-size=10 |
| db-down | `./scripts/05-test-incident.sh db-down` | HighErrorRate | Scales Redis to 0 (then enable dbCache + send traffic) |

### Resetting after a scenario

```bash
./scripts/05-test-incident.sh reset
```

## Project Structure

```
agent/
  tools.py          # 12 tools: kubectl (5), code (3), github (4)
  single_agent.py   # Single-agent scenario using Azure OpenAI
  run.py            # Entry point: fetches alerts, runs agent
  prompt.md         # System prompt for the agent
  webhook-server.js # Receives AlertManager webhooks, deduplicates
  webhook-k8s.yaml  # K8s deployment for the webhook
  Dockerfile        # Agent container image
  entrypoint.sh     # Container entrypoint
  k8s/              # K8s manifests for agent deployment
demo-app/
  server.js         # The breakable app with feature-flag bugs
  package.json      # express, ioredis, prom-client
  Dockerfile
  k8s/
    deployment.yaml # App deployment manifest
    redis.yaml      # Redis deployment + service
monitoring/
  prometheus-values.yaml  # Helm values for kube-prometheus-stack
  alert-rules.yaml        # PrometheusRule alert definitions
scripts/
  05-test-incident.sh     # Trigger chaos scenarios
```

## Rules
- Always commit to main BEFORE running the agent (agent clones from origin)
- After rebuilding demo-app image, always restart the deployment
- The agent operates on /tmp/incident-agent-workdir, never the working directory
- AKS system alerts (KubeSchedulerDown, Watchdog, etc.) are normal noise — ignore them
