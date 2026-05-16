/**
 * The entity graph — a pure projection of the event log.
 *
 * An `Entity` is the "integrated entity view": one vessel assembled from many
 * observations arriving across different sensors. Nothing is stored here that
 * is not derivable by replaying the log, so `EntityGraph.project(log)` is
 * deterministic and always reproducible.
 */

import type { Observation } from './types.js';
import type { DoibioEvent, EventLog } from './event-log.js';

/** An observation as held on an entity, with the lineage of how it got there. */
export interface ObservationRecord {
  observation: Observation;
  /** Event seq that recorded this observation. */
  eventSeq: number;
  /** Resolver verdict at the time it was ingested. */
  action: string;
  confidence: number;
}

/** A resolved vessel, fused from one or more observations. */
export interface Entity {
  id: string;
  type: 'vessel';
  canonicalName: string;
  imo?: string;
  mmsi?: string;
  callSign?: string;
  flagState?: string;
  vesselType?: string;
  lengthMetres?: number;
  /** Most recent known position. */
  lat?: number;
  lon?: number;
  lastSeen?: string;
  /** Every observation fused into this entity, each with its provenance. */
  observations: ObservationRecord[];
  /** Event seq that created the entity. */
  createdBy: number;
}

/** A typed edge between two entities (e.g. a rendezvous), with evidence. */
export interface Link {
  from: string;
  to: string;
  kind: string;
  /** Event seqs that justify the link. */
  evidence: number[];
}

export class EntityGraph {
  readonly entities = new Map<string, Entity>();
  readonly links: Link[] = [];

  /** Build a graph by replaying an entire event log. */
  static project(log: EventLog): EntityGraph {
    const g = new EntityGraph();
    for (const e of log.all()) g.apply(e);
    return g;
  }

  private apply(e: DoibioEvent): void {
    switch (e.type) {
      case 'entity.created': {
        const p = e.payload as { id: string; observation: Observation; confidence: number };
        const obs = p.observation;
        this.entities.set(p.id, {
          id: p.id,
          type: 'vessel',
          canonicalName: obs.name ?? p.id,
          imo: obs.imo,
          mmsi: obs.mmsi,
          callSign: obs.callSign,
          flagState: obs.flagState,
          vesselType: obs.vesselType,
          lengthMetres: obs.lengthMetres,
          lat: obs.lat,
          lon: obs.lon,
          lastSeen: obs.observedAt,
          observations: [{ observation: obs, eventSeq: e.seq, action: 'new', confidence: p.confidence }],
          createdBy: e.seq,
        });
        break;
      }
      case 'observation.recorded': {
        const p = e.payload as {
          entityId: string;
          observation: Observation;
          action: string;
          confidence: number;
        };
        const ent = this.entities.get(p.entityId);
        if (!ent) throw new Error(`graph: observation for unknown entity ${p.entityId}`);
        ent.observations.push({
          observation: p.observation,
          eventSeq: e.seq,
          action: p.action,
          confidence: p.confidence,
        });
        this.fuse(ent, p.observation);
        break;
      }
      case 'entities.linked': {
        const p = e.payload as { from: string; to: string; kind: string };
        this.links.push({ from: p.from, to: p.to, kind: p.kind, evidence: [e.seq] });
        break;
      }
    }
  }

  /** Fold a newly-matched observation into an entity: fill gaps, advance position. */
  private fuse(ent: Entity, obs: Observation): void {
    ent.imo ??= obs.imo;
    ent.mmsi ??= obs.mmsi;
    ent.callSign ??= obs.callSign;
    ent.flagState ??= obs.flagState;
    ent.vesselType ??= obs.vesselType;
    ent.lengthMetres ??= obs.lengthMetres;
    if (obs.name && ent.canonicalName === ent.id) ent.canonicalName = obs.name;
    if (obs.observedAt && (!ent.lastSeen || obs.observedAt >= ent.lastSeen)) {
      ent.lastSeen = obs.observedAt;
      if (obs.lat !== undefined) ent.lat = obs.lat;
      if (obs.lon !== undefined) ent.lon = obs.lon;
    }
  }
}
