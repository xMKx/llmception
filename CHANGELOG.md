# Changelog

## [0.1.0] - 2026-04-07

### Added
- Decision tree engine with N-ary branching at each question
- Stream interceptor for Claude Code `--output-format stream-json`
- Question detection via AskUserQuestion tool interception + text fallback
- Git worktree-based branch isolation
- Session forking via `--resume --fork-session`
- Multi-provider support: Claude Code CLI, Anthropic API, OpenAI API, Ollama
- Configurable depth, width, node budget, and concurrency
- Per-branch and total cost tracking with budget enforcement
- CLI commands: explore, status, answer, diff, apply, cleanup, cost, config
- Tree serialization for crash recovery
- Pruning: user-answer, budget, and subtree
- CI pipeline with lint, typecheck, and tests on Node 20/22
