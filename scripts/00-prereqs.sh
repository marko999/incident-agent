#!/bin/bash
set -e

echo "=== Checking prerequisites ==="

check_cmd() {
  if ! command -v "$1" &>/dev/null; then
    echo "MISSING: $1 - $2"
    exit 1
  else
    echo "OK: $1 ($($1 --version 2>&1 | head -1))"
  fi
}

check_cmd az "Install: https://learn.microsoft.com/en-us/cli/azure/install-azure-cli"
check_cmd kubectl "Install: az aks install-cli"
check_cmd helm "Install: https://helm.sh/docs/intro/install/"
check_cmd gh "Install: https://cli.github.com/"
check_cmd docker "Install: https://docs.docker.com/get-docker/"

# Check az login
echo ""
echo "=== Checking Azure login ==="
if az account show &>/dev/null; then
  echo "OK: Logged in as $(az account show --query user.name -o tsv)"
  echo "    Subscription: $(az account show --query name -o tsv)"
else
  echo "NOT LOGGED IN. Run: az login"
  exit 1
fi

# Check gh login
echo ""
echo "=== Checking GitHub login ==="
if gh auth status &>/dev/null; then
  echo "OK: GitHub authenticated"
else
  echo "NOT LOGGED IN. Run: gh auth login"
  exit 1
fi

echo ""
echo "=== All prerequisites met ==="
