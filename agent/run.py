"""
Entry point for the incident response agent.

Fetches pending alerts from the webhook, filters to demo-app alerts,
and runs the agent on each one.

Usage:
    # One-shot: process current pending alerts and exit
    python run.py

    # Poll mode: check for new alerts every N seconds
    python run.py --poll 30

    # Run on a specific alert type (for testing)
    python run.py --alert HighErrorRate
"""

import argparse
import asyncio
import json
import os
import sys
import urllib.request

# Add the agent directory to path so imports work
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from single_agent import run as run_single_agent

WEBHOOK_URL = os.environ.get("WEBHOOK_URL", "http://localhost:8080")


def fetch_pending_alerts(webhook_url: str) -> list[dict]:
    """Fetch pending alerts from the webhook's /alerts/pending endpoint."""
    try:
        url = f"{webhook_url}/alerts/pending"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read())
            return data.get("alerts", [])
    except Exception as e:
        print(f"Failed to fetch alerts from {webhook_url}: {e}")
        return []


def filter_demo_app_alerts(alerts: list[dict]) -> list[dict]:
    """Filter to only demo-app alerts, ignoring AKS system noise."""
    # These are AKS managed components — always firing, not our concern
    ignore = {"KubeSchedulerDown", "KubeControllerManagerDown", "KubeProxyDown",
              "Watchdog", "InfoInhibitor", "KubeClientErrors", "KubeAPIDown",
              "KubeAPITerminatedRequests", "etcdHighNumberOfLeaderChanges"}
    # Only process alerts with service=demo-app, ignore system alerts
    result = []
    for a in alerts:
        if a.get("alertname") in ignore:
            continue
        if a.get("service") == "demo-app" or a.get("namespace") == "demo-app":
            result.append(a)
    return result


def make_test_alert(alertname: str) -> dict:
    """Create a synthetic alert for testing."""
    templates = {
        "HighErrorRate": {
            "alertname": "HighErrorRate",
            "severity": "critical",
            "status": "firing",
            "summary": "High error rate detected",
            "description": "Error rate is above 10%",
            "namespace": "demo-app",
        },
        "HighMemoryUsage": {
            "alertname": "HighMemoryUsage",
            "severity": "warning",
            "status": "firing",
            "summary": "High memory usage detected",
            "description": "Container memory usage is above 200MB",
            "namespace": "demo-app",
        },
        "HighCPUUsage": {
            "alertname": "HighCPUUsage",
            "severity": "warning",
            "status": "firing",
            "summary": "High CPU usage detected",
            "description": "Container CPU usage is above 50%",
            "namespace": "demo-app",
        },
        "HighLatency": {
            "alertname": "HighLatency",
            "severity": "warning",
            "status": "firing",
            "summary": "High latency detected",
            "description": "p95 latency is above 2s",
            "namespace": "demo-app",
        },
        "PodCrashLooping": {
            "alertname": "PodCrashLooping",
            "severity": "critical",
            "status": "firing",
            "summary": "Pod crash looping",
            "description": "Pod has restarted multiple times in 5 minutes",
            "namespace": "demo-app",
        },
        "PodReplicaCountLow": {
            "alertname": "PodReplicaCountLow",
            "severity": "critical",
            "status": "firing",
            "summary": "Low replica count",
            "description": "Deployment has fewer than 2 available replicas",
            "namespace": "demo-app",
        },
        "ContainerOOMKilled": {
            "alertname": "ContainerOOMKilled",
            "severity": "critical",
            "status": "firing",
            "summary": "Container OOM killed",
            "description": "Container was killed due to out-of-memory",
            "namespace": "demo-app",
        },
    }
    if alertname not in templates:
        print(f"Unknown alert: {alertname}")
        print(f"Available: {', '.join(templates.keys())}")
        sys.exit(1)
    return templates[alertname]


async def process_alerts(alerts: list[dict]):
    """Process a list of alerts through the agent."""
    if not alerts:
        print("No alerts to process.")
        return

    print(f"\nFound {len(alerts)} alert(s) to process:")
    for a in alerts:
        print(f"  - {a.get('alertname')} ({a.get('severity')}) — {a.get('summary')}")
    print()

    for alert in alerts:
        try:
            await run_single_agent(alert)
        except Exception as e:
            print(f"\nERROR processing {alert.get('alertname')}: {e}")
            import traceback
            traceback.print_exc()


async def main():
    parser = argparse.ArgumentParser(description="Incident Response Agent")
    parser.add_argument("--poll", type=int, default=0,
                        help="Poll interval in seconds (0 = one-shot)")
    parser.add_argument("--alert", type=str, default=None,
                        help="Run on a specific alert type for testing (e.g., HighErrorRate)")
    parser.add_argument("--webhook-url", type=str, default=WEBHOOK_URL,
                        help=f"Webhook URL (default: {WEBHOOK_URL})")
    args = parser.parse_args()

    # Test mode — run on a synthetic alert
    if args.alert:
        alert = make_test_alert(args.alert)
        await process_alerts([alert])
        return

    # One-shot or poll mode — fetch from webhook
    if args.poll > 0:
        print(f"Polling {args.webhook_url}/alerts/pending every {args.poll}s...")
        print("Press Ctrl+C to stop.\n")
        seen = set()
        while True:
            alerts = fetch_pending_alerts(args.webhook_url)
            alerts = filter_demo_app_alerts(alerts)
            # Only process alerts we haven't seen yet
            new_alerts = [a for a in alerts if a.get("alertname") not in seen]
            if new_alerts:
                for a in new_alerts:
                    seen.add(a.get("alertname"))
                await process_alerts(new_alerts)
            await asyncio.sleep(args.poll)
    else:
        alerts = fetch_pending_alerts(args.webhook_url)
        alerts = filter_demo_app_alerts(alerts)
        await process_alerts(alerts)


if __name__ == "__main__":
    asyncio.run(main())
