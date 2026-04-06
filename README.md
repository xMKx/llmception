# llmception

A daemon that explores multiple implementation paths for ambiguous LLM prompts by building decision trees across parallel git worktrees.

## The Problem

When you give an LLM a coding task like "add authentication to this app" and walk away, the LLM either:
1. **Asks a question and waits** — blocking until you return
2. **Makes assumptions** — picks one approach silently, which may not be what you wanted

## The Solution

llmception intercepts decision points during LLM execution and **forks into all reasonable alternatives simultaneously**. It builds a decision tree where:

- **Internal nodes** = questions the LLM would have asked
- **Edges** = answer options (N-ary, not just binary)
- **Leaves** = complete implementations

When you return, you **answer questions** instead of reviewing code. Each answer prunes entire subtrees instantly, converging to your preferred implementation.

```
"add auth to this app"
         │
    Q1: "Auth method?"
    ┌────┼────┐
    │    │    │
  OAuth  JWT  Session
    │    │      │
  Q2a  Q2b   Q2c: "Store?"
   │    │    ┌──┴──┐
  ...  ... Redis   DB
```

## Quick Start

```bash
npm install -g llmception

# Start exploring a task (runs while you're away)
llmception explore "add authentication to this app"

# Check what was explored
llmception status

# Answer questions to narrow down
llmception answer 2    # Pick option 2 for first question
llmception answer 1    # Pick option 1 for second question

# Apply the winning implementation
llmception apply

# Clean up worktrees
llmception cleanup
```

## How It Works

1. **You start an exploration**: `llmception explore "add auth"`
2. **Claude Code begins implementing** in a git worktree
3. **When it hits a decision**, it calls `AskUserQuestion` — llmception intercepts this
4. **For each answer option**, llmception forks execution via `--resume --fork-session`, each in its own worktree
5. **Forks continue independently** — they may hit more questions and fork again
6. **The tree grows** until all leaves are complete implementations (or budget/depth limits are reached)
7. **You return** and walk the tree by answering questions — each answer prunes the alternatives
8. **One implementation remains** — apply it to your working tree

## Configuration

Create `.llmception.json` in your project root:

```json
{
  "provider": "claude-cli",
  "maxDepth": 3,
  "maxWidth": 4,
  "nodeBudget": 20,
  "concurrency": 3,
  "model": "sonnet",
  "budget": {
    "perBranchUsd": 5.0,
    "totalUsd": 25.0,
    "mode": "hard"
  }
}
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `provider` | `claude-cli` | LLM provider (`claude-cli`, `anthropic`, `openai`, `ollama`) |
| `maxDepth` | `3` | Max tree depth before auto-resolving |
| `maxWidth` | `4` | Max answer options per question |
| `nodeBudget` | `20` | Max total nodes in the tree |
| `concurrency` | `3` | Max parallel LLM processes |
| `model` | `sonnet` | Model to use |
| `budget.perBranchUsd` | `5.0` | Cost cap per branch |
| `budget.totalUsd` | `25.0` | Total cost cap |
| `budget.mode` | `hard` | Budget enforcement: `none`, `warn`, `hard` |

### Environment Variables

```bash
LLMCEPTION_PROVIDER=claude-cli
LLMCEPTION_MAX_DEPTH=3
LLMCEPTION_MAX_WIDTH=4
LLMCEPTION_NODE_BUDGET=20
LLMCEPTION_CONCURRENCY=3
LLMCEPTION_MODEL=sonnet
ANTHROPIC_API_KEY=sk-...       # For anthropic provider
OPENAI_API_KEY=sk-...          # For openai provider
```

## Providers

### Claude Code CLI (default)
Uses your installed Claude Code with subscription pricing. Supports native session forking (`--resume --fork-session`) for optimal context preservation. No per-query cost.

```json
{ "provider": "claude-cli" }
```

### Anthropic API
Direct API calls with per-token pricing. Fork is simulated via context replay.

```json
{
  "provider": "anthropic",
  "providers": {
    "anthropic": { "apiKey": "${ANTHROPIC_API_KEY}", "model": "claude-sonnet-4-20250514" }
  }
}
```

### OpenAI API
```json
{
  "provider": "openai",
  "providers": {
    "openai": { "apiKey": "${OPENAI_API_KEY}", "model": "gpt-4o" }
  }
}
```

### Ollama (local)
Free local execution. No fork support.

```json
{
  "provider": "ollama",
  "providers": {
    "ollama": { "baseUrl": "http://localhost:11434", "model": "llama3" }
  }
}
```

## CLI Reference

```
llmception explore <task>       Start exploring a task
  --depth <n>                   Max tree depth
  --width <n>                   Max options per question
  --budget <usd>                Total budget cap
  --model <model>               Model override
  --provider <type>             Provider override
  --concurrency <n>             Max parallel processes
  --node-budget <n>             Max tree nodes

llmception status               Show exploration status
  --tree                        Full tree visualization
  --json                        JSON output

llmception answer <n>           Answer current question (1-based index)

llmception diff [nodeId]        Show diff for a branch

llmception apply                Apply winning implementation

llmception cleanup              Remove all worktrees and state

llmception cost                 Show cost breakdown

llmception config               Show current config
llmception config set <k> <v>   Set config value
```

Shorthands: `e`=explore, `s`=status, `a`=answer, `d`=diff, `p`=apply, `c`=cleanup

## Architecture

```
CLI → Orchestrator → Provider → Stream Parser → Question Detector
                  ↕                                    ↓
            Decision Tree ←──── Forker (snapshot + worktree + fork-session)
                  ↕
            Cost Tracker
```

The tree is serialized to `.llmception/tree-<id>.json` for crash recovery. Git worktrees live in `.llmception-worktrees/`. Both are gitignored.

## Development

```bash
git clone https://github.com/xMKx/llmception.git
cd llmception
npm install
npm test            # Run tests
npm run dev         # Run CLI without building
npm run build       # Compile TypeScript
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

MIT
