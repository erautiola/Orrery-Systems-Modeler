# REST API

Base URL: `/api`. All bodies are JSON. Implemented in
[`server/server.js`](../server/server.js) over the file store in
[`server/store.js`](../server/store.js).

| Method | Path | Body | Returns | Notes |
|--------|------|------|---------|-------|
| `GET`  | `/api/health` | – | `{ ok, time }` | liveness |
| `GET`  | `/api/projects` | – | `[summary]` | id, name, rev, counts, timestamps |
| `POST` | `/api/projects` | `{ name, model? }` | `201 project` | creates; empty model if omitted |
| `GET`  | `/api/projects/:id` | – | `project` | full document incl. `model` |
| `PUT`  | `/api/projects/:id` | `{ name?, model?, rev? }` | `project` | **409** if `rev` is stale |
| `PATCH`| `/api/projects/:id` | `{ name }` | `project` | rename only |
| `DELETE`| `/api/projects/:id` | – | `204` | removes from the shared library |

### Project document

```json
{
  "id": "8f3a…",
  "name": "Satellite",
  "rev": 4,
  "createdAt": 1719500000000,
  "updatedAt": 1719600000000,
  "model": { "name": "Satellite", "elements": [], "relationships": [], "diagrams": [], "tables": [] }
}
```

### Optimistic concurrency

`PUT` includes the `rev` the client loaded. The store bumps `rev` on every
successful save; if the supplied `rev` ≠ the stored `rev`, it responds **409
Conflict** so a stale client cannot overwrite a teammate's work. See the
[save flow](FLOWS.md#save-project-optimistic-concurrency).

### Examples

```bash
# list
curl localhost:8080/api/projects

# create
curl -X POST localhost:8080/api/projects \
  -H 'content-type: application/json' \
  -d '{"name":"Demo"}'

# save (with concurrency check)
curl -X PUT localhost:8080/api/projects/<id> \
  -H 'content-type: application/json' \
  -d '{"name":"Demo","model":{...},"rev":1}'
```

### Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `PORT` | `8137` | server listen port (container-internal) |
| `DATA_DIR` | `/data` | project library directory |

XMI import/export and SVG/CSV export happen **in the browser** — the server only
stores the resulting JSON model, which keeps it dependency-light and OS-agnostic.
