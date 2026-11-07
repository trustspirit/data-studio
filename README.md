# Datacon

**One studio for every database you run.** Datacon is a fast, keyboard-friendly desktop client that speaks to your relational databases, document stores, key-value caches, and message brokers — all from a single, polished dark UI.

No browser tabs full of admin consoles. No juggling five different clients. Connect, query, browse, and ship.

## One client, nine engines

| Relational | NoSQL | Messaging |
|---|---|---|
| PostgreSQL | MongoDB | Kafka |
| MySQL | Redis | RabbitMQ |
| MariaDB | DynamoDB | |
| SQLite | | |

Every engine gets a workspace tailored to how you actually use it — not a lowest-common-denominator table view.

## Highlights

### A SQL editor that knows your database
- **Dialect-aware autocomplete** — keywords for *your* engine (Postgres, MySQL, MariaDB, SQLite), plus live completion of your actual schemas and tables.
- **Snippets** — type `sel`, `join`, `cte`, `ins` and Tab through the blanks. Query skeletons in two keystrokes.
- **Full syntax highlighting** and `Cmd+Enter` to run. Cancel long queries mid-flight.
- Execution time, loaded row count, explicit pagination, and CSV export of loaded results.
- Pagination stays attached to the SQL that produced the result, even while you edit the next query.

### Browse and edit data, not just read it
- Virtualized results grid that stays smooth on large result sets.
- Inline data editing with explicit apply — no accidental writes.
- Resizable columns, sticky headers and row numbers, numeric alignment, and visible cell selection.
- Refreshing or sorting asks before discarding staged edits. Loaded results can be exported as CSV.
- Server-side column filters use bound parameters, including literal text matching and NULL conditions.
- Arrow keys navigate cells; Shift-click or Shift-arrow extends a rectangular selection. Copy uses tab-separated text and preserves exact numeric values.
- **Save** opens a before/after review. Changes reach the database only after **DB에 변경 적용**.
- Structure view for columns, indexes, and foreign keys at a glance.

### See your schema, literally
- **Auto-laid-out ER diagrams** built from your live schema — click a table in the diagram to jump straight to its structure.

### Beyond SQL
- **MongoDB** — browse collections and filter documents.
- **Redis** — scan and inspect keys with a dedicated key browser.
- **Kafka & RabbitMQ** — tail live messages from topics and queues, right next to your data.
- **DynamoDB** — first-class support, PartiQL included.

### Built for the AI era
Datacon is designed so an AI assistant can work with your data **without you giving up control**:

- Assign a **dedicated read-only account** per connection for AI access.
- AI-initiated **writes require your explicit approval** — every time.
- Multi-statement tricks are blocked; every statement is classified before it runs.
- A **complete audit trail** records who (human or AI) ran what, and when.

### Private by design
- Connections and database operations run locally. If you enable AI, context is sent to your selected external LLM provider; row data requires consent.
- Credentials use OS-backed encryption when available. Unsupported environments use session-only storage rather than saving unprotected secrets.
- Hardened Electron setup: sandboxed renderer, strict Content Security Policy.

## Getting started

```bash
npm ci
npm run dev        # launch in development
```

To build a distributable app (macOS):

```bash
npm run package
```

The renderer depends on Electron's preload bridge. Opening the Vite URL in a normal browser does not provide database access. Use `npm run dev` to launch the desktop app.

## First workflow

1. Select **새 연결 추가**, choose an engine, and enter connection details. SQLite can use a local database file without running a server.
2. Save the connection and select **연결**. Double-click a table to open its data, or open a Query tab.
3. Write SQL and press `Cmd+Enter` (`Ctrl+Enter` on Windows/Linux). Results show the loaded row count and execution time. **CSV 내보내기** saves only the rows already loaded.
4. Use **Cancel** to interrupt a running query. Closing its query tab also requests cancellation.

## Development checks

Use Node.js 24 and npm. Run the complete local quality gate before submitting a change:

```bash
npm run check
```

This runs TypeScript, ESLint, Vitest, and the production renderer/main builds. The same gate runs on pushes and pull requests in GitHub Actions, alongside a separate integration job that starts all test servers and requires every engine to be available. The regular local suite skips unavailable servers; use the integration command below to require them.

For engine integration tests, start the disposable services and run the suite:

```bash
docker compose -f docker-compose.test.yml up -d
npm run test:integration
```

The Compose file includes all eight external services; SQLite runs in-process. Ports are bound to localhost. Wait for the services to finish startup before running the integration gate. This command fails if any required server is unavailable, so missing engines cannot silently produce a passing integration run. Unsupported capability combinations and the live LLM test may still be skipped intentionally.

PostgreSQL can be overridden via `DATACON_TEST_PG_URL` (default `postgres://board:boardpw@localhost:5432/board`). The test account needs permission to create `datacon_test` and temporary schemas. Always use a disposable test instance. Other endpoint overrides are defined in `tests/contract/*TestEnv.ts`. Stop services after testing with `docker compose -f docker-compose.test.yml down`.

`npm run package:dir` produces an unpacked Electron application. `npm run verify:sqlite-native` checks the packaged SQLite native module; packaging and native-module checks are separate from the standard build gate.

## Status

Datacon is in release hardening (v0.1.0). A successful build is not a signed production release.

## Work recovery and failure handling

SQL drafts and open document tabs are saved through the main process to the OS-encrypted store. Reconnect explicitly to restore them; the app does not automatically connect to a database or rerun restored SQL. Query results and staged table edits are not written to recovery storage. Closing with unsaved SQL or unapplied table edits requests confirmation.

The recovery limit is 262,144 UTF-16 code units per SQL draft and 2 MiB of serialized UTF-8 data per connection. Save errors remain visible; preserve large queries separately. Without a usable OS keychain, storage is session-only and the UI warns that recovery will not survive restart. Corrupt JSON files receive owner-only `.corrupt-*` backups. Undecryptable workspace data is preserved rather than overwritten.

SQL operations sharing a physical session execute serially so transactions and read-only scopes cannot overlap across tabs. File writes are queued and committed atomically. Shutdown cancels ongoing work, closes connections and streams, and flushes recovery/audit writes.

## Release validation (macOS)

```bash
docker compose -f docker-compose.test.yml up -d
npm run release:check
```

The gate runs type/lint/unit/build checks, requires all eight external database services, audits production and development dependencies, runs an actual Electron/SQLite workflow, and verifies packaged native SQLite modules. Workflow screenshots are saved to `.openai/ui-review/`. The smoke uses generated fixtures and a mock keychain in its isolated test process only; shipping application code does not enable a mock keychain.

`verify:sqlite-native` executes the arm64 package and checks x64 packaging; x64 execution still needs an Intel Mac. Run the native gate on an arm64 Mac. Windows/Linux packaging and platform-specific keychain behavior require separate release validation. The live LLM test needs a provider key and is intentionally excluded from keyless CI.

For a signed and notarized macOS artifact, configure `CSC_NAME` for an installed **Developer ID Application** identity and provide `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` in your local environment or CI secret store, then run:

```bash
npm run release:mac
```

This repeats the release gate and builds with hardened runtime, signing, and notarization. It never publishes artifacts. Missing signing configuration is a hard failure; the regular `package`/`package:dir` commands remain unsigned internal-test builds. Public distribution must also verify Gatekeeper installation on a clean machine, credential recovery after upgrade, and update rollback behavior. The signed updater implementation is not yet connected to a user-facing release feed; automatic updates must not be advertised as available.
