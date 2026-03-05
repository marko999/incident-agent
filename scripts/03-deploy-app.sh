#!/bin/bash
set -e
source "$(dirname "$0")/../config.env"
SCRIPT_DIR="$(dirname "$0")"
APP_DIR="$SCRIPT_DIR/../demo-app"

echo "=== Building and deploying demo app ==="

# Create ACR (Azure Container Registry)
ACR_NAME="acr$(echo $CLUSTER_NAME | tr -d '-')$(date +%s | tail -c 5)"
echo "Creating ACR: $ACR_NAME"
az acr create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$ACR_NAME" \
  --sku Basic \
  --output none

# Attach ACR to AKS
echo "Attaching ACR to AKS..."
az aks update \
  --resource-group "$RESOURCE_GROUP" \
  --name "$CLUSTER_NAME" \
  --attach-acr "$ACR_NAME" \
  --output none

# Build image in ACR
IMAGE="$ACR_NAME.azurecr.io/demo-app:latest"
echo "Building image: $IMAGE"
az acr build \
  --registry "$ACR_NAME" \
  --image demo-app:latest \
  "$APP_DIR"

# Create namespace
kubectl create namespace demo-app --dry-run=client -o yaml | kubectl apply -f -

# Deploy with correct image
echo "Deploying to AKS..."
sed "s|IMAGE_PLACEHOLDER|$IMAGE|g" "$APP_DIR/k8s/deployment.yaml" | kubectl apply -f -

# Wait for rollout
echo "Waiting for deployment..."
kubectl rollout status deployment/demo-app -n demo-app --timeout=120s

# Save ACR name for later
echo "ACR_NAME=$ACR_NAME" >> "$SCRIPT_DIR/../config.env"

echo ""
echo "=== Demo app deployed ==="
kubectl get pods -n demo-app
echo ""
echo "Test: kubectl port-forward -n demo-app svc/demo-app 8080:80"
echo "Then: curl http://localhost:8080/health"
