# AGENTS.md

## Purpose
Project-specific rules for AI coding agents working in `homey-watts-live`.

## Scope
- Apply these rules to the entire repository.
- Follow direct user instructions first when they conflict with this file.

## Project Context
- This is a Homey app for Watts Live energy meters.
- Runtime-critical paths are mainly `drivers/watts-live/device.ts`, `drivers/watts-live/driver.ts`, and `lib/*.ts`.
- Pairing flow pages/scripts are in `drivers/watts-live/pair/`.

## Working Rules
1. Keep changes minimal and task-focused.
2. Do not refactor unrelated code while fixing a bug or adding a small feature.
3. Preserve existing behavior unless the task explicitly requires behavior changes.
4. Prefer extending existing patterns over introducing new architecture.
5. Never add secrets, broker credentials, or tokens to source files or logs.
6. Suggest refactoring when new, more efficient code patterns are available, but do not refactor automatically.

## TypeScript and Style Rules
1. Match current TypeScript style and file structure.
2. Prefer explicit, safe typing over broad `any`.
3. Keep imports grouped and consistent with existing files.
4. Use concise comments only where logic is non-obvious.
5. Avoid cosmetic formatting-only diffs.

## Homey and MQTT Safety Rules
1. Treat MQTT payloads as untrusted input and validate before use.
2. Keep reconnect/disconnect logic deterministic and cleanup-safe.
3. Do not block pairing handlers with unnecessary long operations.
4. Avoid noisy logging in hot paths unless debug mode is enabled.
5. Preserve device capability compatibility and migration behavior.
6. When changing capabilities or settings keys, include migration handling.

## File Change Preferences
1. Prefer editing `drivers/watts-live/*.ts`, `lib/*.ts`, and `types/*.ts`.
2. Avoid modifying generated/build artifacts unless explicitly requested.
3. Update docs (`README.md`) when user-visible behavior changes.
4. Only change `package-lock.json` when dependencies are intentionally changed.

## Validation Checklist (before finishing)
1. Run `npm run build`.
2. Run `npm run lint`.
3. If behavior changed, summarize expected runtime impact in the final response.
4. If commands cannot run in the environment, state that clearly.

## Response Expectations
1. Report exactly what files were changed and why.
2. Call out risks, assumptions, and any skipped validation.
3. Keep final summaries short and actionable.
