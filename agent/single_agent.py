"""
Single-agent incident response.

One agent with all tools — investigates the incident, finds the root cause,
fixes the code, and creates a PR. This is the simplest working agent and
the single-agent hackathon scenario.
"""

import asyncio
import os
from pathlib import Path

from azure.identity import DefaultAzureCredential
from agent_framework.azure import AzureOpenAIResponsesClient

from tools import (
    kubectl_get,
    kubectl_describe,
    kubectl_logs,
    kubectl_top,
    kubectl_events,
    list_files,
    read_file,
    write_file,
    git_create_branch,
    git_diff,
    git_commit_and_push,
    create_pull_request,
)

# Load the system prompt
PROMPT_PATH = Path(__file__).parent / "prompt.md"
SYSTEM_PROMPT = PROMPT_PATH.read_text()

# All tools the agent can use
ALL_TOOLS = [
    # Cluster investigation
    kubectl_get,
    kubectl_describe,
    kubectl_logs,
    kubectl_top,
    kubectl_events,
    # Code read/write
    list_files,
    read_file,
    write_file,
    # Git & GitHub
    git_create_branch,
    git_diff,
    git_commit_and_push,
    create_pull_request,
]

# Azure OpenAI config
AZURE_ENDPOINT = os.environ.get("AZURE_AI_PROJECT_ENDPOINT", "https://mvucinic-test.cognitiveservices.azure.com/")
AZURE_DEPLOYMENT = os.environ.get("AZURE_OPENAI_RESPONSES_DEPLOYMENT_NAME", "gpt-53")


def create_agent():
    """Create the incident response agent."""
    credential = DefaultAzureCredential()
    client = AzureOpenAIResponsesClient(
        project_endpoint=AZURE_ENDPOINT,
        deployment_name=AZURE_DEPLOYMENT,
        credential=credential,
    )

    agent = client.as_agent(
        name="IncidentAgent",
        instructions=SYSTEM_PROMPT,
        tools=ALL_TOOLS,
    )

    return agent


async def run(alert: dict) -> str:
    """
    Run the agent on a single alert.

    Args:
        alert: Alert dict with keys: alertname, severity, summary, description,
               namespace, pod, timestamp, status

    Returns:
        The agent's final response text
    """
    agent = create_agent()

    # Build the user message with the alert context
    message = f"""An alert has fired. Investigate and fix it.

## Alert Details
- **Alert**: {alert.get('alertname', 'Unknown')}
- **Severity**: {alert.get('severity', 'Unknown')}
- **Status**: {alert.get('status', 'firing')}
- **Summary**: {alert.get('summary', 'No summary')}
- **Description**: {alert.get('description', 'No description')}
- **Namespace**: {alert.get('namespace', 'demo-app')}
- **Pod**: {alert.get('pod', 'N/A')}
- **Timestamp**: {alert.get('timestamp', 'N/A')}

Follow your process: investigate with kubectl tools, read the source code, find the root cause, fix it, and create a PR."""

    print(f"\n{'='*60}")
    print(f"INCIDENT AGENT — investigating: {alert.get('alertname')}")
    print(f"{'='*60}\n")

    # Run the agent — it will call tools autonomously until done
    result = await agent.run(message)

    print(f"\n{'='*60}")
    print(f"AGENT COMPLETE")
    print(f"{'='*60}\n")
    print(result.text if hasattr(result, 'text') else str(result))

    return result.text if hasattr(result, 'text') else str(result)


# Allow running directly for testing
if __name__ == "__main__":
    # Test with a fake alert
    test_alert = {
        "alertname": "HighErrorRate",
        "severity": "critical",
        "status": "firing",
        "summary": "High error rate detected",
        "description": "Error rate is 90.7%",
        "namespace": "demo-app",
        "pod": "",
        "timestamp": "2026-03-07T17:00:00Z",
    }
    asyncio.run(run(test_alert))
