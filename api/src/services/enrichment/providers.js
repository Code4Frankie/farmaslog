// Adapter interfaces for geocoding and satellite analysis (PRD section 6/8). The defaults are
// "not configured" stubs, so enrichment ends in an explicit state instead of faking a result.
// Plug in a real provider with setProviders({ satellite: {...} }).

export class InsufficientImageryError extends Error {}

/** geocoder.geocode({state,lga,ward,community}) -> {lat,lng,accuracyMeters,provider} | null */
const nullGeocoder = { name: 'none', async geocode() { return null; } };

/**
 * satellite.analyze({lat,lng,accuracyMeters,reportedAreaHa}) ->
 *   { ndvi, imageryDate, coveragePct, provider, method, estimatedAreaHa? }
 * Throw InsufficientImageryError when imagery is missing/cloudy.
 */
const nullSatellite = {
  name: 'none',
  async analyze() { throw new InsufficientImageryError('satellite_provider_not_configured'); },
};

export const providers = { geocoder: nullGeocoder, satellite: nullSatellite };
export const setProviders = (p) => Object.assign(providers, p);
