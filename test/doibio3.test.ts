/**
 * doibio3 test suite — run with `npm test`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { levenshteinDistance, nameSimilarity } from '../src/levenshtein.js';
import { EventLog } from '../src/event-log.js';
import { EntityGraph } from '../src/graph.js';
import { resolve, aggregate, haversineNm } from '../src/resolve.js';
import { EntityStore } from '../src/store.js';
import type { Observation } from '../src/types.js';
import type { Entity } from '../src/graph.js';

test('levenshtein distance', () => {
  assert.equal(levenshteinDistance('', 'abc'), 3);
  assert.equal(levenshteinDistance('kitten', 'sitting'), 3);
  assert.equal(levenshteinDistance('PACIFIC', 'PACIFIC'), 0);
});

test('name similarity is normalised and order-independent', () => {
  assert.equal(nameSimilarity('Pacific Dawn', 'PACIFIC DAWN'), 1);
  assert.ok(nameSimilarity('PACIFC DAWN', 'PACIFIC DAWN') > 0.9);
  assert.ok(nameSimilarity('Pacific Dawn', 'Coastal Ranger') < 0.5);
});

test('event log hash chain verifies, and detects tampering', () => {
  const log = new EventLog();
  log.append('entity.created', { id: 'a' });
  log.append('observation.recorded', { entityId: 'a' });
  log.append('observation.recorded', { entityId: 'a' });
  assert.doesNotThrow(() => log.verify());

  // Tamper with a committed event's payload.
  (log.all()[1].payload as Record<string, unknown>).entityId = 'evil';
  assert.throws(() => log.verify(), /tampered/);
});

test('graph projection is deterministic', () => {
  const log = new EventLog();
  log.append('entity.created', {
    id: 'vsl_1',
    observation: { source: 'ais', observedAt: '2026-01-01T00:00:00Z', name: 'Test' },
    confidence: 0,
  });
  const a = EntityGraph.project(log);
  const b = EntityGraph.project(log);
  assert.equal(a.entities.size, b.entities.size);
  assert.equal(a.entities.get('vsl_1')?.canonicalName, 'Test');
});

test('haversine distance is sane', () => {
  assert.equal(haversineNm(0, 0, 0, 0), 0);
  // ~1 degree of latitude is ~60 nm.
  assert.ok(Math.abs(haversineNm(48, -123, 49, -123) - 60) < 1);
});

test('noisy-OR aggregation never decreases or exceeds 1', () => {
  assert.equal(aggregate([]), 0);
  assert.equal(aggregate([{ type: 'exact_imo', detail: '', score: 1 }]), 1);
  const one = aggregate([{ type: 'anchor', detail: '', score: 0.5 }]);
  const two = aggregate([
    { type: 'anchor', detail: '', score: 0.5 },
    { type: 'proximity', detail: '', score: 0.5 },
  ]);
  assert.ok(two > one && two <= 1);
});

test('resolve: exact IMO match auto-merges', () => {
  const ent: Entity = {
    id: 'vsl_1', type: 'vessel', canonicalName: 'Pacific Dawn',
    imo: '9234567', observations: [], createdBy: 0,
  };
  const obs: Observation = { source: 'sar', observedAt: '2026-01-01T00:00:00Z', imo: '9234567' };
  const r = resolve(obs, [ent]);
  assert.equal(r.action, 'merge');
  assert.equal(r.entityId, 'vsl_1');
  assert.equal(r.confidence, 1);
});

test('resolve: nothing in common yields a new entity', () => {
  const ent: Entity = {
    id: 'vsl_1', type: 'vessel', canonicalName: 'Pacific Dawn',
    imo: '9234567', observations: [], createdBy: 0,
  };
  const obs: Observation = { source: 'ais', observedAt: '2026-01-01T00:00:00Z', imo: '1111111' };
  const r = resolve(obs, [ent]);
  assert.equal(r.action, 'new');
  assert.equal(r.entityId, null);
});

test('store: a dark vessel is re-identified across modalities', () => {
  const store = new EntityStore();

  // AIS identity.
  const a = store.ingest({
    source: 'ais', observedAt: '2026-05-15T00:00:00Z',
    imo: '9234567', mmsi: '316042118', name: 'PACIFIC DAWN',
    vesselType: 'Cargo', lengthMetres: 183, lat: 48.46, lon: -123.10,
  });
  assert.equal(a.created, true);

  // SAR detection after the vessel goes dark — soft signals only.
  const s = store.ingest({
    source: 'sar', observedAt: '2026-05-15T02:10:00Z',
    vesselType: 'Cargo', lengthMetres: 181, lat: 48.55, lon: -122.80,
  });
  assert.equal(s.created, false, 'SAR detection should re-acquire the dark vessel');
  assert.equal(s.entityId, a.entityId);

  // EO sighting with an OCR-mangled name confirms it.
  const e = store.ingest({
    source: 'eo', observedAt: '2026-05-15T02:25:00Z',
    name: 'PACIFC DAWN', vesselType: 'Cargo', lengthMetres: 182, lat: 48.57, lon: -122.74,
  });
  assert.equal(e.entityId, a.entityId);

  // One entity, three observations, full provenance chain.
  assert.equal(store.entities().length, 1);
  assert.equal(store.entity(a.entityId)?.observations.length, 3);
  assert.equal(store.provenance(a.entityId).length, 3);
});
