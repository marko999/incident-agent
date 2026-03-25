"""Tests for agent/run.py — alert filtering, test alert generation, and process flow."""

import sys
import os
from unittest.mock import MagicMock

# Ensure the agent directory is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Mock heavy dependencies that aren't needed for the functions we test
sys.modules["azure"] = MagicMock()
sys.modules["azure.identity"] = MagicMock()
sys.modules["agent_framework"] = MagicMock()
sys.modules["agent_framework.azure"] = MagicMock()
sys.modules["pydantic"] = MagicMock()

# Provide a passthrough for the @tool decorator used by tools.py
sys.modules["agent_framework"].tool = lambda **kwargs: (lambda fn: fn)
sys.modules["pydantic"].Field = lambda **kwargs: None

# Set required env vars before import
os.environ.setdefault("GITHUB_REPO", "test-org/test-repo")
os.environ.setdefault("AZURE_AI_PROJECT_ENDPOINT", "https://fake.cognitiveservices.azure.com/")
os.environ.setdefault("AZURE_OPENAI_RESPONSES_DEPLOYMENT_NAME", "fake-deployment")

from run import filter_demo_app_alerts, make_test_alert


class TestFilterDemoAppAlerts:
    """Tests for filter_demo_app_alerts()."""

    def test_keeps_demo_app_alerts_by_namespace(self):
        alerts = [
            {"alertname": "HighErrorRate", "namespace": "demo-app", "severity": "critical"},
        ]
        result = filter_demo_app_alerts(alerts)
        assert len(result) == 1
        assert result[0]["alertname"] == "HighErrorRate"

    def test_keeps_demo_app_alerts_by_service(self):
        alerts = [
            {"alertname": "HighLatency", "service": "demo-app", "severity": "warning"},
        ]
        result = filter_demo_app_alerts(alerts)
        assert len(result) == 1
        assert result[0]["alertname"] == "HighLatency"

    def test_filters_out_system_alerts(self):
        alerts = [
            {"alertname": "KubeSchedulerDown", "namespace": "kube-system"},
            {"alertname": "Watchdog", "namespace": "monitoring"},
            {"alertname": "KubeControllerManagerDown", "namespace": "kube-system"},
            {"alertname": "InfoInhibitor", "namespace": "monitoring"},
        ]
        result = filter_demo_app_alerts(alerts)
        assert len(result) == 0

    def test_filters_out_non_demo_app_namespace(self):
        alerts = [
            {"alertname": "SomeAlert", "namespace": "kube-system"},
            {"alertname": "AnotherAlert", "namespace": "monitoring"},
        ]
        result = filter_demo_app_alerts(alerts)
        assert len(result) == 0

    def test_filters_ignored_alert_even_in_demo_app_namespace(self):
        """System alerts in the ignore set should be excluded even if they match demo-app."""
        alerts = [
            {"alertname": "Watchdog", "namespace": "demo-app"},
        ]
        result = filter_demo_app_alerts(alerts)
        assert len(result) == 0

    def test_mixed_alerts(self):
        alerts = [
            {"alertname": "HighErrorRate", "namespace": "demo-app", "severity": "critical"},
            {"alertname": "KubeSchedulerDown", "namespace": "kube-system"},
            {"alertname": "PodCrashLooping", "service": "demo-app", "severity": "critical"},
            {"alertname": "Watchdog", "namespace": "monitoring"},
            {"alertname": "HighCPUUsage", "namespace": "demo-app", "severity": "warning"},
        ]
        result = filter_demo_app_alerts(alerts)
        assert len(result) == 3
        names = {a["alertname"] for a in result}
        assert names == {"HighErrorRate", "PodCrashLooping", "HighCPUUsage"}

    def test_empty_input(self):
        assert filter_demo_app_alerts([]) == []


class TestMakeTestAlert:
    """Tests for make_test_alert()."""

    def test_returns_valid_alert_structure(self):
        alert = make_test_alert("HighErrorRate")
        assert alert["alertname"] == "HighErrorRate"
        assert alert["severity"] == "critical"
        assert alert["status"] == "firing"
        assert "summary" in alert
        assert "description" in alert
        assert alert["namespace"] == "demo-app"

    def test_all_known_alert_types(self):
        known = [
            "HighErrorRate", "HighMemoryUsage", "HighCPUUsage",
            "HighLatency", "PodCrashLooping", "PodReplicaCountLow",
            "ContainerOOMKilled",
        ]
        for name in known:
            alert = make_test_alert(name)
            assert alert["alertname"] == name
            assert alert["status"] == "firing"
            assert alert["namespace"] == "demo-app"

    def test_unknown_alert_exits(self):
        import pytest
        with pytest.raises(SystemExit):
            make_test_alert("NonExistentAlert")
