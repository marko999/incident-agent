# Incident Agent

An AI-powered incident response agent that automatically analyzes production alerts, finds root causes, fixes code, and creates PRs.

## Prerequisites

- `kubectl`
- `az` (Azure CLI)
- `gh` (GitHub CLI)
- `claude` (Claude Code CLI)

Run the check:

```bash
./scripts/00-prereqs.sh
```

## Cluster Access

The AKS cluster (`aks-incident-demo`) is already provisioned. Use the isolated kubeconfig — **never use your default kubeconfig**:

```bash
export KUBECONFIG=~/.kube/aks-incident-demo.config
kubectl get pods -n demo-app
```

Or pass it explicitly:

```bash
kubectl --kubeconfig ~/.kube/aks-incident-demo.config get pods -n demo-app
```

## What's Running

| Namespace | What |
|---|---|
| `demo-app` | Demo app (2 replicas) + agent webhook receiver |
| `monitoring` | Prometheus, AlertManager, Grafana |

## Testing the Agent

### Step 1 — Port-forward the demo app

In a dedicated terminal:

```bash
kubectl --kubeconfig ~/.kube/aks-incident-demo.config port-forward -n demo-app svc/demo-app 8080:80
```

### Step 2 — Trigger an incident

In another terminal, pick a scenario:

```bash
# Code bugs (enable buggy feature + generate traffic)
./scripts/05-test-incident.sh memory-leak      # unbounded request log array
./scripts/05-test-incident.sh cpu-spike        # catastrophic regex backtracking
./scripts/05-test-incident.sh error-rate       # null ref on missing user profile
./scripts/05-test-incident.sh slow-responses   # sync file read blocking event loop

# Infra bugs (apply misconfiguration via kubectl)
./scripts/05-test-incident.sh scale-down       # replicas set to 1
./scripts/05-test-incident.sh resource-squeeze # memory limit too low (100Mi)
./scripts/05-test-incident.sh crash-loop       # bad NODE_OPTIONS (10MB heap)
```

Check status or reset:

```bash
./scripts/05-test-incident.sh status
./scripts/05-test-incident.sh reset
```

### Step 3 — Wait for the alert to fire (~30s)

### Step 4 — Run the agent

```bash
./scripts/06-run-agent.sh
```

The agent will:
1. Fetch active alerts from AlertManager
2. Collect pod logs, status, and resource usage
3. Read the source code
4. Find the root cause
5. Fix the code and create a PR on `marko999/incident-agent`

## Configuration

All config lives in `config.env`:

```bash
AZURE_SUBSCRIPTION_ID="..."
RESOURCE_GROUP="rg-incident-agent"
CLUSTER_NAME="aks-incident-demo"
GITHUB_REPO="marko999/incident-agent"
export KUBECONFIG="$HOME/.kube/aks-incident-demo.config"
```

## Project Structure

```
agent/
  prompt.md            # System prompt for the Claude agent
  webhook-server.js    # Receives AlertManager webhooks
demo-app/
  server.js            # Demo app with built-in chaos endpoints
  Dockerfile
monitoring/
  prometheus-values.yaml
  alert-rules.yaml
scripts/
  00-prereqs.sh        # Check required tools
  01-cluster.sh        # Provision AKS cluster
  02-monitoring.sh     # Deploy Prometheus stack
  03-deploy-app.sh     # Deploy demo app
  04-deploy-webhook.sh
  05-test-incident.sh  # Trigger chaos scenarios
  06-run-agent.sh      # Run the agent
  99-cleanup.sh        # Tear everything down
```
