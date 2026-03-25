"""Tests for agent/tools.py — tool helper functions with mocked subprocess calls."""

import os
import subprocess
import sys
from unittest.mock import patch, MagicMock

# Ensure the agent directory is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Mock the agent_framework and pydantic imports before importing tools
sys.modules["agent_framework"] = MagicMock()
sys.modules["pydantic"] = MagicMock()

# Provide a passthrough for the @tool decorator
mock_af = sys.modules["agent_framework"]
mock_af.tool = lambda **kwargs: (lambda fn: fn)

# Provide a passthrough for Field
mock_pydantic = sys.modules["pydantic"]
mock_pydantic.Field = lambda **kwargs: None

# Set required env vars before import
os.environ.setdefault("GITHUB_REPO", "test-org/test-repo")

from tools import _kubectl, _run, _ensure_workdir


class TestKubectl:
    """Tests for the _kubectl helper."""

    @patch("tools.subprocess.run")
    def test_successful_kubectl_get(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess(
            args=["kubectl", "get", "pods", "-n", "demo-app"],
            returncode=0,
            stdout="NAME              READY   STATUS\ndemo-app-abc123   1/1     Running\n",
            stderr="",
        )
        result = _kubectl(["get", "pods", "-n", "demo-app"])
        assert "demo-app-abc123" in result
        assert "Running" in result

    @patch("tools.subprocess.run")
    def test_kubectl_with_error(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess(
            args=["kubectl", "get", "pods"],
            returncode=1,
            stdout="",
            stderr="error: the server doesn't have a resource type \"bogus\"",
        )
        result = _kubectl(["get", "bogus"])
        assert "error" in result.lower()
        assert "exit code 1" in result

    @patch("tools.subprocess.run")
    def test_kubectl_timeout(self, mock_run):
        mock_run.side_effect = subprocess.TimeoutExpired(cmd=["kubectl"], timeout=30)
        result = _kubectl(["get", "pods"], timeout=30)
        assert "timed out" in result

    @patch("tools.KUBECONFIG", "/tmp/test.config")
    @patch("tools.subprocess.run")
    def test_kubectl_uses_kubeconfig(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="ok", stderr="",
        )
        _kubectl(["get", "nodes"])
        called_cmd = mock_run.call_args[0][0]
        assert "--kubeconfig" in called_cmd
        assert "/tmp/test.config" in called_cmd


class TestRun:
    """Tests for the _run helper (subprocess in workdir)."""

    @patch("tools._ensure_workdir", return_value="/tmp/fake-workdir")
    @patch("tools.subprocess.run")
    def test_successful_command(self, mock_run, mock_workdir):
        mock_run.return_value = subprocess.CompletedProcess(
            args=["git", "status"],
            returncode=0,
            stdout="On branch main\nnothing to commit\n",
            stderr="",
        )
        result = _run(["git", "status"])
        assert "On branch main" in result
        mock_run.assert_called_once()
        assert mock_run.call_args[1]["cwd"] == "/tmp/fake-workdir"

    @patch("tools._ensure_workdir", return_value="/tmp/fake-workdir")
    @patch("tools.subprocess.run")
    def test_command_with_nonzero_exit(self, mock_run, mock_workdir):
        mock_run.return_value = subprocess.CompletedProcess(
            args=["git", "push"],
            returncode=128,
            stdout="",
            stderr="fatal: remote origin not found",
        )
        result = _run(["git", "push"])
        assert "fatal" in result
        assert "exit code 128" in result

    @patch("tools._ensure_workdir", return_value="/tmp/fake-workdir")
    @patch("tools.subprocess.run")
    def test_command_timeout(self, mock_run, mock_workdir):
        mock_run.side_effect = subprocess.TimeoutExpired(cmd=["slow"], timeout=30)
        result = _run(["slow"], timeout=30)
        assert "timed out" in result

    @patch("tools._ensure_workdir", return_value="/tmp/fake-workdir")
    @patch("tools.subprocess.run")
    def test_empty_output_returns_no_output(self, mock_run, mock_workdir):
        mock_run.return_value = subprocess.CompletedProcess(
            args=["true"], returncode=0, stdout="", stderr="",
        )
        result = _run(["true"])
        assert result == "(no output)"
