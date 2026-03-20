# API Contract Guide

## Purpose

API Contracts define the exact interface between layers (BE→FE, service→service). They are the **shared agreement** that both sides implement against, preventing the "it works on my machine" gap between tracks.

## Location

`{planning_dir}/{track}/api-contract.md` — per-track, covering all endpoints that track exposes or consumes.

## When to Write

- Any new API endpoint
- Any change to request/response shape of an existing endpoint
- Any new event/message schema (WebSocket, pub/sub, queue)
- Cross-track dependencies (Track A produces data that Track B consumes)

## Structure

```markdown
# API Contract: {Track Name}

## Endpoints

### `POST /api/v1/workflows`
**Owner**: BE (OR track)
**Consumer**: FE (FE track)
**PRD**: FR-3

#### Request
```json
{
  "name": "string (required, 1-100 chars)",
  "nodes": "WorkflowNode[] (required, min 1)",
  "metadata": {
    "description": "string (optional)",
    "tags": "string[] (optional)"
  }
}
```

#### Response (201 Created)
```json
{
  "data": {
    "id": "string (uuid)",
    "name": "string",
    "created_at": "string (ISO 8601)"
  }
}
```

#### Response (400 Bad Request)
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "string",
    "details": [{ "field": "string", "reason": "string" }]
  }
}
```

#### Auth
- Required: Bearer token
- Roles: `admin`, `editor`

---

## Events (WebSocket / Pub-Sub)

### `workflow.status_changed`
**Producer**: BE (OR track)
**Consumer**: FE (FE track)

#### Payload
```json
{
  "workflow_id": "string (uuid)",
  "old_status": "string (enum: draft|running|completed|failed)",
  "new_status": "string (enum: draft|running|completed|failed)",
  "timestamp": "string (ISO 8601)"
}
```

---

## Sequence Flows

Define the interaction sequence for multi-step operations. Use ASCII sequence diagrams — AI agents can read and implement from these directly.

### Example: Workflow Execution

```
User        FE              BE API          Agent Runtime     Redis
 │           │                │                │                │
 │──Run────→│                │                │                │
 │           │──POST /run───→│                │                │
 │           │               │──spawn────────→│                │
 │           │               │←─run_id────────│                │
 │           │←─202 {run_id}─│                │                │
 │           │               │                │──publish──────→│
 │           │               │                │  (status)      │
 │           │←──────────────│────────────────│←─subscribe─────│
 │           │  WebSocket    │                │  (status)      │
 │           │  status_changed│               │                │
 │←─UI update│               │                │                │
 │           │               │                │──complete─────→│
 │           │←─────────────────────────────────result─────────│
 │←─Result───│               │                │                │
```

### Data Flow (for complex transformations)

When data passes through multiple processing stages, document the transformation at each step:

```
Input                    Stage 1              Stage 2              Output
┌──────────┐        ┌──────────┐        ┌──────────┐        ┌──────────┐
│ Raw tool │──────→│ Reducer  │──────→│ Formatter│──────→│ Display  │
│ output   │        │          │        │          │        │ payload  │
│ (any)    │        │ truncate │        │ markdown │        │ (string) │
│          │        │ filter   │        │ highlight│        │          │
└──────────┘        └──────────┘        └──────────┘        └──────────┘
```

Each stage specifies:
- **Input type**: What it receives
- **Transform**: What it does
- **Output type**: What it produces
- **Error handling**: What happens when the stage fails (skip, fallback, propagate)

---

## Shared Types

Types referenced across multiple endpoints:

### WorkflowNode
```json
{
  "id": "string (uuid)",
  "type": "string (enum: llm|tool|condition|...)",
  "config": "object (type-specific)",
  "position": { "x": "number", "y": "number" }
}
```
```

## Writing Principles

1. **Types are explicit** — `string` is not enough. Specify format (`uuid`, `ISO 8601`, `enum: a|b|c`), constraints (`1-100 chars`, `min 1`), and whether the field is required or optional.
2. **Error responses are part of the contract** — Don't just define the happy path. Every endpoint must document at least 400 (validation) and 401/403 (auth) responses.
3. **Owner and Consumer** — Every endpoint and event has exactly one owner (who implements it) and one or more consumers. This maps directly to the CL (Cross-Layer) check in done-criteria.
4. **Link to PRD** — Each endpoint references the FR it implements. This enables traceability: FR-3 → API Contract → WB-2 → Implementation → Test.
5. **Versioned** — When an endpoint changes, add a "Changes" section with date and description. Don't silently modify the contract.

## Relationship to FVM

The API Contract is the **design-time** specification. The FVM (Functional Verification Matrix) is the **runtime** verification:
- API Contract says "POST /api/v1/workflows requires admin role"
- FVM validates "when viewer role sends POST /api/v1/workflows, server returns 403"
