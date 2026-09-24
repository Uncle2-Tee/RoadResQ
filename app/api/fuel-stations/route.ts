import { jsonError } from '@/lib/auth';

type FuelStation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  address: string;
  brand: string;
};

const toCoordinate = (value: string | null) => {
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
};

const withTimeout = async <T,>(promise: Promise<T>, ms = 25000) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Fuel station lookup timed out')), ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const latitude = toCoordinate(searchParams.get('latitude'));
  const longitude = toCoordinate(searchParams.get('longitude'));

  if (latitude === null || latitude < -90 || latitude > 90) {
    return jsonError('A valid latitude is required', 400);
  }

  if (longitude === null || longitude < -180 || longitude > 180) {
    return jsonError('A valid longitude is required', 400);
  }

  const radiusKm = 30;
  const latDelta = radiusKm / 111.32;
  const lonDelta = radiusKm / (111.32 * Math.cos((latitude * Math.PI) / 180));
  const minLat = latitude - latDelta;
  const maxLat = latitude + latDelta;
  const minLon = longitude - lonDelta;
  const maxLon = longitude + lonDelta;
  const query = `[out:json][timeout:25];(
    node["amenity"="fuel"](${minLat},${minLon},${maxLat},${maxLon});
    way["amenity"="fuel"](${minLat},${minLon},${maxLat},${maxLon});
    relation["amenity"="fuel"](${minLat},${minLon},${maxLat},${maxLon});
  );
  out center;`;

  try {
    let response: Response | null = null;
    let lastError: unknown = null;

    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const candidate = await withTimeout(
          fetch(`${endpoint}?data=${encodeURIComponent(query)}`, {
            headers: { Accept: 'application/json' },
          })
        );
        if (candidate.ok) {
          response = candidate;
          break;
        }
        lastError = new Error(`${endpoint} returned ${candidate.status}`);
      } catch (error) {
        lastError = error;
      }
    }

    if (!response) {
      throw lastError || new Error('All fuel station data sources failed');
    }

    const data = await response.json() as { elements?: Array<{ id: number; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> }> };
    const elements = Array.isArray(data.elements) ? data.elements : [];
    const stations: FuelStation[] = elements
      .map((element: { id: number; lat?: number; lon?: number; center?: { lat?: number; lon?: number }; tags?: Record<string, string> }): FuelStation | null => {
        const tags = element.tags || {};
        const stationLatitude = element.lat ?? element.center?.lat;
        const stationLongitude = element.lon ?? element.center?.lon;

        if (typeof stationLatitude !== 'number' || typeof stationLongitude !== 'number') {
          return null;
        }

        const addressParts = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean);
        const brand = tags.brand || tags.operator || tags.name || 'Fuel Station';

        return {
          id: `osm-${element.id}`,
          name: tags.name || `${brand} Fuel Station`,
          latitude: stationLatitude,
          longitude: stationLongitude,
          address: addressParts.length > 0 ? addressParts.join(' ') : 'Fuel station',
          brand: String(brand),
        };
      })
      .filter((station): station is FuelStation => station !== null);

    return Response.json({ stations }, { headers: { 'Cache-Control': 'private, max-age=120' } });
  } catch (error) {
    console.error('[fuel-stations] lookup failed:', error);
    return jsonError('Fuel station data is temporarily unavailable', 503);
  }
}
