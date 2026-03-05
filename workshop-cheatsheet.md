# Microsoft Agent Framework -- Workshop Cheatsheet

> Speed-run all 6 tutorial steps in under 1 hour. Copy-paste the code, set your env vars, and go.
>
> Source: https://learn.microsoft.com/en-us/agent-framework/get-started/
>
> Last fetched: 2026-03-05

---

## Table of Contents

1. [Prerequisites & Setup](#prerequisites--setup)
2. [Step 1: Your First Agent](#step-1-your-first-agent)
3. [Step 2: Add Tools](#step-2-add-tools)
4. [Step 3: Multi-Turn Conversations](#step-3-multi-turn-conversations)
5. [Step 4: Memory & Persistence](#step-4-memory--persistence)
6. [Step 5: Workflows](#step-5-workflows)
7. [Step 6: Host Your Agent](#step-6-host-your-agent)
8. [Swap in Anthropic Claude](#swap-in-anthropic-claude)
9. [Workflow Patterns Reference](#workflow-patterns-reference)

---

## Prerequisites & Setup

### Python

```bash
pip install agent-framework --pre
```

### Environment Variables (Azure OpenAI)

```bash
export AZURE_AI_PROJECT_ENDPOINT="https://<your-endpoint>.openai.azure.com/"
export AZURE_OPENAI_RESPONSES_DEPLOYMENT_NAME="gpt-4o-mini"
```

### Gotcha: .env files

Agent Framework does NOT automatically load `.env` files. You must call `load_dotenv()` manually:

```python
from dotenv import load_dotenv
load_dotenv()
```

### C# (.NET)

```bash
dotnet add package Azure.AI.OpenAI --prerelease
dotnet add package Azure.Identity
dotnet add package Microsoft.Agents.AI.OpenAI --prerelease
```

```bash
export AZURE_OPENAI_ENDPOINT="https://<your-endpoint>.openai.azure.com/"
export AZURE_OPENAI_DEPLOYMENT_NAME="gpt-4o-mini"
```

---

## Step 1: Your First Agent

**Concepts:** Agent creation, single-turn invocation, streaming vs non-streaming.

### Python

```python
import asyncio
import os
from azure.identity import AzureCliCredential
from dotenv import load_dotenv

load_dotenv()

from agent_framework.azure import AzureOpenAIResponsesClient

async def main():
    credential = AzureCliCredential()
    client = AzureOpenAIResponsesClient(
        project_endpoint=os.environ["AZURE_AI_PROJECT_ENDPOINT"],
        deployment_name=os.environ["AZURE_OPENAI_RESPONSES_DEPLOYMENT_NAME"],
        credential=credential,
    )

    agent = client.as_agent(
        name="HelloAgent",
        instructions="You are a friendly assistant. Keep your answers brief.",
    )

    # Non-streaming: get the complete response at once
    result = await agent.run("What is the capital of France?")
    print(f"Agent: {result}")

    # Streaming: receive tokens as they are generated
    print("Agent (streaming): ", end="", flush=True)
    async for chunk in agent.run("Tell me a one-sentence fun fact.", stream=True):
        if chunk.text:
            print(chunk.text, end="", flush=True)
    print()

if __name__ == "__main__":
    asyncio.run(main())
```

### C#

```csharp
using System;
using Azure.AI.OpenAI;
using Azure.Identity;
using Microsoft.Agents.AI;

var endpoint = Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT")
    ?? throw new InvalidOperationException("Set AZURE_OPENAI_ENDPOINT");
var deploymentName = Environment.GetEnvironmentVariable("AZURE_OPENAI_DEPLOYMENT_NAME") ?? "gpt-4o-mini";

AIAgent agent = new AzureOpenAIClient(new Uri(endpoint), new AzureCliCredential())
    .GetChatClient(deploymentName)
    .AsAIAgent(instructions: "You are a friendly assistant. Keep your answers brief.", name: "HelloAgent");

// Non-streaming
Console.WriteLine(await agent.RunAsync("What is the largest city in France?"));

// Streaming
await foreach (var update in agent.RunStreamingAsync("Tell me a one-sentence fun fact."))
{
    Console.Write(update);
}
```

---

## Step 2: Add Tools

**Concepts:** Function tools, the `@tool` decorator, `approval_mode`, automatic tool calling.

### Python

```python
import asyncio
import os
from random import randint
from typing import Annotated

from azure.identity import AzureCliCredential
from dotenv import load_dotenv
from pydantic import Field

from agent_framework import tool
from agent_framework.azure import AzureOpenAIResponsesClient

load_dotenv()

# NOTE: approval_mode="never_require" is for sample brevity.
# Use "always_require" in production for user confirmation before tool execution.
@tool(approval_mode="never_require")
def get_weather(
    location: Annotated[str, Field(description="The location to get the weather for.")],
) -> str:
    """Get the weather for a given location."""
    conditions = ["sunny", "cloudy", "rainy", "stormy"]
    return f"The weather in {location} is {conditions[randint(0, 3)]} with a high of {randint(10, 30)}C."


async def main():
    credential = AzureCliCredential()
    client = AzureOpenAIResponsesClient(
        project_endpoint=os.environ["AZURE_AI_PROJECT_ENDPOINT"],
        deployment_name=os.environ["AZURE_OPENAI_RESPONSES_DEPLOYMENT_NAME"],
        credential=credential,
    )

    agent = client.as_agent(
        name="WeatherAgent",
        instructions="You are a helpful weather agent. Use the get_weather tool to answer questions.",
        tools=get_weather,
    )

    result = await agent.run("What is the weather like in Amsterdam?")
    print(f"Agent: {result}")

if __name__ == "__main__":
    asyncio.run(main())
```

### C#

```csharp
using System;
using System.ComponentModel;
using Azure.AI.OpenAI;
using Azure.Identity;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;

[Description("Get the weather for a given location.")]
static string GetWeather([Description("The location to get the weather for.")] string location)
    => $"The weather in {location} is cloudy with a high of 15C.";

var endpoint = Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT")
    ?? throw new InvalidOperationException("Set AZURE_OPENAI_ENDPOINT");
var deploymentName = Environment.GetEnvironmentVariable("AZURE_OPENAI_DEPLOYMENT_NAME") ?? "gpt-4o-mini";

AIAgent agent = new AzureOpenAIClient(new Uri(endpoint), new AzureCliCredential())
    .GetChatClient(deploymentName)
    .AsAIAgent(instructions: "You are a helpful assistant.", tools: [AIFunctionFactory.Create(GetWeather)]);

Console.WriteLine(await agent.RunAsync("What is the weather like in Amsterdam?"));
```

### Gotchas

- In Python, use `approval_mode="never_require"` for demos; use `"always_require"` in production.
- Tool functions need proper docstrings -- the LLM uses them to decide when to call the tool.
- In C#, use `[Description]` attributes on both the method and parameters.

---

## Step 3: Multi-Turn Conversations

**Concepts:** `AgentSession`, conversation history, context persistence within a session.

### Python

```python
import asyncio
import os
from azure.identity import AzureCliCredential
from dotenv import load_dotenv

from agent_framework.azure import AzureOpenAIResponsesClient

load_dotenv()

async def main():
    credential = AzureCliCredential()
    client = AzureOpenAIResponsesClient(
        project_endpoint=os.environ["AZURE_AI_PROJECT_ENDPOINT"],
        deployment_name=os.environ["AZURE_OPENAI_RESPONSES_DEPLOYMENT_NAME"],
        credential=credential,
    )

    agent = client.as_agent(
        name="ConversationAgent",
        instructions="You are a friendly assistant. Keep your answers brief.",
    )

    # Create a session to maintain conversation history
    session = agent.create_session()

    # First turn
    result = await agent.run("My name is Alice and I love hiking.", session=session)
    print(f"Agent: {result}\n")

    # Second turn -- the agent should remember the user's name and hobby
    result = await agent.run("What do you remember about me?", session=session)
    print(f"Agent: {result}")

if __name__ == "__main__":
    asyncio.run(main())
```

### C#

```csharp
using System;
using Azure.AI.OpenAI;
using Azure.Identity;
using Microsoft.Agents.AI;

var endpoint = Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT")
    ?? throw new InvalidOperationException("Set AZURE_OPENAI_ENDPOINT");
var deploymentName = Environment.GetEnvironmentVariable("AZURE_OPENAI_DEPLOYMENT_NAME") ?? "gpt-4o-mini";

AIAgent agent = new AzureOpenAIClient(new Uri(endpoint), new AzureCliCredential())
    .GetChatClient(deploymentName)
    .AsAIAgent(instructions: "You are a friendly assistant. Keep your answers brief.", name: "ConversationAgent");

// Create a session to maintain conversation history
AgentSession session = await agent.CreateSessionAsync();

// First turn
Console.WriteLine(await agent.RunAsync("My name is Alice and I love hiking.", session));

// Second turn -- the agent remembers the user's name and hobby
Console.WriteLine(await agent.RunAsync("What do you remember about me?", session));
```

### Gotchas

- Without a session, each `agent.run()` call is stateless -- the agent forgets everything.
- The session object holds the conversation history in memory by default.

---

## Step 4: Memory & Persistence

**Concepts:** `BaseContextProvider`, `before_run`/`after_run` hooks, session state, `InMemoryHistoryProvider`, `Mem0ContextProvider`, audit stores.

### Python -- Custom Context Provider

```python
import asyncio
import os
from typing import Any

from azure.identity import AzureCliCredential
from dotenv import load_dotenv

from agent_framework import AgentSession, BaseContextProvider, SessionContext
from agent_framework.azure import AzureOpenAIResponsesClient

load_dotenv()


class UserMemoryProvider(BaseContextProvider):
    """A context provider that remembers user info in session state."""

    DEFAULT_SOURCE_ID = "user_memory"

    def __init__(self):
        super().__init__(self.DEFAULT_SOURCE_ID)

    async def before_run(
        self,
        *,
        agent: Any,
        session: AgentSession | None,
        context: SessionContext,
        state: dict[str, Any],
    ) -> None:
        """Inject personalization instructions based on stored user info."""
        user_name = state.get("user_name")
        if user_name:
            context.extend_instructions(
                self.source_id,
                f"The user's name is {user_name}. Always address them by name.",
            )
        else:
            context.extend_instructions(
                self.source_id,
                "You don't know the user's name yet. Ask for it politely.",
            )

    async def after_run(
        self,
        *,
        agent: Any,
        session: AgentSession | None,
        context: SessionContext,
        state: dict[str, Any],
    ) -> None:
        """Extract and store user info in session state after each call."""
        for msg in context.input_messages:
            text = msg.text if hasattr(msg, "text") else ""
            if isinstance(text, str) and "my name is" in text.lower():
                state["user_name"] = (
                    text.lower().split("my name is")[-1].strip().split()[0].capitalize()
                )


async def main():
    credential = AzureCliCredential()
    client = AzureOpenAIResponsesClient(
        project_endpoint=os.environ["AZURE_AI_PROJECT_ENDPOINT"],
        deployment_name=os.environ["AZURE_OPENAI_RESPONSES_DEPLOYMENT_NAME"],
        credential=credential,
    )

    agent = client.as_agent(
        name="MemoryAgent",
        instructions="You are a friendly assistant.",
        context_providers=[UserMemoryProvider()],
    )

    session = agent.create_session()

    # The provider doesn't know the user yet -- it will ask for a name
    result = await agent.run("Hello! What's the square root of 9?", session=session)
    print(f"Agent: {result}\n")

    # Now provide the name -- the provider stores it in session state
    result = await agent.run("My name is Alice", session=session)
    print(f"Agent: {result}\n")

    # Subsequent calls are personalized -- name persists via session state
    result = await agent.run("What is 2 + 2?", session=session)
    print(f"Agent: {result}\n")

    # Inspect session state to see what the provider stored
    provider_state = session.state.get("user_memory", {})
    print(f"[Session State] Stored user name: {provider_state.get('user_name')}")

if __name__ == "__main__":
    asyncio.run(main())
```

### Python -- Multiple History/Context Providers (Audit Store Pattern)

```python
from agent_framework import InMemoryHistoryProvider
from agent_framework.mem0 import Mem0ContextProvider

memory_store = InMemoryHistoryProvider(load_messages=True)  # persistence across sessions
agent_memory = Mem0ContextProvider("user-memory", api_key=..., agent_id="my-agent")  # Mem0 for agent memory
audit_store = InMemoryHistoryProvider(
    "audit",
    load_messages=False,
    store_context_messages=True,  # include context added by other providers
)

agent = client.as_agent(
    name="MemoryAgent",
    instructions="You are a friendly assistant.",
    context_providers=[memory_store, agent_memory, audit_store],  # audit store last
)
```

### C# -- Custom Chat History Provider

```csharp
using System;
using Azure.AI.OpenAI;
using Azure.Identity;
using Microsoft.Agents.AI;

var endpoint = Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT")
    ?? throw new InvalidOperationException("Set AZURE_OPENAI_ENDPOINT");
var deploymentName = Environment.GetEnvironmentVariable("AZURE_OPENAI_DEPLOYMENT_NAME") ?? "gpt-4o-mini";

AIAgent agent = new AzureOpenAIClient(new Uri(endpoint), new AzureCliCredential())
    .GetChatClient(deploymentName)
    .AsAIAgent(new ChatClientAgentOptions()
    {
        ChatOptions = new() { Instructions = "You are a helpful assistant." },
        ChatHistoryProvider = new CustomChatHistoryProvider()
    });

AgentSession session = await agent.CreateSessionAsync();
Console.WriteLine(await agent.RunAsync("Hello! What's the square root of 9?", session));
Console.WriteLine(await agent.RunAsync("My name is Alice", session));
Console.WriteLine(await agent.RunAsync("What is my name?", session));
```

### Gotchas

- By default agents use `InMemoryChatHistoryProvider` (or in-service storage, depending on the backend).
- In Python, `BaseHistoryProvider` is also a `BaseContextProvider`.
- Only one history provider should have `load_messages=True` -- otherwise messages get replayed multiple times.
- `RawAgent` may auto-add `InMemoryHistoryProvider()` in some cases, but this is not guaranteed. Add one explicitly if you always want local persistence.

---

## Step 5: Workflows

**Concepts:** `Executor`, `@executor`/`@handler` decorators, `WorkflowBuilder`, `WorkflowContext`, edges, `send_message`, `yield_output`.

### Python

```python
import asyncio
from typing import Never

from agent_framework.workflows import Executor, WorkflowBuilder, WorkflowContext, executor, handler


# Step 1: A class-based executor that converts text to uppercase
class UpperCase(Executor):
    def __init__(self, id: str):
        super().__init__(id=id)

    @handler
    async def to_upper_case(self, text: str, ctx: WorkflowContext[str]) -> None:
        """Convert input to uppercase and forward to the next node."""
        await ctx.send_message(text.upper())


# Step 2: A function-based executor that reverses the string and yields output
@executor(id="reverse_text")
async def reverse_text(text: str, ctx: WorkflowContext[Never, str]) -> None:
    """Reverse the string and yield the final workflow output."""
    await ctx.yield_output(text[::-1])


def create_workflow():
    """Build the workflow: UpperCase -> reverse_text."""
    upper = UpperCase(id="upper_case")
    return WorkflowBuilder(start_executor=upper).add_edge(upper, reverse_text).build()


async def main():
    workflow = create_workflow()
    events = await workflow.run("hello world")
    print(f"Output: {events.get_outputs()}")
    # Output: ['DLROW OLLEH']
    print(f"Final state: {events.get_final_state()}")

if __name__ == "__main__":
    asyncio.run(main())
```

### C#

```csharp
using Microsoft.Agents.AI.Workflows;

// Step 1: Convert text to uppercase
class UpperCase : Executor
{
    [Handler]
    public async Task ToUpperCase(string text, WorkflowContext<string> ctx)
    {
        await ctx.SendMessageAsync(text.ToUpper());
    }
}

// Step 2: Reverse the string and yield output
[Executor(Id = "reverse_text")]
static async Task ReverseText(string text, WorkflowContext<Never, string> ctx)
{
    var reversed = new string(text.Reverse().ToArray());
    await ctx.YieldOutputAsync(reversed);
}

// Build and run
var upper = new UpperCase();
var workflow = new AgentWorkflowBuilder(startExecutor: upper)
    .AddEdge(upper, ReverseText)
    .Build();

var result = await workflow.RunAsync("hello world");
Console.WriteLine($"Output: {string.Join(", ", result.GetOutputs())}");
// Output: DLROW OLLEH
```

### Key Concepts

- `send_message(data)` -- forwards data to the NEXT executor in the graph.
- `yield_output(data)` -- emits a final output from the workflow.
- Executors can be class-based (with `@handler` methods) or function-based (with `@executor` decorator).
- Edges define the flow: `add_edge(source, target)`.

---

## Step 6: Host Your Agent

**Concepts:** Azure Functions hosting, `AgentFunctionApp`, A2A protocol, OpenAI-compatible endpoints, ASP.NET Core hosting.

### Python -- Azure Functions

```bash
pip install agent-framework-azurefunctions --pre
```

```python
from typing import Any
from agent_framework.azure import AgentFunctionApp, AzureOpenAIChatClient
from azure.identity import AzureCliCredential
from dotenv import load_dotenv

load_dotenv()

def _create_agent() -> Any:
    """Create the Joker agent."""
    return AzureOpenAIChatClient(credential=AzureCliCredential()).as_agent(
        name="Joker",
        instructions="You are good at telling jokes.",
    )

# Register the agent with AgentFunctionApp
app = AgentFunctionApp(agents=[_create_agent()], enable_health_check=True, max_poll_retries=50)
```

Run locally:

```bash
func start
```

Test it:

```bash
curl -X POST http://localhost:7071/api/agents/Joker/run \
  -H "Content-Type: text/plain" \
  -d "Tell me a short joke about cloud computing."
```

### C# -- ASP.NET Core Hosting

```csharp
using Azure.AI.OpenAI;
using Azure.Identity;
using Microsoft.Agents.AI;

// Register the chat client
IChatClient chatClient = new AzureOpenAIClient(
        new Uri(endpoint),
        new DefaultAzureCredential())
    .GetChatClient(deploymentName)
    .AsIChatClient();
builder.Services.AddSingleton(chatClient);

// Register an agent with DI
var pirateAgent = builder.AddAIAgent(
    "pirate",
    instructions: "You are a pirate. Speak like a pirate",
    description: "An agent that speaks like a pirate.",
    chatClientServiceKey: "chat-model");

// Optionally add tools
pirateAgent.WithAITool(new MyTool());

// Optionally add in-memory session store
pirateAgent.WithInMemorySessionStore();

// Expose via A2A protocol
builder.Services.AddA2AServer();
var app = builder.Build();
app.MapA2AServer();
app.Run();
```

### C# -- Multi-Agent Workflow in ASP.NET Core

```csharp
builder.AddAIAgent("agent-1", instructions: "you are agent 1!");
builder.AddAIAgent("agent-2", instructions: "you are agent 2!");

var workflow = builder.AddWorkflow("my-workflow", (sp, key) =>
{
    var agent1 = sp.GetRequiredKeyedService<AIAgent>("agent-1");
    var agent2 = sp.GetRequiredKeyedService<AIAgent>("agent-2");
    return AgentWorkflowBuilder.BuildSequential(key, [agent1, agent2]);
});

// Expose workflow as an agent (required for protocol integrations)
var workflowAsAgent = workflow.AddAsAIAgent();
```

### Hosting Options Summary

| Option | Best For |
|---|---|
| A2A Protocol | Multi-agent systems |
| OpenAI-Compatible Endpoints | OpenAI-compatible clients |
| Azure Functions (Durable) | Serverless, long-running tasks |
| AG-UI Protocol | Web frontends |

---

## Swap in Anthropic Claude

Use Claude instead of Azure OpenAI. The agent object is a standard `AIAgent` / `Agent` -- all tools, sessions, and workflows work the same way.

### Python Setup

```bash
pip install agent-framework-anthropic --pre
```

Environment variables:

```bash
export ANTHROPIC_API_KEY="your-anthropic-api-key"
export ANTHROPIC_CHAT_MODEL_ID="claude-sonnet-4-5-20250929"
```

Or use a `.env` file:

```env
ANTHROPIC_API_KEY=your-anthropic-api-key
ANTHROPIC_CHAT_MODEL_ID=claude-sonnet-4-5-20250929
```

### Python -- Basic Agent

```python
import asyncio
from agent_framework.anthropic import AnthropicClient

async def main():
    agent = AnthropicClient().as_agent(
        name="HelpfulAssistant",
        instructions="You are a helpful assistant.",
    )

    result = await agent.run("Hello, how can you help me?")
    print(result.text)

if __name__ == "__main__":
    asyncio.run(main())
```

### Python -- Explicit Configuration (no env vars)

```python
agent = AnthropicClient(
    model_id="claude-sonnet-4-5-20250929",
    api_key="your-api-key-here",
).as_agent(
    name="HelpfulAssistant",
    instructions="You are a helpful assistant.",
)
```

### Python -- With Tools

```python
import asyncio
from random import randint
from typing import Annotated

from agent_framework import tool
from agent_framework.anthropic import AnthropicClient

@tool(approval_mode="never_require")
def get_weather(
    location: Annotated[str, "The location to get the weather for."],
) -> str:
    """Get the weather for a given location."""
    conditions = ["sunny", "cloudy", "rainy", "stormy"]
    return f"The weather in {location} is {conditions[randint(0, 3)]} with a high of {randint(10, 30)}C."

async def main():
    agent = AnthropicClient().as_agent(
        name="WeatherAgent",
        instructions="You are a helpful weather agent.",
        tools=get_weather,
    )

    # Non-streaming
    result = await agent.run("What's the weather like in Seattle?")
    print(f"Result: {result}")

    # Streaming
    print("Agent: ", end="", flush=True)
    async for chunk in agent.run("What's the weather like in Portland and in Paris?", stream=True):
        if chunk.text:
            print(chunk.text, end="", flush=True)
    print()

if __name__ == "__main__":
    asyncio.run(main())
```

### Python -- Anthropic on Azure Foundry

```bash
export ANTHROPIC_FOUNDRY_API_KEY="your-foundry-api-key"
export ANTHROPIC_FOUNDRY_RESOURCE="your-foundry-resource-name"
```

```python
from agent_framework.anthropic import AnthropicClient
from anthropic import AsyncAnthropicFoundry  # requires anthropic>=0.74.0

async def foundry_example():
    agent = AnthropicClient(
        anthropic_client=AsyncAnthropicFoundry()
    ).as_agent(
        name="FoundryAgent",
        instructions="You are a helpful assistant using Anthropic on Foundry.",
    )
    result = await agent.run("How do I use Anthropic on Foundry?")
    print(result.text)
```

### Python -- Hosted Tools (Web Search, MCP, Code Execution)

```python
from agent_framework.anthropic import AnthropicClient

async def hosted_tools_example():
    client = AnthropicClient()
    agent = client.as_agent(
        name="DocsAgent",
        instructions="You are a helpful agent for both Microsoft docs questions and general questions.",
        tools=[
            client.get_mcp_tool(
                name="Microsoft Learn MCP",
                url="https://learn.microsoft.com/api/mcp",
            ),
            client.get_web_search_tool(),
        ],
        max_tokens=20000,
    )
    result = await agent.run("Can you compare Python decorators with C# attributes?")
    print(result.text)
```

### Python -- Extended Thinking (Reasoning)

```python
from agent_framework import TextReasoningContent, UsageContent
from agent_framework.anthropic import AnthropicClient

async def thinking_example():
    client = AnthropicClient()
    agent = client.as_agent(
        name="DocsAgent",
        instructions="You are a helpful agent.",
        tools=[client.get_web_search_tool()],
        default_options={
            "max_tokens": 20000,
            "thinking": {"type": "enabled", "budget_tokens": 10000}
        },
    )

    async for chunk in agent.run("Explain quantum computing", stream=True):
        for content in chunk.contents:
            if isinstance(content, TextReasoningContent):
                print(f"\033[32m{content.text}\033[0m", end="", flush=True)  # green for thinking
            if isinstance(content, UsageContent):
                print(f"\n\033[34m[Usage: {content.details}]\033[0m\n", end="", flush=True)
        if chunk.text:
            print(chunk.text, end="", flush=True)
    print()
```

### C# Setup

```powershell
dotnet add package Microsoft.Agents.AI.Anthropic --prerelease
# If using Azure Foundry:
dotnet add package Anthropic.Foundry --prerelease
dotnet add package Azure.Identity
```

```powershell
$env:ANTHROPIC_API_KEY="your-anthropic-api-key"
$env:ANTHROPIC_DEPLOYMENT_NAME="claude-haiku-4-5"
```

### C# -- Basic Agent (Public API)

```csharp
var apiKey = Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY");
var deploymentName = Environment.GetEnvironmentVariable("ANTHROPIC_DEPLOYMENT_NAME") ?? "claude-haiku-4-5";

AnthropicClient client = new() { APIKey = apiKey };

AIAgent agent = client.AsAIAgent(
    model: deploymentName,
    name: "HelpfulAssistant",
    instructions: "You are a helpful assistant.");

Console.WriteLine(await agent.RunAsync("Hello, how can you help me?"));
```

### C# -- Anthropic on Azure Foundry (API Key)

```csharp
var resource = Environment.GetEnvironmentVariable("ANTHROPIC_RESOURCE");
var apiKey = Environment.GetEnvironmentVariable("ANTHROPIC_API_KEY");
var deploymentName = Environment.GetEnvironmentVariable("ANTHROPIC_DEPLOYMENT_NAME") ?? "claude-haiku-4-5";

AnthropicClient client = new AnthropicFoundryClient(
    new AnthropicFoundryApiKeyCredentials(apiKey, resource));

AIAgent agent = client.AsAIAgent(
    model: deploymentName,
    name: "FoundryAgent",
    instructions: "You are a helpful assistant using Anthropic on Azure Foundry.");

Console.WriteLine(await agent.RunAsync("How do I use Anthropic on Foundry?"));
```

### C# -- Anthropic on Azure Foundry (Azure Credentials)

```csharp
var resource = Environment.GetEnvironmentVariable("ANTHROPIC_RESOURCE");
var deploymentName = Environment.GetEnvironmentVariable("ANTHROPIC_DEPLOYMENT_NAME") ?? "claude-haiku-4-5";

AnthropicClient client = new AnthropicFoundryClient(
    new AnthropicAzureTokenCredential(new DefaultAzureCredential(), resource));

AIAgent agent = client.AsAIAgent(
    model: deploymentName,
    name: "FoundryAgent",
    instructions: "You are a helpful assistant using Anthropic on Azure Foundry.");

Console.WriteLine(await agent.RunAsync("How do I use Anthropic on Foundry?"));
```

> Note: `DefaultAzureCredential` is convenient for dev but in production use a specific credential like `ManagedIdentityCredential`.

---

## Workflow Patterns Reference

The Agent Framework supports these workflow patterns:

| Pattern | Description |
|---|---|
| Sequential | Agents run one after another; output of one feeds into the next |
| Concurrent | Multiple agents run in parallel |
| Hand-off | One agent delegates to another dynamically |
| Magentic | Multi-agent orchestration pattern |

### Core Concepts

- **Executors**: Individual processing units (can be AI agents or custom logic). Receive input, perform tasks, produce output.
- **Edges**: Connections between executors that define message flow. Can include conditions for routing.
- **Events**: Provide observability -- lifecycle events, executor events, custom events.
- **WorkflowBuilder**: Ties executors and edges into a directed graph; manages execution via supersteps.

### Key Differences: Agent vs Workflow

- **Agent**: LLM-driven, dynamic steps decided by the model based on context and tools.
- **Workflow**: Predefined sequence of operations; explicit control over execution path; can include agents as components.

### Type Safety

Strong typing ensures messages flow correctly between components with compile-time validation.

### Checkpointing

Save workflow states for recovery and resumption of long-running processes.

### Quick-Build Helpers (C#)

```csharp
// Sequential: agent1 -> agent2 -> ... in order
AgentWorkflowBuilder.BuildSequential(key, [agent1, agent2]);

// Concurrent: all agents run in parallel
AgentWorkflowBuilder.BuildConcurrent(key, [agent1, agent2]);
```

---

## Quick Reference: Minimal Claude Agent in 10 Lines

```python
import asyncio
from agent_framework.anthropic import AnthropicClient

async def main():
    agent = AnthropicClient(api_key="sk-ant-...").as_agent(
        name="MyAgent",
        instructions="You are a helpful assistant.",
    )
    print((await agent.run("Hello!")).text)

asyncio.run(main())
```

---

## Sample Repos

- C# samples: https://github.com/microsoft/agent-framework/tree/main/dotnet/samples
- Python samples: https://github.com/microsoft/agent-framework/tree/main/python/samples
- Step 1: https://github.com/microsoft/agent-framework/blob/main/python/samples/01-get-started/01_hello_agent.py
- Step 2: https://github.com/microsoft/agent-framework/blob/main/python/samples/01-get-started/02_add_tools.py
- Step 3: https://github.com/microsoft/agent-framework/blob/main/python/samples/01-get-started/03_multi_turn.py
- Step 4: https://github.com/microsoft/agent-framework/blob/main/python/samples/01-get-started/04_memory.py
- Step 5: https://github.com/microsoft/agent-framework/blob/main/python/samples/01-get-started/05_first_workflow.py
- Step 6 (Azure Functions): https://github.com/microsoft/agent-framework/blob/main/python/samples/04-hosting/azure_functions/01_single_agent/function_app.py
- Anthropic example: https://github.com/microsoft/agent-framework/tree/main/dotnet/samples (search for Anthropic)
- Workflows: https://github.com/microsoft/agent-framework/tree/main/python/samples/03-workflows
