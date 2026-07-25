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

### Browse and edit data, not just read it
- Virtualized results grid that stays smooth on large result sets.
- Inline data editing with explicit apply — no accidental writes.
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
- A local desktop app — your connections, credentials, and query results stay on your machine.
- Credentials are stored **encrypted with OS-level encryption**, never in plain text.
- Hardened Electron setup: sandboxed renderer, strict Content Security Policy.

## Getting started

```bash
npm install
npm run dev        # launch in development
```

To build a distributable app (macOS):

```bash
npm run package
```

## Status

Datacon is in active development (v0.1.0). Expect rapid iteration — and feel free to open an issue with ideas or bugs.
