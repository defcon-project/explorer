import { createRequire } from 'node:module';
import { logger } from './logger';

type GeoLookupResult = { country?: string } | null | undefined;
type GeoIpModule = { lookup?: (ip: string) => GeoLookupResult };

const runtimeRequire = createRequire(__filename);

let lookupFn: ((ip: string) => GeoLookupResult) | null = null;

try {
  const geoIp = runtimeRequire('geoip-lite') as GeoIpModule;
  if (typeof geoIp.lookup === 'function') {
    lookupFn = geoIp.lookup.bind(geoIp);
  } else {
    logger.warn('geoip-lite loaded, but lookup() is missing. Country lookups disabled.');
  }
} catch {
  logger.warn('geoip-lite is not installed. Country lookups will fall back to "Unknown".');
}

export function lookupCountryCode(ip: string): string | null {
  if (!lookupFn) return null;

  try {
    const country = lookupFn(ip)?.country;
    return typeof country === 'string' && country.length > 0 ? country : null;
  } catch (error) {
    logger.debug('GeoIP lookup failed:', error);
    return null;
  }
}
