# llmception

## Purpose
Daemon that explores multiple implementation approaches for ambiguous LLM prompts in parallel using a decision tree over git worktrees.

## Tech Stack
- TypeScript, Node.js 20+, ESM modules
- Commander.js for CLI
- Vitest for testing
- No runtime framework dependencies (lightweight)

## Conventions
- Source in src/, tests in test/
- Strict TypeScript, no `any`
- All async code uses async/await
- Modules export interfaces, not classes where possible
- Git worktrees for isolation, file-based state for persistence
- Budget-aware: every LLM call must go through CostTracker
- All imports use .js extensions (ESM)

## Commands
- `npm run build` — compile TypeScript
- `npm run dev` — run CLI via tsx
- `npm test` — run all tests
- `npm run lint` — lint
- `npm run typecheck` — type check
- `npm run format` — format code

## Architecture
Core flow: CLI → Orchestrator → Provider (Claude CLI / API) → Stream Parser → Question Detector → Forker (snapshot + worktree + fork session) → Decision Tree

Key modules:
- `src/tree/` — N-ary decision tree data structure
- `src/interceptor/` — Parse LLM output streams, detect questions
- `src/runner/` — Process pool + orchestrator
- `src/forker/` — Git snapshots and session forking
- `src/providers/` — LLM backend abstraction (CLI, API, local)
- `src/commands/` — CLI command handlers
