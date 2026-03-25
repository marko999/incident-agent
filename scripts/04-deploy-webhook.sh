#!/bin/bash
set -e
source "$(dirname "$0")/../config.env"
SCRIPT_DIR="$(dirname "$0")"

echo "=== Deploying agent webhook receiver ==="

# The webhook receiver is a simple service that logs alerts
# In production, it triggers the agent. For demo, we port-forward and run agent locally.

kubectl apply -f "$SCRIPT_DIR/../agent/webhook-k8s.yaml"

kubectl rollout status deployment/agent-webhook -n demo-app --timeout=60s

echo ""
echo "=== Agent webhook deployed ==="
echo "Alerts from Prometheus will be sent to this service."
echo ""
echo "To watch alerts locally:"
echo "  kubectl port-forward -n demo-app svc/agent-webhook 8080:8080"
echo "  # In another terminal, watch the logs:"
echo "  kubectl logs -n demo-app -l app=agent-webhook -f"
