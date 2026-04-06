# GitHub Agent Orchestrator 🤖

AI agent that monitors GitHub issues across **multiple repositories** and automatically creates Pull Requests to resolve them.

## Features

- 🌐 **Web Dashboard** - Configure and monitor all repos from a web UI
- 🔄 **Multi-Repo Support** - Manage unlimited repositories
- ⏰ **Polling-Based** - No webhooks needed, works via periodic polling
- 🤔 **Smart Clarification** - Asks for details when unclear
- 📝 **Auto PR Creation** - Automatically creates Pull Requests

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Start web dashboard (port 9999)
npm start

# Or run specific commands
npm run cli -- run        # Run once (single repo)
npm run cli -- daemon     # Run as daemon (single repo)
npm run cli -- list       # List issues
```

## Web Dashboard

Start the orchestrator with web mode:

```bash
npm start
```

Then open: **http://localhost:9999**

### Dashboard Features

- ➕ Add/Remove repositories
- ⏯️ Enable/Disable monitoring per repo
- 📊 View processing statistics
- 📜 Activity logs
- ⚙️ Configure polling intervals and labels

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Web Dashboard (9999)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│  │ Add Repo │  │ Enable/  │  │ View     │                 │
│  │ Form     │  │ Disable  │  │ Logs     │                 │
│  └──────────┘  └──────────┘  └──────────┘                 │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    SQLite Database                           │
│  ~/.github-agent-orchestrator/orchestrator.db              │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   Orchestrator Runner                       │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │  Worker 1    │  │  Worker 2   │  │  Worker N   │        │
│  │  (repo A)   │  │  (repo B)   │  │  (repo N)   │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
└─────────┼─────────────────┼─────────────────┼───────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
    ┌───────────┐     ┌───────────┐     ┌───────────┐
    │  GitHub   │     │  GitHub   │     │  GitHub   │
    │  Repo A   │     │  Repo B   │     │  Repo N   │
    └───────────┘     └───────────┘     └───────────┘
```

## Workflow

1. **Add Repository** - Configure local path and GitHub repo
2. **Agent Polls** - Checks for issues with configured labels
3. **Analysis** - Detects task type and confidence
4. **Clarification** (if needed) - Asks questions in the issue
5. **Implementation** - Creates branch, makes changes
6. **PR Created** - Opens Pull Request automatically

## Issue Labels

| Label | Description |
|-------|-------------|
| `agent:ready` | Ready for agent to process |
| `agent:implementing` | Agent is working on it |
| `agent:done` | Successfully resolved |
| `agent:failed` | Processing failed |
| `agent:blocked` | Needs clarification |

## Environment Variables

```bash
GITHUB_TOKEN=ghp_xxx          # GitHub Personal Access Token
PORT=9999                     # Web dashboard port (default)
LOG_LEVEL=info                # Logging level
```

## Single Repo Mode (CLI)

You can also run the orchestrator for a single repo without the web UI:

```bash
# Set environment
export GITHUB_TOKEN=your_token
export GITHUB_REPO=owner/repo
export GITHUB_REPO_PATH=/path/to/local/repo

# Run once
npm run cli -- run

# Run as daemon
npm run cli -- daemon

# List issues
npm run cli -- list
```

## Installation

```bash
git clone https://github.com/your-username/github-agent-orchestrator.git
cd github-agent-orchestrator
npm install
npm run build
```

## Docker

```bash
# Build
docker build -t github-agent-orchestrator .

# Run
docker run -p 9999:9999 \
  -e GITHUB_TOKEN=your_token \
  -v /path/to/repos:/repos \
  github-agent-orchestrator
```

## License

MIT
