/**
 * The identity-resolution engine — the integrated-entity-view match step.
 *
 * Given an incoming observation, score it against every known entity across
 * several independent signals (strong identifiers, fuzzy name, physical
 * anchor, spatiotemporal reachability), combine those signals into one
 * confidence, and recommend an action: merge / link / review / new.
 *
 * This is the architecture described in US Patent 10,936,582 (see README),
 * retyped from the research-entity domain of the original doibio engine to
 * the maritime-vessel domain used by the planetar platform.
 */

import type { Observation, MatchReason, MatchResult, ResolveAction } from './types.js';
import type { Entity } from './graph.js';
import { nameSimilarity } from './levenshtein.js';

/** Great-circle distance between two lat/lon points, in nautical miles. */
export function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3440.065; // Earth radius, nautical miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Per-signal weight ceilings — exact identifiers dominate, soft signals corroborate. */
export const WEIGHTS = {
  exact_imo: 1.0,
  exact_mmsi: 0.95,
  call_sign: 0.9,
  fuzzy_name: 0.7,
  anchor: 0.5,
  proximity: 0.6,
} as const;

/** Action thresholds on the aggregate confidence. */
export const THRESHOLDS = { merge: 0.95, link: 0.8, review: 0.7 } as const;

/** Plausible vessel speed ceiling (knots) for the spatiotemporal gate. */
const MAX_SPEED_KN = 40;

/** Score one observation against one candidate entity, signal by signal. */
export function scoreCandidate(obs: Observation, ent: Entity): MatchReason[] {
  const reasons: MatchReason[] = [];

  // --- Strong identifiers -------------------------------------------------
  if (obs.imo && ent.imo && obs.imo === ent.imo) {
    reasons.push({ type: 'exact_imo', detail: `IMO ${obs.imo}`, score: WEIGHTS.exact_imo });
  }
  if (obs.mmsi && ent.mmsi && obs.mmsi === ent.mmsi) {
    reasons.push({ type: 'exact_mmsi', detail: `MMSI ${obs.mmsi}`, score: WEIGHTS.exact_mmsi });
  }
  if (obs.callSign && ent.callSign && obs.callSign.toUpperCase() === ent.callSign.toUpperCase()) {
    reasons.push({ type: 'call_sign', detail: `call sign ${obs.callSign}`, score: WEIGHTS.call_sign });
  }

  // --- Fuzzy name ---------------------------------------------------------
  if (obs.name && ent.canonicalName) {
    const sim = nameSimilarity(obs.name, ent.canonicalName);
    if (sim > 0.75) {
      reasons.push({
        type: 'fuzzy_name',
        detail: `name "${obs.name}" ~ "${ent.canonicalName}" (${(sim * 100).toFixed(0)}%)`,
        score: sim * WEIGHTS.fuzzy_name,
      });
    }
  }

  // --- Physical anchor: vessel type / hull length / flag state ------------
  {
    let score = 0;
    const bits: string[] = [];
    if (obs.vesselType && ent.vesselType && obs.vesselType.toLowerCase() === ent.vesselType.toLowerCase()) {
      score += 0.3;
      bits.push(obs.vesselType);
    }
    if (obs.lengthMetres && ent.lengthMetres && Math.abs(obs.lengthMetres - ent.lengthMetres) <= 10) {
      score += 0.25;
      bits.push(`${obs.lengthMetres} m hull`);
    }
    if (obs.flagState && ent.flagState && obs.flagState.toLowerCase() === ent.flagState.toLowerCase()) {
      score += 0.15;
      bits.push(obs.flagState);
    }
    if (score > 0) {
      reasons.push({ type: 'anchor', detail: bits.join(', '), score: Math.min(score, WEIGHTS.anchor) });
    }
  }

  // --- Spatiotemporal proximity: could the same hull be here, in time? ----
  if (
    obs.lat !== undefined && obs.lon !== undefined &&
    ent.lat !== undefined && ent.lon !== undefined &&
    ent.lastSeen && obs.observedAt
  ) {
    const nm = haversineNm(obs.lat, obs.lon, ent.lat, ent.lon);
    const hours = Math.abs(Date.parse(obs.observedAt) - Date.parse(ent.lastSeen)) / 3.6e6;
    const reachable = MAX_SPEED_KN * Math.max(hours, 1 / 60);
    if (nm <= reachable) {
      const closeness = 1 - nm / reachable; // 1 = same spot, 0 = at the limit
      reasons.push({
        type: 'proximity',
        detail: `${nm.toFixed(1)} nm in ${hours.toFixed(1)} h (reachable)`,
        score: closeness * WEIGHTS.proximity,
      });
    }
  }

  return reasons;
}

/**
 * Aggregate independent signals with a noisy-OR:
 *   confidence = 1 - product(1 - score_i)
 * Each corroborating signal can only raise confidence; a single strong
 * identifier already saturates it, and it never exceeds 1.
 */
export function aggregate(reasons: MatchReason[]): number {
  return 1 - reasons.reduce((p, r) => p * (1 - r.score), 1);
}

function decide(confidence: number, hasMatch: boolean): ResolveAction {
  if (!hasMatch) return 'new';
  if (confidence >= THRESHOLDS.merge) return 'merge';
  if (confidence >= THRESHOLDS.link) return 'link';
  if (confidence >= THRESHOLDS.review) return 'review';
  return 'new';
}

/** Resolve one observation against the current entity set. */
export function resolve(obs: Observation, entities: Iterable<Entity>): MatchResult {
  let best: { ent: Entity; reasons: MatchReason[]; confidence: number } | null = null;

  for (const ent of entities) {
    const reasons = scoreCandidate(obs, ent);
    if (reasons.length === 0) continue;
    const confidence = aggregate(reasons);
    if (!best || confidence > best.confidence) best = { ent, reasons, confidence };
  }

  if (!best) return { entityId: null, confidence: 0, action: 'new', reasons: [] };

  const action = decide(best.confidence, true);
  return {
    entityId: action === 'new' ? null : best.ent.id,
    confidence: best.confidence,
    action,
    reasons: best.reasons,
  };
}
