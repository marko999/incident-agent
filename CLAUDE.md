# Incident Agent — Project Context

## What this is
An AI-powered incident response agent. A demo app runs in AKS with intentional bugs behind feature flags. When chaos is triggered, alerts fire, and the agent investigates, finds the root cause, fixes the code, and creates a PR.

## Infrastructure

### AKS Cluster
- Name: `aks-incident-demo`
- Resource group: `rg-incident-agent`
- Kubeconfig: `~/.kube/aks-incident-demo.config`
- Always use: `kubectl --kubeconfig ~/.kube/aks-incident-demo.config`
- NEVER use the default kubeconfig (that's a production GKE cluster)

### Namespaces
- `demo-app`: demo app (2 replicas), Redis (1 replica), agent webhook
- `monitoring`: Prometheus, AlertManager, Grafana

### Azure Container Registry
- Name: `acraksincidentdemo9968`
- Build: `az acr build --registry acraksincidentdemo9968 --image demo-app:latest demo-app/`
- After build: `kubectl --kubeconfig ~/.kube/aks-incident-demo.config rollout restart deployment/demo-app -n demo-app`

### Azure OpenAI
- Resource: `mvucinic-test` in `rg-mvucinic-6713`
- Endpoint: `https://mvucinic-test.cognitiveservices.azure.com/`
- Deployment: `gpt-53` (gpt-5.3-chat model)
- Auth: `AzureCliCredential` (no API key needed, uses `az login`)

### GitHub
- Repo: `marko999/incident-agent`
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
| memory-leak | `./scripts/05-test-incident.sh memory-leak` | HighMemoryUsage | Enables requestLogging, sends 500 requests |
| cpu-spike | `./scripts/05-test-incident.sh cpu-spike` | HighCPUUsage | Enables search, sends pathological regex input |
| error-rate | `./scripts/05-test-incident.sh error-rate` | HighErrorRate | Enables userEnrichment, sends invalid user IDs |
| slow-responses | `./scripts/05-test-incident.sh slow-responses` | HighLatency | Enables configDriven, sends concurrent requests |
| db-conn-leak | `./scripts/05-test-incident.sh db-conn-leak` | HighErrorRate | Enables dbCache, sends traffic to exhaust Redis connections |
| db-slow-query | `./scripts/05-test-incident.sh db-slow-query` | HighLatency | Enables dbSessions, seeds 5000 keys, triggers KEYS * scan |

**Infra bugs (kubectl mutations):**
| Scenario | Command | Alert | What it does |
|---|---|---|---|
| scale-down | `./scripts/05-test-incident.sh scale-down` | PodReplicaCountLow | Scales demo-app to 1 replica |
| resource-squeeze | `./scripts/05-test-incident.sh resource-squeeze` | ContainerOOMKilled | Sets memory limit to 100Mi |
| crash-loop | `./scripts/05-test-incident.sh crash-loop` | PodCrashLooping | Injects NODE_OPTIONS=--max-old-space-size=10 |
| db-down | `./scripts/05-test-incident.sh db-down` | HighErrorRate | Scales Redis to 0 (then enable dbCache + send traffic) |

### Checking if alert fired
```bash
kubectl --kubeconfig ~/.kube/aks-incident-demo.config exec -n monitoring statefulset/prometheus-prometheus-kube-prometheus-prometheus -- wget -qO- http://localhost:9090/api/v1/rules 2>/dev/null | python3 -c "import sys,json; rules=[r for g in json.load(sys.stdin)['data']['groups'] for r in g['rules']]; [print(r['name'], '-', r['state']) for r in rules if 'demo-app' in r.get('labels',{}).get('service','')]"
```

### Resetting after a scenario

After each test, FULLY reset:

1. **Disable all feature flags** (if app is reachable):
```bash
for f in requestLogging searchEnabled userEnrichment configDriven dbCache dbSessions; do
  curl -s -X POST "http://localhost:8080/features/disable/$f" 2>/dev/null
done
```

2. **Undo infra changes:**
```bash
KUBECTL="kubectl --kubeconfig ~/.kube/aks-incident-demo.config"
$KUBECTL scale deployment demo-app -n demo-app --replicas=2
$KUBECTL scale deployment redis -n demo-app --replicas=1 2>/dev/null
$KUBECTL patch deployment demo-app -n demo-app --type=json -p='[{"op":"replace","path":"/spec/template/spec/containers/0/resources/limits/memory","value":"512Mi"}]' 2>/dev/null
$KUBECTL set env deployment/demo-app -n demo-app NODE_OPTIONS- 2>/dev/null
$KUBECTL rollout status deployment/demo-app -n demo-app --timeout=60s
```

3. **Clean up agent's git branches:**
```bash
# Delete remote fix branches
git branch -r | grep 'origin/fix/' | sed 's|origin/||' | xargs -I{} git push origin --delete {} 2>/dev/null
# Delete local fix branches
git branch | grep 'fix/' | xargs git branch -D 2>/dev/null
# Close open PRs
gh pr list --repo marko999/incident-agent --state open --json number --jq '.[].number' | xargs -I{} gh pr close {} --repo marko999/incident-agent 2>/dev/null
```

4. **Delete agent workdir** so next run starts fresh:
```bash
rm -rf /tmp/incident-agent-workdir
```

5. **Wait for alerts to resolve** (~1-2 min after reset) before running next scenario.

Or use the script: `./scripts/05-test-incident.sh reset` (handles steps 1-2 but not 3-4).

## Project Structure

```
agent/
  tools.py          # 12 tools: kubectl (5), code (3), github (4)
  single_agent.py   # Single-agent scenario using Azure OpenAI gpt-5.3-chat
  multi_agent.py    # (not yet built) Two-agent orchestration
  run.py            # Entry point: fetches alerts, runs agent
  prompt.md         # System prompt for the agent
  webhook-server.js # Receives AlertManager webhooks, deduplicates
  webhook-k8s.yaml  # K8s deployment for the webhook
demo-app/
  server.js         # The breakable app with 6 feature-flag bugs
  package.json      # express, ioredis, prom-client
  Dockerfile
  response-config.json
  k8s/
    deployment.yaml # App deployment manifest
    redis.yaml      # Redis deployment + service
monitoring/
  prometheus-values.yaml  # Helm values for kube-prometheus-stack
  alert-rules.yaml        # 7 PrometheusRule alerts
scripts/
  05-test-incident.sh     # Trigger chaos scenarios
  06-run-agent.sh         # Legacy CLI agent runner (not used with framework)
```

## Rules
- Always commit to main BEFORE running the agent (agent clones from origin)
- After rebuilding demo-app image, always restart the deployment
- The agent operates on /tmp/incident-agent-workdir, never the working directory
- AKS system alerts (KubeSchedulerDown, Watchdog, etc.) are normal noise — ignore them
