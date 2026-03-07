#!/bin/bash
set -e

source "$(dirname "$0")/../config.env"

APP_URL="${APP_URL:-http://localhost:8080}"
KUBECTL="kubectl --kubeconfig $HOME/.kube/aks-incident-demo.config"

case "${1:-menu}" in

  # ==================================================================
  # CODE SCENARIOS — enable a buggy feature, then generate traffic
  # ==================================================================

  memory-leak)
    # Bug: requestLog array grows without bound, no eviction
    echo "Enabling request logging feature (has memory leak bug)..."
    curl -s -X POST "$APP_URL/features/enable/requestLogging" | jq .
    echo ""
    echo "Generating sustained traffic to grow the request log..."
    for i in $(seq 1 500); do
      curl -s -o /dev/null "$APP_URL/api/data" &
      # Throttle to avoid overwhelming the connection pool
      [ $((i % 50)) -eq 0 ] && wait
    done
    wait
    echo ""
    echo "Traffic sent. Memory is growing. Alert should fire in ~30-60s (HighMemoryUsage)"
    echo "Watch with: curl -s $APP_URL/features | jq .memoryUsage"
    ;;

  cpu-spike)
    # Bug: catastrophic regex backtracking in search validation
    echo "Enabling search feature (has regex backtracking bug)..."
    curl -s -X POST "$APP_URL/features/enable/searchEnabled" | jq .
    echo ""
    echo "Sending pathological search queries..."
    # This input causes catastrophic backtracking: many 'a's followed by '!'
    EVIL_QUERY="aaaaaaaaaaaaaaaaaaaaaaaaaaaa!"
    for i in $(seq 1 20); do
      curl -s -o /dev/null "$APP_URL/api/search?q=$EVIL_QUERY" &
    done
    wait
    echo ""
    echo "CPU is burning on regex backtracking. Alert should fire in ~30s (HighCPUUsage)"
    ;;

  error-rate)
    # Bug: enrichUser crashes with TypeError on unknown user IDs (no null check)
    echo "Enabling user enrichment feature (has null reference bug)..."
    curl -s -X POST "$APP_URL/features/enable/userEnrichment" | jq .
    echo ""
    echo "Sending requests for non-existent user IDs..."
    for i in $(seq 1 200); do
      # User IDs 99, 100, etc. don't exist in the profiles map
      curl -s -o /dev/null "$APP_URL/api/users?id=$((i + 98))" &
      [ $((i % 50)) -eq 0 ] && wait
    done
    wait
    echo ""
    echo "Errors generated. Alert should fire in ~30s (HighErrorRate)"
    ;;

  slow-responses)
    # Bug: fs.readFileSync on every request blocks the event loop
    echo "Enabling config-driven responses (has sync I/O bug)..."
    curl -s -X POST "$APP_URL/features/enable/configDriven" | jq .
    echo ""
    echo "Sending concurrent requests to saturate the event loop..."
    for i in $(seq 1 50); do
      curl -s -o /dev/null "$APP_URL/api/data" &
    done
    wait
    echo ""
    echo "Event loop is blocked by sync reads. Alert should fire in ~30s (HighLatency)"
    ;;

  # ==================================================================
  # INFRA SCENARIOS — apply misconfigurations via kubectl
  # ==================================================================

  scale-down)
    # Bug: replica count too low for the service's availability requirements
    echo "Scaling demo-app down to 1 replica..."
    $KUBECTL scale deployment demo-app -n demo-app --replicas=1
    echo ""
    echo "Alert should fire in ~30s (PodReplicaCountLow)"
    echo "Watch: $KUBECTL get pods -n demo-app -w"
    ;;

  resource-squeeze)
    # Bug: memory limit in deployment too low for the workload
    echo "Patching memory limit to 100Mi (too low for traffic)..."
    $KUBECTL patch deployment demo-app -n demo-app --type=json \
      -p='[{"op":"replace","path":"/spec/template/spec/containers/0/resources/limits/memory","value":"100Mi"}]'
    echo ""
    echo "Pods will OOM under normal load. Alert should fire in ~60s (ContainerOOMKilled)"
    echo "Watch: $KUBECTL get pods -n demo-app -w"
    ;;

  crash-loop)
    # Bug: bad NODE_OPTIONS env var causes the process to crash on startup
    echo "Injecting bad NODE_OPTIONS (10MB heap = instant crash)..."
    $KUBECTL set env deployment/demo-app -n demo-app NODE_OPTIONS="--max-old-space-size=10"
    echo ""
    echo "Pods will crash loop. Alert should fire in ~60s (PodCrashLooping)"
    echo "Watch: $KUBECTL get pods -n demo-app -w"
    ;;

  # ==================================================================
  # RESET & STATUS
  # ==================================================================

  reset)
    echo "Resetting all features..."
    curl -s -X POST "$APP_URL/features/disable/requestLogging" | jq . || echo "(app may be down)"
    curl -s -X POST "$APP_URL/features/disable/searchEnabled" | jq . || echo "(skipped)"
    curl -s -X POST "$APP_URL/features/disable/userEnrichment" | jq . || echo "(skipped)"
    curl -s -X POST "$APP_URL/features/disable/configDriven" | jq . || echo "(skipped)"

    echo ""
    echo "Resetting infra..."
    $KUBECTL scale deployment demo-app -n demo-app --replicas=2

    $KUBECTL patch deployment demo-app -n demo-app --type=json \
      -p='[{"op":"replace","path":"/spec/template/spec/containers/0/resources/limits/memory","value":"512Mi"}]' \
      2>/dev/null || true

    $KUBECTL set env deployment/demo-app -n demo-app NODE_OPTIONS- 2>/dev/null || true

    echo ""
    echo "Waiting for pods to stabilize..."
    $KUBECTL rollout status deployment/demo-app -n demo-app --timeout=60s
    echo "Done."
    ;;

  status)
    echo "=== Feature flags ==="
    curl -s "$APP_URL/features" | jq . || echo "(app unreachable)"
    echo ""
    echo "=== Pod status ==="
    $KUBECTL get pods -n demo-app
    echo ""
    echo "=== Resource usage ==="
    $KUBECTL top pods -n demo-app 2>/dev/null || echo "(metrics not available yet)"
    ;;

  *)
    echo "Usage: $0 <scenario>"
    echo ""
    echo "Code scenarios (enable buggy feature + generate traffic):"
    echo "  memory-leak      - Unbounded request log         → HighMemoryUsage"
    echo "  cpu-spike        - Catastrophic regex backtrack   → HighCPUUsage"
    echo "  error-rate       - Null ref on unknown user ID    → HighErrorRate"
    echo "  slow-responses   - Sync file read on every req    → HighLatency"
    echo ""
    echo "Infra scenarios (apply misconfiguration via kubectl):"
    echo "  scale-down       - Set replicas to 1              → PodReplicaCountLow"
    echo "  resource-squeeze - Set memory limit to 100Mi      → ContainerOOMKilled"
    echo "  crash-loop       - Bad NODE_OPTIONS (10MB heap)   → PodCrashLooping"
    echo ""
    echo "  reset            - Undo all features + infra"
    echo "  status           - Show current state"
    ;;
esac
