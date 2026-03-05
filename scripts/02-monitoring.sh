#!/bin/bash
set -e
source "$(dirname "$0")/../config.env"
SCRIPT_DIR="$(dirname "$0")"

echo "=== Installing Prometheus + AlertManager ==="

# Add helm repo
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Create namespace
kubectl create namespace monitoring --dry-run=client -o yaml | kubectl apply -f -

# Install kube-prometheus-stack
helm upgrade --install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --values "$SCRIPT_DIR/../monitoring/prometheus-values.yaml" \
  --wait \
  --timeout 5m

# Apply custom alert rules
kubectl apply -f "$SCRIPT_DIR/../monitoring/alert-rules.yaml"

echo ""
echo "=== Monitoring stack ready ==="
echo "Grafana:      kubectl port-forward -n monitoring svc/prometheus-grafana 3000:80"
echo "Prometheus:   kubectl port-forward -n monitoring svc/prometheus-kube-prometheus-prometheus 9090:9090"
echo "AlertManager: kubectl port-forward -n monitoring svc/prometheus-kube-prometheus-alertmanager 9093:9093"
echo ""
echo "Grafana credentials: admin / incident-demo"
