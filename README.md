# doibio3

A **minimal entity-resolution graph**: an append-only event log, an entity-graph
projection, and a confidence-weighted identity resolver — about 600 lines of
dependency-free TypeScript.

It is a compact, self-contained reference implementation of the entity-graph
layer used by the [planetar](https://github.com/sness23/planetar-broker)
multi-modal situational-awareness platform. The domain here is **maritime
vessels**: heterogeneous sensors (AIS, SAR, EO, RF) each emit observations, and
the resolver fuses them into canonical vessel entities — including
re-identifying a vessel that has gone *dark* by disabling its AIS transponder.

## Quick start

```sh
npm install      # dev dependency: typescript only
npm test         # build + run the test suite
npm run demo     # build + run the dark-vessel re-identification demo
```

Requires Node.js >= 20. There are **no runtime dependencies** — only Node
built-ins (`node:crypto`, `node:fs`, `node:test`).

## How it works

Three small pieces, each in `src/`:

| Module | Role |
|---|---|
| `event-log.ts` | Append-only, **SHA-256 hash-chained** event log — the single source of truth. Any later tampering breaks the chain and is caught by `verify()`. |
| `graph.ts` | The **entity graph**, built purely by replaying the log. Replaying the same log always reconstructs the same graph (event sourcing). Every entity and observation carries the event `seq` that produced it — full provenance. |
| `resolve.ts` | The **identity resolver**. Scores an incoming observation against every known entity across independent signals, combines them, and recommends `merge` / `link` / `review` / `new`. |
| `store.ts` | Binds the three: `ingest()` resolves an observation, records the outcome as an event, and re-projects the graph. |

### Resolution signals

Each signal contributes an independent confidence in `[0, 1]`; they are combined
with a **noisy-OR** (`1 - Π(1 - score)`), so corroborating signals raise
confidence and a single strong identifier already saturates it.

| Signal | Weight | Notes |
|---|---|---|
| `exact_imo` | 1.00 | IMO hull number — permanent, never reassigned |
| `exact_mmsi` | 0.95 | MMSI — can change with ownership / re-flagging |
| `call_sign` | 0.90 | radio call sign |
| `fuzzy_name` | 0.70 | Levenshtein name similarity (tolerates OCR / transcription error) |
| `proximity` | 0.60 | spatiotemporal reachability — could the same hull be here, in this time? |
| `anchor` | 0.50 | physical class: vessel type, hull length, flag state |

Aggregate confidence then maps to an action: `>= 0.95` merge, `>= 0.80` link,
`>= 0.70` review, otherwise a new entity.

### The demo

`npm run demo` runs a Salish Sea scenario: a cargo vessel broadcasts AIS, goes
dark, and is then re-acquired by satellite SAR and a coastal camera. The SAR
detection — with no transponder data — produces only a **review**-grade
re-identification; the EO sighting corroborates it to a confident **link**. The
event log is persisted to `data/dark-vessel.jsonl`, then replayed from disk to
show the graph reprojects identically and the hash chain verifies.

## Provenance

The integrated-entity-view architecture this engine follows is described in
**US Patent 10,936,582** (assignee: Salesforce, Inc.); the author of this
repository is one of the patent's 19 named inventors. This repository is
independent, original code — it shares the architectural *pattern*, not the
assignee's source.

`doibio3` is a deliberately minimal distillation: the larger private `doibio`
research codebase implements the same mechanism at greater scale (more entity
schemas, persistent storage, network I/O). This repository keeps only the core
that makes the pattern legible and testable.

## License

[GNU Affero General Public License v3.0 or later](./LICENSE) (AGPL-3.0-or-later).
