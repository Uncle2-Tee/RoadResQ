export const DEFAULT_ARRIVAL_RADIUS_KM = 0.2;

export const calculateDistanceKm = (
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number
): number => {
  const earthRadiusKm = 6371;
  const deltaLatitude = ((latitudeB - latitudeA) * Math.PI) / 180;
  const deltaLongitude = ((longitudeB - longitudeA) * Math.PI) / 180;

  const a =
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
    Math.cos((latitudeA * Math.PI) / 180) *
      Math.cos((latitudeB * Math.PI) / 180) *
      Math.sin(deltaLongitude / 2) *
      Math.sin(deltaLongitude / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
};

export const isProviderAtDriverLocation = (
  distanceKm: number,
  arrivalRadiusKm: number = DEFAULT_ARRIVAL_RADIUS_KM
): boolean => distanceKm <= arrivalRadiusKm;

export const getProviderDistanceText = (
  distanceKm: number,
  providerType: 'Mechanic' | 'Tower' | 'Tow service' | string,
  arrivalRadiusKm: number = DEFAULT_ARRIVAL_RADIUS_KM
): string => {
  void arrivalRadiusKm;
  return `${providerType} is ${distanceKm.toFixed(1)} km away.`;
};
