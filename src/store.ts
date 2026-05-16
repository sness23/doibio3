/**
 * The entity store ties the three pieces together.
 *
 * `ingest()` resolves an observation against the live graph, records the
 * outcome as an event, and re-projects. Re-projecting the whole graph on
 * every ingest is deliberately the simplest correct choice for a reference
 * implementation: it proves the graph is nothing but a function of the log.
 * (An incremental projection is the obvious later optimisation.)
 */

import { randomUUID } from 'node:crypto';
import { EventLog, type DoibioEvent } from './event-log.js';
import { EntityGraph, type Entity } from './graph.js';
import { resolve } from './resolve.js';
import type { Observation, MatchResult } from './types.js';

export interface IngestResult {
  entityId: string;
  created: boolean;
  match: MatchResult;
}

export class EntityStore {
  private graph: EntityGraph;

  constructor(private readonly log: EventLog = new EventLog()) {
    this.graph = EntityGraph.project(log);
  }

  /** Resolve one observation and record the outcome. */
  ingest(obs: Observation): IngestResult {
    const match = resolve(obs, this.graph.entities.values());

    if (match.action === 'new' || match.entityId === null) {
      const id = `vsl_${randomUUID().slice(0, 8)}`;
      this.log.append('entity.created', { id, observation: obs, confidence: match.confidence });
      this.graph = EntityGraph.project(this.log);
      return { entityId: id, created: true, match };
    }

    this.log.append('observation.recorded', {
      entityId: match.entityId,
      observation: obs,
      action: match.action,
      confidence: match.confidence,
    });
    this.graph = EntityGraph.project(this.log);
    return { entityId: match.entityId, created: false, match };
  }

  /** Record an explicit typed edge between two entities. */
  link(from: string, to: string, kind: string): void {
    this.log.append('entities.linked', { from, to, kind });
    this.graph = EntityGraph.project(this.log);
  }

  entities(): Entity[] {
    return [...this.graph.entities.values()];
  }

  entity(id: string): Entity | undefined {
    return this.graph.entities.get(id);
  }

  events(): readonly DoibioEvent[] {
    return this.log.all();
  }

  /** The ordered events that built a given entity — its full lineage. */
  provenance(id: string): DoibioEvent[] {
    const ent = this.graph.entities.get(id);
    if (!ent) return [];
    const seqs = new Set<number>([ent.createdBy, ...ent.observations.map((o) => o.eventSeq)]);
    return this.log.all().filter((e) => seqs.has(e.seq));
  }
}
