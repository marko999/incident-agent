#!/bin/bash
set -e
source "$(dirname "$0")/../config.env"
SCRIPT_DIR="$(dirname "$0")"
AGENT_DIR="$SCRIPT_DIR/../agent"

echo "=== Running Incident Agent ==="

# 1. Fetch latest alerts from webhook
WEBHOOK_URL="${WEBHOOK_URL:-http://localhost:9093}"
echo "Fetching active alerts from AlertManager..."

ALERTS=$(kubectl exec -n monitoring deploy/prometheus-kube-prometheus-alertmanager -- \
  wget -qO- http://localhost:9093/api/v2/alerts 2>/dev/null || echo "[]")

if [ "$ALERTS" = "[]" ]; then
  echo "No active alerts. Trigger an incident first:"
  echo "  ./05-test-incident.sh memory-leak"
  exit 0
fi

echo "Active alerts:"
echo "$ALERTS" | python3 -m json.tool 2>/dev/null || echo "$ALERTS"
echo ""

# 2. Fetch logs from affected pods
echo "Fetching pod logs..."
AFFECTED_PODS=$(kubectl get pods -n demo-app -o jsonpath='{.items[*].metadata.name}')
LOGS=""
for pod in $AFFECTED_PODS; do
  LOGS+="=== Logs from $pod ===\n"
  LOGS+="$(kubectl logs -n demo-app "$pod" --tail=100 2>/dev/null)\n\n"
done

# 3. Fetch pod status
echo "Fetching pod status..."
POD_STATUS=$(kubectl get pods -n demo-app -o wide 2>/dev/null)
POD_DESCRIBE=$(kubectl describe pods -n demo-app 2>/dev/null | tail -80)

# 4. Fetch resource usage
echo "Fetching resource usage..."
TOP_PODS=$(kubectl top pods -n demo-app 2>/dev/null || echo "metrics not available")

# 5. Clone/checkout the demo app repo
REPO_DIR="/tmp/incident-agent-repo"
if [ -n "$GITHUB_REPO" ]; then
  echo "Cloning repo: $GITHUB_REPO"
  rm -rf "$REPO_DIR"
  gh repo clone "$GITHUB_REPO" "$REPO_DIR" 2>/dev/null || {
    echo "Failed to clone repo, using local demo-app source"
    REPO_DIR="$SCRIPT_DIR/../demo-app"
  }
else
  echo "No GITHUB_REPO configured, using local demo-app source"
  REPO_DIR="$SCRIPT_DIR/../demo-app"
fi

# 6. Build context for the agent
CONTEXT_FILE="/tmp/incident-context.md"
cat > "$CONTEXT_FILE" << CONTEXT_EOF
# Incident Report

## Active Alerts
\`\`\`json
$ALERTS
\`\`\`

## Pod Status
\`\`\`
$POD_STATUS
\`\`\`

## Resource Usage
\`\`\`
$TOP_PODS
\`\`\`

## Pod Details
\`\`\`
$POD_DESCRIBE
\`\`\`

## Recent Logs
\`\`\`
$(echo -e "$LOGS")
\`\`\`
CONTEXT_EOF

echo ""
echo "Context written to $CONTEXT_FILE"
echo ""

# 7. Run Claude Code agent
echo "=== Launching Claude Code Agent ==="
echo ""

claude --dangerously-skip-permissions -p "$(cat "$AGENT_DIR/prompt.md")

## Current Incident Context

$(cat "$CONTEXT_FILE")

## Source Code Location
The source code is at: $REPO_DIR

## Cluster Access
You have kubectl access to the cluster. The app is in namespace 'demo-app'.
Use kubectl to gather any additional information you need.

## GitHub Repo
$([ -n "$GITHUB_REPO" ] && echo "Create a PR on: $GITHUB_REPO" || echo "No GitHub repo configured. Create a git branch with your fix and show the diff.")

Analyze the incident, find the root cause, fix the code, and create a PR with your analysis."
