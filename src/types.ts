/**
 * Core domain types for the doibio3 entity-resolution graph.
 *
 * The domain here is maritime vessels: heterogeneous sensors each emit
 * `Observation`s, and the resolver fuses them into canonical vessel
 * `Entity`s. Swap these types and the engine retypes to any entity domain.
 */

/** A single sighting of a vessel from one sensor at one moment in time. */
export interface Observation {
  /** Which sensor modality produced this sighting. */
  source: 'ais' | 'sar' | 'eo' | 'rf' | 'manual';
  /** Wall-clock time of the sighting (ISO-8601). */
  observedAt: string;

  /** Strong identifiers, present only when the source reports them. */
  imo?: string;       // permanent IMO hull number — never changes
  mmsi?: string;      // MMSI — can change with ownership / re-flagging
  callSign?: string;  // radio call sign

  /** Reported or inferred vessel name (AIS broadcast, EO/OCR, manual). */
  name?: string;

  /** Coarse physical attributes used as soft resolution anchors. */
  flagState?: string;
  vesselType?: string;
  lengthMetres?: number;

  /** Position, when the source provides it. */
  lat?: number;
  lon?: number;
}

/** The signal types the resolver can fire on. */
export type SignalType =
  | 'exact_imo'
  | 'exact_mmsi'
  | 'call_sign'
  | 'fuzzy_name'
  | 'anchor'
  | 'proximity';

/** One scored reason an observation was matched to an entity. */
export interface MatchReason {
  type: SignalType;
  detail: string;
  /** Per-signal confidence contribution, 0..1. */
  score: number;
}

/** What the resolver recommends doing with an observation. */
export type ResolveAction = 'merge' | 'link' | 'review' | 'new';

/** The outcome of resolving one observation against the entity set. */
export interface MatchResult {
  /** Matched entity, or null when the verdict is `new`. */
  entityId: string | null;
  /** Aggregate confidence, 0..1. */
  confidence: number;
  action: ResolveAction;
  reasons: MatchReason[];
}
