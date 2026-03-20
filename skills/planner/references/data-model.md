# Data Model Guide

## Purpose

The data model defines **database schemas, entity relationships, and data lifecycle**. Without it, implementers make independent schema decisions that diverge across tracks, causing migration conflicts and data integrity issues.

## Location

`{planning_dir}/{track}/data-model.md` — one per track that involves data persistence.

## When to Write

- Track introduces new database tables or collections
- Track modifies existing schema (add/remove/rename columns)
- Track changes entity relationships (foreign keys, indexes)
- Track introduces new data types that cross module boundaries

Do NOT write for tracks that only read existing data without schema changes.

## Structure

```markdown
# Data Model: {Track Name}

## Entity Relationship

```
┌──────────┐     1:N     ┌──────────┐
│ Workflow │─────────────│   Node   │
│          │             │          │
│ id (PK)  │             │ id (PK)  │
│ name     │             │ wf_id(FK)│
│ status   │             │ type     │
│ created  │             │ config   │
└──────────┘             └──────────┘
      │                        │
      │ 1:N                    │ 1:N
      ▼                        ▼
┌──────────┐             ┌──────────┐
│   Run    │             │   Edge   │
│          │             │          │
│ id (PK)  │             │ from(FK) │
│ wf_id(FK)│             │ to  (FK) │
│ result   │             │ label    │
└──────────┘             └──────────┘
```

## Tables

### workflows

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | UUID | PK, NOT NULL | Unique identifier |
| name | VARCHAR(100) | NOT NULL | Display name |
| status | ENUM('draft','active','archived') | NOT NULL, DEFAULT 'draft' | Lifecycle state |
| owner_id | UUID | FK → users.id, NOT NULL | Creator |
| config | JSONB | DEFAULT '{}' | Workflow-level settings |
| created_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Creation timestamp (UTC) |
| updated_at | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Last modification (UTC) |

**Indexes:**
- `idx_workflows_owner` ON (owner_id) — owner lookup
- `idx_workflows_status` ON (status) — status filtering

### nodes

| Column | Type | Constraints | Description |
|--------|------|------------|-------------|
| id | UUID | PK, NOT NULL | Unique identifier |
| workflow_id | UUID | FK → workflows.id ON DELETE CASCADE | Parent workflow |
| type | VARCHAR(50) | NOT NULL | Node type (llm, tool, condition, ...) |
| config | JSONB | NOT NULL | Type-specific configuration |
| position_x | INTEGER | NOT NULL | Canvas X coordinate |
| position_y | INTEGER | NOT NULL | Canvas Y coordinate |

## Migrations

### Migration naming
`{sequence}_{description}.sql` — e.g., `001_create_workflows.sql`

### Migration rules
- Always use `IF NOT EXISTS` for CREATE TABLE/INDEX
- Always use `IF EXISTS` for DROP
- Include both UP and DOWN sections
- Price/amount columns: `NUMERIC(20,8)` (never FLOAT)
- Timestamps: `TIMESTAMPTZ` (never TIMESTAMP without timezone)

### Example
```sql
-- UP
CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(status);

-- DOWN
DROP INDEX IF EXISTS idx_workflows_status;
DROP TABLE IF EXISTS workflows;
```

## Data Lifecycle

| State | Transition | Trigger | Side Effects |
|-------|-----------|---------|-------------|
| draft | draft → active | User publishes | Validate all nodes connected |
| active | active → archived | User archives | Stop running executions |
| archived | archived → active | User restores | Re-validate node configs |
| any | → deleted | User deletes | CASCADE delete nodes, runs |

## Data Constraints

- **Soft delete vs hard delete**: Specify per entity
- **Cascade rules**: Which deletions propagate
- **Uniqueness**: Which field combinations must be unique
- **Validation**: Business rules enforced at DB level (CHECK constraints)
```

## Writing Principles

1. **ASCII over diagrams** — Use ASCII art for ER diagrams. AI agents can read and implement from ASCII; image-based diagrams are opaque.
2. **Types are precise** — `VARCHAR(100)`, not `string`. `NUMERIC(20,8)`, not `number`. `TIMESTAMPTZ`, not `datetime`.
3. **Indexes are justified** — Every index must reference a query pattern (WHERE, JOIN, ORDER BY). Don't index speculatively.
4. **Migrations are reversible** — Every UP has a DOWN. This enables safe rollback.
5. **Lifecycle is explicit** — State transitions, cascade rules, and soft/hard delete policy prevent data integrity surprises.
6. **Link to PRD** — Each table should trace to an FR. A table without a requirement is either premature or missing from the PRD.

## Relationship to Other Documents

- **PRD** → defines WHAT data the system manages (FR acceptance criteria reference entity names)
- **API Contract** → defines HOW data is exposed via endpoints (response shapes mirror table columns)
- **Data Model** → defines WHERE and HOW data is stored (the source of truth for schema)
- **Work Breakdown** → migration WB items reference specific tables from the data model
