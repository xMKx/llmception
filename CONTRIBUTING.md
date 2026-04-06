# Contributing to llmception

Thanks for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/xMKx/llmception.git
cd llmception
npm install
```

## Commands

```bash
npm run dev           # Run CLI via tsx (no build needed)
npm run build         # Compile TypeScript
npm test              # Run tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
npm run lint          # Lint
npm run lint:fix      # Auto-fix lint issues
npm run typecheck     # Type check
npm run format        # Format code
```

## Project Structure

```
src/
  cli.ts              # CLI entry point
  types.ts            # Shared type definitions
  commands/           # CLI command handlers
  tree/               # Decision tree data structure
  interceptor/        # Stream parsing and question detection
  runner/             # Process orchestration and execution
  forker/             # Git snapshots and session forking
  git/                # Git worktree management
  providers/          # LLM provider implementations
  config/             # Configuration loading
  cost/               # Cost tracking and budgets
  util/               # Shared utilities
```

## Guidelines

- Write tests for all new functionality
- Run `npm test && npm run typecheck && npm run lint` before submitting
- Keep PRs focused on a single change
- Use conventional commit messages (e.g., `feat:`, `fix:`, `refactor:`)

## Testing

Tests use [vitest](https://vitest.dev/). Unit tests live in `test/unit/` mirroring the `src/` structure.

For modules that interact with git, tests create real temporary repositories. For modules that interact with LLM providers, tests use mock providers.

## Adding a New Provider

1. Create `src/providers/<name>.ts` implementing `ExecutionProvider` from `types.ts`
2. Add the provider type to `ProviderType` in `types.ts`
3. Register it in `src/providers/registry.ts`
4. Add tests in `test/unit/providers/<name>.test.ts`
5. Document in README

## Reporting Issues

Use GitHub Issues. Include your environment details, llmception version, and debug logs (`LLMCEPTION_DEBUG=1`).
