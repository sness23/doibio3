/**
 * Demo: dark-vessel re-identification in the Salish Sea.
 *
 * A cargo vessel broadcasts AIS, then goes dark (disables AIS to evade
 * monitoring). It is later re-acquired by satellite SAR and a coastal
 * camera. The resolver fuses those heterogeneous sightings back onto the
 * same entity — at a calibrated, signal-by-signal confidence.
 *
 * Run:  npm run demo
 */

import { mkdirSync, rmSync } from 'node:fs';
import { EventLog } from '../src/event-log.js';
import { EntityGraph } from '../src/graph.js';
import { EntityStore } from '../src/store.js';
import type { Observation } from '../src/types.js';

const LOG_FILE = 'data/dark-vessel.jsonl';

/** The scenario, in arrival order. */
const feed: { note: string; obs: Observation }[] = [
  {
    note: 'AIS — vessel broadcasting normally, full identity',
    obs: {
      source: 'ais', observedAt: '2026-05-15T00:00:00Z',
      imo: '9234567', mmsi: '316042118', callSign: 'CFK7821', name: 'PACIFIC DAWN',
      flagState: 'Canada', vesselType: 'Cargo', lengthMetres: 183,
      lat: 48.40, lon: -123.30,
    },
  },
  {
    note: 'AIS — a second, unrelated vessel further south (decoy)',
    obs: {
      source: 'ais', observedAt: '2026-05-15T00:20:00Z',
      imo: '9876543', mmsi: '316099001', callSign: 'CGB4410', name: 'COASTAL RANGER',
      flagState: 'Canada', vesselType: 'Tanker', lengthMetres: 240,
      lat: 48.10, lon: -123.62,
    },
  },
  {
    note: 'AIS — PACIFIC DAWN, last position before going dark',
    obs: {
      source: 'ais', observedAt: '2026-05-15T00:35:00Z',
      imo: '9234567', mmsi: '316042118', name: 'PACIFIC DAWN',
      lat: 48.46, lon: -123.10,
    },
  },
  {
    note: 'SAR — Sentinel-1 detection: a hull, no transponder data',
    obs: {
      source: 'sar', observedAt: '2026-05-15T02:10:00Z',
      vesselType: 'Cargo', lengthMetres: 181,
      lat: 48.55, lon: -122.80,
    },
  },
  {
    note: 'EO — coastal camera: name read by OCR, with an error',
    obs: {
      source: 'eo', observedAt: '2026-05-15T02:25:00Z',
      name: 'PACIFC DAWN', vesselType: 'Cargo', lengthMetres: 182,
      lat: 48.57, lon: -122.74,
    },
  },
];

function rule(): void {
  console.log('-'.repeat(72));
}

mkdirSync('data', { recursive: true });
rmSync(LOG_FILE, { force: true });

console.log('\n  doibio3 — dark-vessel re-identification demo\n');

const store = new EntityStore(new EventLog(LOG_FILE));

for (const { note, obs } of feed) {
  rule();
  console.log(`  ${obs.source.toUpperCase()}  ${obs.observedAt}`);
  console.log(`  ${note}`);
  const r = store.ingest(obs);
  const verdict = r.created ? `NEW entity ${r.entityId}` : `${r.match.action.toUpperCase()} -> ${r.entityId}`;
  console.log(`  verdict: ${verdict}   confidence ${r.match.confidence.toFixed(3)}`);
  for (const reason of r.match.reasons) {
    console.log(`    + ${reason.type.padEnd(11)} ${reason.score.toFixed(3)}  ${reason.detail}`);
  }
}

rule();
console.log('\n  Resolved entities:\n');
for (const e of store.entities()) {
  const id = [e.imo && `IMO ${e.imo}`, e.mmsi && `MMSI ${e.mmsi}`].filter(Boolean).join(', ') || 'no transponder id';
  console.log(`  ${e.id}  "${e.canonicalName}"  (${id})`);
  console.log(`    ${e.observations.length} observation(s) from ${new Set(e.observations.map((o) => o.observation.source)).size} modality/-ies`);
}

// The vessel that went dark and was re-acquired.
const reid = store.entities().find((e) => e.imo === '9234567');
if (reid) {
  console.log(`\n  Provenance of "${reid.canonicalName}" (${reid.id}):\n`);
  for (const ev of store.provenance(reid.id)) {
    console.log(`    seq ${ev.seq}  ${ev.type.padEnd(20)}  ${ev.hash.slice(0, 12)}`);
  }
}

// Event sourcing: replay the persisted log into a fresh graph and check it matches.
rule();
const replayed = EntityGraph.project(new EventLog(LOG_FILE));
const same =
  replayed.entities.size === store.entities().length &&
  store.entities().every((e) => {
    const r = replayed.entities.get(e.id);
    return r !== undefined && r.observations.length === e.observations.length;
  });
console.log(`\n  Replayed ${store.events().length} events from ${LOG_FILE}:`);
console.log(`  hash chain verified, graph reprojected ${same ? 'identically' : 'DID NOT MATCH'}.\n`);

if (!same) process.exitCode = 1;
