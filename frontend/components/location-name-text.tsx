import { useEffect, useState } from 'react';
import { getInitialLocationName, resolveLocationValue } from '../services/location-label';
import { ThemedText, type ThemedTextProps } from './themed-text';

type LocationNameTextProps = Omit<ThemedTextProps, 'children'> & {
  location: unknown;
};

export function LocationNameText({ location, ...textProps }: LocationNameTextProps) {
  const [locationName, setLocationName] = useState(() => getInitialLocationName(location));

  useEffect(() => {
    let isActive = true;
    setLocationName(getInitialLocationName(location));

    resolveLocationValue(location).then((resolvedName) => {
      if (isActive) {
        setLocationName(resolvedName);
      }
    });

    return () => {
      isActive = false;
    };
  }, [location]);

  return <ThemedText {...textProps}>{locationName}</ThemedText>;
}
