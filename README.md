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
         |
    Q1: "Auth method?"
    +----+----+
    |    |    |
  OAuth  JWT  Session
    |    |      |
  Q2a  Q2b   Q2c: "Store?"
   |    |    +--+--+
  ...  ... Redis   DB
```

## Quick Start

```bash
npm install -g llmception

# Start exploring a task (runs while you're away)
llmception explore "add authentication to this app"

# When you return, answer questions interactively
llmception answer

# Or answer inline
llmception answer 2

# Apply the winning implementation
llmception apply

# Clean up worktrees
llmception cleanup
```

## How It Works

1. **You start an exploration**: `llmception explore "add auth"`
2. **Claude Code begins implementing** in an isolated git worktree
3. **When it hits a decision**, it calls `AskUserQuestion` — llmception intercepts this
4. **For each answer option**, llmception spawns a fresh Claude Code process in its own worktree, with the task + chosen answer baked into the prompt
5. **Each branch continues independently** — they may hit more questions and fork again
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
  "model": "sonnet"
}
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `provider` | `claude-cli` | LLM provider (`claude-cli`, `anthropic`, `openai`, `ollama`) |
| `maxDepth` | `3` | Max tree depth before auto-resolving questions |
| `maxWidth` | `4` | Max answer options per question |
| `nodeBudget` | `20` | Max total nodes in the tree |
| `concurrency` | `3` | Max parallel LLM processes |
| `model` | `sonnet` | Model to use |
| `budget.perBranchUsd` | `5.0` | Cost cap per branch (metered providers only) |
| `budget.totalUsd` | `25.0` | Total cost cap (metered providers only) |
| `budget.mode` | `hard` | Budget enforcement: `none`, `warn`, `hard` |

Budget limits only apply to metered API providers (Anthropic API, OpenAI). Subscription providers (Claude Code CLI) and local providers (Ollama) track tokens for display but never enforce cost limits.

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
Uses your installed Claude Code with subscription pricing (e.g. Max plan). Each branch runs as an independent `claude --print` session. No per-query cost.

```json
{ "provider": "claude-cli" }
```

### Anthropic API
Direct API calls with per-token pricing. **Warning**: token consumption scales with `width x depth` — a tree with 4 options at 3 levels deep can use significant tokens. Adjust `nodeBudget` and `budget.totalUsd` accordingly.

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
Free local execution. No per-query cost.

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
  --budget <usd>                Total budget cap (metered providers)
  --model <model>               Model override
  --provider <type>             Provider override
  --concurrency <n>             Max parallel processes
  --node-budget <n>             Max tree nodes
  --answer <value>              Pre-answer questions (repeatable, by index or label)

llmception answer [n]           Answer questions (interactive if no arg given)
                                Accepts number (1-based) or label substring

llmception status               Show exploration status
  --tree                        Full tree visualization
  --json                        JSON output

llmception diff [nodeId]        Show diff for a branch

llmception apply                Apply winning implementation

llmception cleanup              Remove all worktrees and state

llmception cost                 Show cost and token breakdown

llmception config               Show current config
llmception config set <k> <v>   Set config value
```

Shorthands: `e`=explore, `s`=status, `a`=answer, `d`=diff, `p`=apply, `c`=cleanup

## Example Output

```
$ llmception explore "add authentication to this app"

llmception -- exploring "add authentication to this app"
  Provider: claude-cli | Model: sonnet | Depth: 3 | Width: 4 | Budget: 20 nodes
  Press Ctrl+C to stop exploration (progress is saved)

START   [ROOT] add authentication to this app
TOOL    [ROOT] Read
TOOL    [ROOT] Glob
ASK     [ROOT] Auth method? (3 options)
FORK    [ROOT] 3 branches: JWT, OAuth2, Session-based
DONE    [JWT] 18.2k tokens
DONE    [OAuth2] 15.8k tokens
DONE    [Session-based] 12.1k tokens
--- 3 done | 1 questioned | 46.1k in / 55.2k out | 4m12s

Exploration complete (4m12s)

Next step: run "llmception answer" to pick your preferred implementation.

$ llmception answer

  Question: Auth method?
    1. JWT [1 nodes: 1 done]
    2. OAuth2 [1 nodes: 1 done]
    3. Session-based [1 nodes: 1 done]

  Your choice: 1
  Chose: "JWT" (pruned 2 branches)

  Resolved: JWT
  Run "llmception apply" to apply changes to your working tree.

$ llmception apply
  Applying branch: llmception/abc123/def456
  12 files changed, +487/-23
  Changes applied successfully.
```

## Architecture

```
CLI -> Orchestrator -> Provider (claude --print) -> Stream Parser -> Question Detector
                |                                                          |
          Decision Tree <---- Forker (snapshot + worktree + fresh session)
                |
          Cost Tracker (tokens for subscription, $ for metered)
```

Each node in the tree runs in its own git worktree, branched from a snapshot of the parent's state at the decision point. The tree is serialized to `.llmception/tree-<id>.json` for crash recovery and Ctrl+C resume. Git worktrees live in `.llmception-worktrees/`. Both are auto-gitignored.

## Development

```bash
git clone https://github.com/xMKx/llmception.git
cd llmception
npm install
npm test            # 401 tests
npm run dev         # Run CLI without building
npm run build       # Compile TypeScript
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

MIT
