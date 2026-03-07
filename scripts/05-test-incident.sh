#!/bin/bash
set -e

source "$(dirname "$0")/../config.env"

APP_URL="${APP_URL:-http://localhost:8080}"
KUBECTL="kubectl --kubeconfig $HOME/.kube/aks-incident-demo.config"

case "${1:-menu}" in

  # ==================================================================
  # CODE SCENARIOS
  # ==================================================================

  memory-leak)
    echo "Enabling request logging feature..."
    curl -s -X POST "$APP_URL/features/enable/requestLogging" | jq .
    echo ""
    echo "Generating sustained traffic..."
    for i in $(seq 1 500); do
      curl -s -o /dev/null "$APP_URL/api/data" &
      [ $((i % 50)) -eq 0 ] && wait
    done
    wait
    echo "Alert should fire in ~30-60s (HighMemoryUsage)"
    ;;

  cpu-spike)
    echo "Enabling search feature..."
    curl -s -X POST "$APP_URL/features/enable/searchEnabled" | jq .
    echo ""
    echo "Sending pathological search queries..."
    EVIL_QUERY="aaaaaaaaaaaaaaaaaaaaaaaaaaaa!"
    for i in $(seq 1 20); do
      curl -s -o /dev/null "$APP_URL/api/search?q=$EVIL_QUERY" &
    done
    wait
    echo "Alert should fire in ~30s (HighCPUUsage)"
    ;;

  error-rate)
    echo "Enabling user enrichment feature..."
    curl -s -X POST "$APP_URL/features/enable/userEnrichment" | jq .
    echo ""
    echo "Sending requests for non-existent user IDs..."
    for i in $(seq 1 200); do
      curl -s -o /dev/null "$APP_URL/api/users?id=$((i + 98))" &
      [ $((i % 50)) -eq 0 ] && wait
    done
    wait
    echo "Alert should fire in ~30s (HighErrorRate)"
    ;;

  slow-responses)
    echo "Enabling config-driven responses..."
    curl -s -X POST "$APP_URL/features/enable/configDriven" | jq .
    echo ""
    echo "Sending concurrent requests..."
    for i in $(seq 1 50); do
      curl -s -o /dev/null "$APP_URL/api/data" &
    done
    wait
    echo "Alert should fire in ~30s (HighLatency)"
    ;;

  db-conn-leak)
    echo "Enabling database cache feature..."
    curl -s -X POST "$APP_URL/features/enable/dbCache" | jq .
    echo ""
    echo "Sending sustained traffic to exhaust Redis connections..."
    for i in $(seq 1 200); do
      curl -s -o /dev/null "$APP_URL/api/data" &
      [ $((i % 50)) -eq 0 ] && wait
    done
    wait
    echo "Redis connections exhausted. Alert should fire in ~30s (HighErrorRate)"
    ;;

  db-slow-query)
    echo "Enabling database sessions feature..."
    curl -s -X POST "$APP_URL/features/enable/dbSessions" | jq .
    echo ""
    echo "Seeding Redis with many session keys..."
    for i in $(seq 1 5000); do
      curl -s -o /dev/null -X POST "$APP_URL/api/sessions" -H 'Content-Type: application/json' -d "{\"userId\": $i}" &
      [ $((i % 100)) -eq 0 ] && wait
    done
    wait
    echo ""
    echo "Now querying all sessions (triggers KEYS * scan)..."
    for i in $(seq 1 20); do
      curl -s -o /dev/null "$APP_URL/api/sessions" &
    done
    wait
    echo "Alert should fire in ~30s (HighLatency)"
    ;;

  # ==================================================================
  # INFRA SCENARIOS
  # ==================================================================

  scale-down)
    echo "Scaling demo-app down to 1 replica..."
    $KUBECTL scale deployment demo-app -n demo-app --replicas=1
    echo "Alert should fire in ~30s (PodReplicaCountLow)"
    ;;

  resource-squeeze)
    echo "Patching memory limit to 100Mi..."
    $KUBECTL patch deployment demo-app -n demo-app --type=json \
      -p='[{"op":"replace","path":"/spec/template/spec/containers/0/resources/limits/memory","value":"100Mi"}]'
    echo "Alert should fire in ~60s (ContainerOOMKilled)"
    ;;

  crash-loop)
    echo "Injecting bad NODE_OPTIONS (10MB heap)..."
    $KUBECTL set env deployment/demo-app -n demo-app NODE_OPTIONS="--max-old-space-size=10"
    echo "Alert should fire in ~60s (PodCrashLooping)"
    ;;

  db-down)
    echo "Scaling Redis to 0 replicas..."
    $KUBECTL scale deployment redis -n demo-app --replicas=0
    echo ""
    echo "Redis is down. Enable a db feature and send traffic to trigger errors:"
    echo "  curl -X POST $APP_URL/features/enable/dbCache"
    echo "  for i in \$(seq 1 50); do curl -s -o /dev/null $APP_URL/api/data & done; wait"
    echo "Alert should fire in ~30s (HighErrorRate)"
    ;;

  # ==================================================================
  # RESET & STATUS
  # ==================================================================

  reset)
    echo "Resetting all features..."
    curl -s -X POST "$APP_URL/features/disable/requestLogging" | jq . 2>/dev/null || echo "(app may be down)"
    curl -s -X POST "$APP_URL/features/disable/searchEnabled" | jq . 2>/dev/null || echo "(skipped)"
    curl -s -X POST "$APP_URL/features/disable/userEnrichment" | jq . 2>/dev/null || echo "(skipped)"
    curl -s -X POST "$APP_URL/features/disable/configDriven" | jq . 2>/dev/null || echo "(skipped)"
    curl -s -X POST "$APP_URL/features/disable/dbCache" | jq . 2>/dev/null || echo "(skipped)"
    curl -s -X POST "$APP_URL/features/disable/dbSessions" | jq . 2>/dev/null || echo "(skipped)"

    echo ""
    echo "Resetting infra..."
    $KUBECTL scale deployment demo-app -n demo-app --replicas=2
    $KUBECTL scale deployment redis -n demo-app --replicas=1 2>/dev/null || true

    $KUBECTL patch deployment demo-app -n demo-app --type=json \
      -p='[{"op":"replace","path":"/spec/template/spec/containers/0/resources/limits/memory","value":"512Mi"}]' \
      2>/dev/null || true

    $KUBECTL set env deployment/demo-app -n demo-app NODE_OPTIONS- 2>/dev/null || true

    echo ""
    echo "Waiting for pods to stabilize..."
    $KUBECTL rollout status deployment/demo-app -n demo-app --timeout=60s
    $KUBECTL rollout status deployment/redis -n demo-app --timeout=60s 2>/dev/null || true
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
    echo "Code scenarios:"
    echo "  memory-leak      - Unbounded request log          → HighMemoryUsage"
    echo "  cpu-spike        - Catastrophic regex backtrack    → HighCPUUsage"
    echo "  error-rate       - Null ref on unknown user ID     → HighErrorRate"
    echo "  slow-responses   - Sync file read on every req     → HighLatency"
    echo "  db-conn-leak     - New Redis conn per request      → HighErrorRate"
    echo "  db-slow-query    - KEYS * scan blocks Redis        → HighLatency"
    echo ""
    echo "Infra scenarios:"
    echo "  scale-down       - Set replicas to 1               → PodReplicaCountLow"
    echo "  resource-squeeze - Set memory limit to 100Mi       → ContainerOOMKilled"
    echo "  crash-loop       - Bad NODE_OPTIONS (10MB heap)    → PodCrashLooping"
    echo "  db-down          - Scale Redis to 0                → HighErrorRate"
    echo ""
    echo "  reset            - Undo all features + infra"
    echo "  status           - Show current state"
    ;;
esac
