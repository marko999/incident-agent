#!/bin/bash
set -e

echo "=== Incident Test Scripts ==="
echo ""
echo "First, port-forward the demo app:"
echo "  kubectl port-forward -n demo-app svc/demo-app 8080:80"
echo ""

APP_URL="${APP_URL:-http://localhost:8080}"

case "${1:-menu}" in
  memory-leak)
    echo "Triggering memory leak..."
    curl -s -X POST "$APP_URL/chaos/memory-leak" | jq .
    echo ""
    echo "Memory leak active. Watch with:"
    echo "  curl -s $APP_URL/chaos/status | jq .memoryUsage"
    echo "Alert should fire in ~30s (HighMemoryUsage)"
    ;;

  cpu-spike)
    echo "Triggering CPU spike..."
    curl -s -X POST "$APP_URL/chaos/cpu-spike" | jq .
    echo ""
    echo "CPU spike active. Alert should fire in ~30s (HighCPUUsage)"
    ;;

  error-rate)
    echo "Setting error rate to 50%..."
    curl -s -X POST "$APP_URL/chaos/error-rate" -H 'Content-Type: application/json' -d '{"rate": 50}' | jq .
    echo ""
    echo "Now generating traffic to trigger the alert..."
    for i in $(seq 1 100); do
      curl -s -o /dev/null "$APP_URL/api/data" &
    done
    wait
    echo "Traffic sent. Alert should fire in ~30s (HighErrorRate)"
    ;;

  slow-responses)
    echo "Enabling slow responses (5s delay)..."
    curl -s -X POST "$APP_URL/chaos/slow-responses" -H 'Content-Type: application/json' -d '{"delayMs": 5000}' | jq .
    echo ""
    echo "Now generating traffic to trigger the alert..."
    for i in $(seq 1 20); do
      curl -s -o /dev/null "$APP_URL/api/data" &
    done
    wait
    echo "Traffic sent. Alert should fire in ~30s (HighLatency)"
    ;;

  reset)
    echo "Resetting all chaos..."
    curl -s -X POST "$APP_URL/chaos/reset" | jq .
    ;;

  status)
    echo "Current chaos status:"
    curl -s "$APP_URL/chaos/status" | jq .
    ;;

  *)
    echo "Usage: $0 <scenario>"
    echo ""
    echo "Scenarios:"
    echo "  memory-leak     - Start allocating 10MB every 500ms"
    echo "  cpu-spike       - Burn CPU in tight loop"
    echo "  error-rate      - Return 500 for 50% of requests"
    echo "  slow-responses  - Add 5s delay to all responses"
    echo "  reset           - Stop all chaos"
    echo "  status          - Show current chaos state"
    ;;
esac
