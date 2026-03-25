"""
Tools for the incident response agent.

Each @tool-decorated function becomes a callable tool that the LLM can invoke
by name with typed parameters.

The agent works on its own git clone in /tmp — never touches your working directory.
"""

import os
import shutil
import subprocess
from typing import Annotated

from agent_framework import tool
from pydantic import Field


KUBECONFIG = os.environ.get("KUBECONFIG", "")
GITHUB_REPO = os.environ["GITHUB_REPO"]
WORKDIR = os.environ.get("AGENT_WORKDIR", "/tmp/incident-agent-workdir")

_workdir_ready = False


def _ensure_workdir() -> str:
    """Clone the repo to a fresh temp directory on first use."""
    global _workdir_ready
    if _workdir_ready and os.path.isdir(os.path.join(WORKDIR, ".git")):
        return WORKDIR

    if os.path.exists(WORKDIR):
        shutil.rmtree(WORKDIR)

    result = subprocess.run(
        ["gh", "repo", "clone", GITHUB_REPO, WORKDIR],
        capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Failed to clone repo: {result.stderr}")

    _workdir_ready = True
    return WORKDIR


def _run(cmd: list[str], timeout: int = 30) -> str:
    """Run a subprocess in the agent's working directory."""
    workdir = _ensure_workdir()
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=workdir,
        )
        output = result.stdout
        if result.returncode != 0:
            output += f"\nSTDERR:\n{result.stderr}" if result.stderr else ""
            output += f"\n(exit code {result.returncode})"
        return output.strip() or "(no output)"
    except subprocess.TimeoutExpired:
        return f"(command timed out after {timeout}s)"
    except Exception as e:
        return f"(error running command: {e})"


def _kubectl(args: list[str], timeout: int = 30) -> str:
    """Run kubectl with the correct kubeconfig. Does not need the workdir."""
    try:
        cmd = ["kubectl"]
        if KUBECONFIG:
            cmd += ["--kubeconfig", KUBECONFIG]
        result = subprocess.run(
            cmd + args,
            capture_output=True, text=True, timeout=timeout,
        )
        output = result.stdout
        if result.returncode != 0:
            output += f"\nSTDERR:\n{result.stderr}" if result.stderr else ""
            output += f"\n(exit code {result.returncode})"
        return output.strip() or "(no output)"
    except subprocess.TimeoutExpired:
        return f"(command timed out after {timeout}s)"
    except Exception as e:
        return f"(error running command: {e})"


# ===========================================================================
# 1. CLUSTER TOOLS
# ===========================================================================

@tool(approval_mode="never_require")
def kubectl_get(
    resource: Annotated[str, Field(description="Resource type to get, e.g. 'pods', 'deployments', 'services', 'events'")],
    namespace: Annotated[str, Field(description="Kubernetes namespace")] = "demo-app",
    output: Annotated[str, Field(description="Output format: 'wide', 'yaml', 'json', or '' for default")] = "wide",
) -> str:
    """Get Kubernetes resources. Use this to see what's running, pod status, replica counts, etc."""
    args = ["get", resource, "-n", namespace]
    if output:
        args += ["-o", output]
    return _kubectl(args)


@tool(approval_mode="never_require")
def kubectl_describe(
    resource: Annotated[str, Field(description="Resource to describe, e.g. 'pod/demo-app-xyz' or 'deployment/demo-app'")],
    namespace: Annotated[str, Field(description="Kubernetes namespace")] = "demo-app",
) -> str:
    """Describe a Kubernetes resource. Shows events, conditions, containers, resource limits, env vars — detailed info for debugging."""
    return _kubectl(["describe", resource, "-n", namespace])


@tool(approval_mode="never_require")
def kubectl_logs(
    pod: Annotated[str, Field(description="Pod name or deployment/name prefix, e.g. 'demo-app-abc123' or 'deployment/demo-app'")],
    namespace: Annotated[str, Field(description="Kubernetes namespace")] = "demo-app",
    tail: Annotated[int, Field(description="Number of log lines from the end")] = 100,
    previous: Annotated[bool, Field(description="Get logs from the previous (crashed) container instance")] = False,
) -> str:
    """Get pod logs. Use tail to limit output. Set previous=True to see logs from a crashed container."""
    args = ["logs", pod, "-n", namespace, f"--tail={tail}"]
    if previous:
        args.append("--previous")
    return _kubectl(args)


@tool(approval_mode="never_require")
def kubectl_top(
    namespace: Annotated[str, Field(description="Kubernetes namespace")] = "demo-app",
) -> str:
    """Show CPU and memory usage for pods. Requires metrics-server to be running."""
    return _kubectl(["top", "pods", "-n", namespace])


@tool(approval_mode="never_require")
def kubectl_events(
    namespace: Annotated[str, Field(description="Kubernetes namespace")] = "demo-app",
) -> str:
    """Get recent Kubernetes events sorted by time. Shows OOM kills, restarts, scheduling issues, etc."""
    return _kubectl(["get", "events", "-n", namespace, "--sort-by=.lastTimestamp"])


# ===========================================================================
# 2. CODE TOOLS
# ===========================================================================

@tool(approval_mode="never_require")
def list_files(
    directory: Annotated[str, Field(description="Directory path relative to repo root, e.g. 'demo-app' or 'monitoring'")] = ".",
) -> str:
    """List files in a directory. Use this to explore the repo structure."""
    workdir = _ensure_workdir()
    target = os.path.join(workdir, directory)
    if not os.path.isdir(target):
        return f"Directory not found: {directory}"
    try:
        entries = []
        for root, dirs, files in os.walk(target):
            dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ('node_modules', '__pycache__', '.venv')]
            rel = os.path.relpath(root, workdir)
            for f in files:
                entries.append(os.path.join(rel, f))
        return "\n".join(sorted(entries))
    except Exception as e:
        return f"Error listing files: {e}"


@tool(approval_mode="never_require")
def read_file(
    path: Annotated[str, Field(description="File path relative to repo root, e.g. 'demo-app/server.js'")],
) -> str:
    """Read the contents of a file. Use this to examine source code, manifests, configs."""
    workdir = _ensure_workdir()
    full_path = os.path.join(workdir, path)
    if not os.path.isfile(full_path):
        return f"File not found: {path}"
    try:
        with open(full_path, "r") as f:
            content = f.read()
        lines = content.split("\n")
        numbered = [f"{i+1:4d} | {line}" for i, line in enumerate(lines)]
        return "\n".join(numbered)
    except Exception as e:
        return f"Error reading file: {e}"


@tool(approval_mode="never_require")
def write_file(
    path: Annotated[str, Field(description="File path relative to repo root, e.g. 'demo-app/server.js'")],
    content: Annotated[str, Field(description="The full file content to write")],
) -> str:
    """Write content to a file. This overwrites the entire file. Use read_file first to see current content."""
    workdir = _ensure_workdir()
    full_path = os.path.join(workdir, path)
    try:
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w") as f:
            f.write(content)
        return f"File written: {path} ({len(content)} bytes)"
    except Exception as e:
        return f"Error writing file: {e}"


# ===========================================================================
# 3. GITHUB TOOLS
# ===========================================================================

@tool(approval_mode="never_require")
def git_create_branch(
    branch_name: Annotated[str, Field(description="Branch name, e.g. 'fix/high-error-rate-20260307'")],
) -> str:
    """Create a new git branch from main and switch to it."""
    _run(["git", "checkout", "main"])
    _run(["git", "pull", "origin", "main"])
    result = _run(["git", "checkout", "-b", branch_name])
    return result


@tool(approval_mode="never_require")
def git_diff() -> str:
    """Show the current git diff (unstaged changes). Use this to review changes before committing."""
    return _run(["git", "diff"])


@tool(approval_mode="never_require")
def git_commit_and_push(
    message: Annotated[str, Field(description="Commit message describing the fix")],
    branch_name: Annotated[str, Field(description="Branch name to push")],
) -> str:
    """Stage all changes, commit, and push to origin."""
    _run(["git", "checkout", branch_name])
    _run(["git", "add", "-A"])
    commit_result = _run(["git", "commit", "-m", message])
    push_result = _run(["git", "push", "-u", "origin", branch_name])
    return f"{commit_result}\n\n{push_result}"


@tool(approval_mode="never_require")
def create_pull_request(
    title: Annotated[str, Field(description="PR title, e.g. 'Fix: HighErrorRate — null reference in user enrichment'")],
    body: Annotated[str, Field(description="PR body with root cause analysis, what the fix does, and how to verify")],
    branch_name: Annotated[str, Field(description="Source branch name")],
    base: Annotated[str, Field(description="Target branch to merge into")] = "main",
) -> str:
    """Create a pull request on GitHub using the gh CLI."""
    result = _run([
        "gh", "pr", "create",
        "--repo", GITHUB_REPO,
        "--title", title,
        "--body", body,
        "--head", branch_name,
        "--base", base,
    ])
    return result
