import { Farm } from '../../models/Farm.js';
import { Farmer } from '../../models/Farmer.js';
import { assessEvidence, isLocationStrong } from '../evidence.service.js';
import { providers, InsufficientImageryError } from './providers.js';
import { logger } from '../../utils/logger.js';

// Marks the farm "pending" and returns immediately. The work runs in the background so it can
// never block /v1/verify (NFR: external enrichment must be asynchronous).
export async function queueEnrichment(farm) {
  farm.enrichment.state = 'pending';
  farm.enrichment.reason = undefined;
  farm.enrichment.requestedAt = new Date();
  farm.evidence = assessEvidence(farm.toObject());
  await farm.save();
  setImmediate(() => processEnrichment(farm._id).catch((err) => logger.error('enrichment_crashed', { farmId: String(farm._id), message: err.message })));
}

export async function processEnrichment(farmId) {
  const farm = await Farm.findById(farmId);
  if (!farm) return;
  const farmer = await Farmer.findById(farm.farmerId).lean();
  try {
    if (!farm.location?.lat && farmer) {
      const g = await providers.geocoder.geocode({ state: farmer.state, lga: farmer.lga, ward: farmer.ward, community: farmer.community });
      if (g) farm.location = { lat: g.lat, lng: g.lng, source: 'geocoded', accuracyMeters: g.accuracyMeters, provider: g.provider, collectedAt: new Date() };
    }
    if (!isLocationStrong(farm.location)) {
      // Do not run a parcel-level assessment on a town-centre or coarse coordinate.
      farm.enrichment.state = 'not_assessed';
      farm.enrichment.reason = 'parcel_level_location_required';
    } else {
      try {
        const r = await providers.satellite.analyze({
          lat: farm.location.lat, lng: farm.location.lng,
          accuracyMeters: farm.location.accuracyMeters, reportedAreaHa: farm.reportedArea?.value,
        });
        farm.enrichment.satellite = { ndvi: r.ndvi, imageryDate: r.imageryDate, provider: r.provider, method: r.method, coveragePct: r.coveragePct };
        if (r.estimatedAreaHa > 0) {
          farm.estimatedArea = { value: r.estimatedAreaHa, unit: 'hectares', method: r.method, provider: r.provider, assessedAt: new Date(), imageryDate: r.imageryDate, coveragePct: r.coveragePct };
        }
        farm.enrichment.state = 'completed';
        farm.enrichment.reason = undefined;
      } catch (err) {
        if (!(err instanceof InsufficientImageryError)) throw err;
        farm.enrichment.state = 'insufficient_imagery';
        farm.enrichment.reason = err.message;
      }
    }
  } catch (err) {
    farm.enrichment.state = 'failed';
    farm.enrichment.reason = String(err.message).slice(0, 200);
  }
  farm.enrichment.completedAt = new Date();
  farm.evidence = assessEvidence(farm.toObject());
  await farm.save();
}
