#!/bin/bash
set -e
source "$(dirname "$0")/../config.env"

echo "=== Creating AKS cluster ==="

# Resource group
echo "Creating resource group: $RESOURCE_GROUP in $AZURE_REGION"
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$AZURE_REGION" \
  --output none

# AKS cluster
echo "Creating AKS cluster: $CLUSTER_NAME (this takes ~5 min)"
az aks create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$CLUSTER_NAME" \
  --node-count "$NODE_COUNT" \
  --node-vm-size "$NODE_VM_SIZE" \
  --generate-ssh-keys \
  --enable-managed-identity \
  --network-plugin azure \
  --output none

# Get credentials
echo "Getting kubectl credentials..."
az aks get-credentials \
  --resource-group "$RESOURCE_GROUP" \
  --name "$CLUSTER_NAME" \
  --overwrite-existing

# Verify
echo ""
echo "=== Cluster ready ==="
kubectl get nodes
