#!/bin/bash
source "$(dirname "$0")/../config.env"

echo "=== CLEANUP: This will delete ALL resources ==="
echo "Resource group: $RESOURCE_GROUP"
echo ""
read -p "Are you sure? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo "Deleting resource group $RESOURCE_GROUP (this takes ~5 min)..."
az group delete --name "$RESOURCE_GROUP" --yes --no-wait

echo "Deletion started in background. Resources will be removed in a few minutes."
