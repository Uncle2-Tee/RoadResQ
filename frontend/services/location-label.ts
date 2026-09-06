import * as Location from 'expo-location';

type Coordinates = {
  latitude: number;
  longitude: number;
};

const coordinateLabelPattern = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
const locationNameCache = new Map<string, string>();
const OPEN_STREET_MAP_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

const uniqueParts = (parts: Array<string | null | undefined>) => {
  const seen = new Set<string>();

  return parts.filter((part): part is string => {
    const trimmedPart = part?.trim();
    if (!trimmedPart) {
      return false;
    }

    const key = trimmedPart.toLocaleLowerCase();
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

const removeStreetWord = (value?: string | null) =>
  value?.replace(/\bstreet\b/gi, '').replace(/\s+/g, ' ').trim() || null;

export const formatLocationName = (address?: Location.LocationGeocodedAddress | null) => {
  if (!address) {
    return null;
  }

  // Map labels use the requested street, town format, such as “Dome, Ho”.
  const rawName = address.name?.trim();
  const looksLikeGpsAddress = rawName
    ? coordinateLabelPattern.test(rawName) ||
      /^[A-Z0-9]{4,}\+[A-Z0-9]{2,}/i.test(rawName)
    : false;
  const town = address.city?.trim() || address.subregion?.trim() || address.region?.trim();
  const namedStreet = !looksLikeGpsAddress && rawName && rawName.toLocaleLowerCase() !== town?.toLocaleLowerCase()
    ? rawName
    : null;
  const street = removeStreetWord(address.street) || removeStreetWord(namedStreet) || removeStreetWord(address.district);
  const parts = uniqueParts([street, town]);

  return parts.length > 0 ? parts.slice(0, 2).join(', ') : null;
};

export const getCoordinatesFromLocation = (value: unknown): Coordinates | null => {
  if (typeof value === 'string') {
    const match = value.match(coordinateLabelPattern);
    if (!match) {
      return null;
    }

    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    ) {
      return { latitude, longitude };
    }

    return null;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const latitude = Number(record.latitude ?? record.lat);
    const longitude = Number(record.longitude ?? record.lon);
    if (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    ) {
      return { latitude, longitude };
    }
  }

  return null;
};

export const getLocationName = async (
  latitude: number,
  longitude: number,
  fallback = 'Location name unavailable'
) => {
  const cacheKey = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
  const cachedName = locationNameCache.get(cacheKey);
  if (cachedName) {
    return cachedName;
  }

  try {
    const [address] = await Location.reverseGeocodeAsync({ latitude, longitude });
    const locationName = formatLocationName(address);
    if (locationName && address?.street) {
      locationNameCache.set(cacheKey, locationName);
      return locationName;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    let response: Response;
    try {
      response = await fetch(
        `${OPEN_STREET_MAP_REVERSE_URL}?format=jsonv2&zoom=18&addressdetails=1&lat=${latitude}&lon=${longitude}`,
        {
          headers: {
            Accept: 'application/json',
            'Accept-Language': 'en',
            'User-Agent': 'RoadResQ/1.0 location lookup',
          },
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timeoutId);
    }
    if (response.ok) {
      const result = (await response.json()) as {
        address?: {
          road?: string;
          neighbourhood?: string;
          suburb?: string;
          city?: string;
          town?: string;
          village?: string;
          municipality?: string;
          county?: string;
        };
      };
      const street = result.address?.road || result.address?.neighbourhood || result.address?.suburb;
      const town = result.address?.city || result.address?.town || result.address?.village || result.address?.municipality || result.address?.county;
      const fallbackName = uniqueParts([street, town]).slice(0, 2).join(', ');
      if (fallbackName) {
        locationNameCache.set(cacheKey, fallbackName);
        return fallbackName;
      }
    }

    if (locationName) {
      locationNameCache.set(cacheKey, locationName);
      return locationName;
    }
  } catch (error) {
    console.warn('Unable to resolve location name:', error);
  }

  return fallback;
};

export const getInitialLocationName = (value: unknown) => {
  if (getCoordinatesFromLocation(value)) {
    return 'Finding place name...';
  }

  if (typeof value !== 'string' || !value.trim()) {
    return 'Location not provided';
  }

  const locationParts = uniqueParts(value.split(',')).slice(0, 2);
  return locationParts.join(', ');
};

export const resolveLocationValue = async (value: unknown) => {
  const coordinates = getCoordinatesFromLocation(value);
  if (!coordinates) {
    return getInitialLocationName(value);
  }

  return getLocationName(coordinates.latitude, coordinates.longitude);
};
