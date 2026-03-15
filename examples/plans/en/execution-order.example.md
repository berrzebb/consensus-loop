# Improvement Work Execution Order

> Status: `planned` | Type: execution-order index

## Purpose

This document orders the domain-specific design documents under `docs/en/design/improved/*`
by **execution sequence and prerequisite relationships**.

## Recommended Execution Order

| Order | Domain | Prerequisites | Criteria to advance |
|---|---|---|---|
| 1 | [sample-track-a](./sample-track-a/README.md) | none | Track A completion criteria met by code + tests |
| 2 | [sample-track-b](./sample-track-b/README.md) | A | Track B completion criteria met by code + tests |
| 3 | [sample-track-c](./sample-track-c/README.md) | A, B | Track C completion criteria met by code + tests |

## Recommended parallel start

Currently parallelizable:

- sample-track-a — no prerequisites, can start independently
