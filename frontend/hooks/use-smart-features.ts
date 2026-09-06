import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppIconName } from '../components/app-icon';

interface SmartCacheData {
  key: string;
  data: any;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

interface SmartSuggestion {
  id: string;
  title: string;
  description: string;
  icon: AppIconName;
  action: () => void;
  priority: number;
}

/**
 * Smart caching hook with TTL (time-to-live)
 */
export function useSmartCache(cacheKey: string, ttl: number = 3600000) {
  const getCachedData = useCallback(async () => {
    try {
      const cached = await AsyncStorage.getItem(cacheKey);
      if (!cached) return null;

      const cacheData: SmartCacheData = JSON.parse(cached);
      const now = Date.now();
      
      // Check if cache has expired
      if (now - cacheData.timestamp > cacheData.ttl) {
        await AsyncStorage.removeItem(cacheKey);
        return null;
      }

      return cacheData.data;
    } catch (error) {
      console.error('Cache read error:', error);
      return null;
    }
  }, [cacheKey]);

  const setCachedData = useCallback(
    async (data: any) => {
      try {
        const cacheData: SmartCacheData = {
          key: cacheKey,
          data,
          timestamp: Date.now(),
          ttl,
        };
        await AsyncStorage.setItem(cacheKey, JSON.stringify(cacheData));
      } catch (error) {
        console.error('Cache write error:', error);
      }
    },
    [cacheKey, ttl]
  );

  const clearCache = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(cacheKey);
    } catch (error) {
      console.error('Cache clear error:', error);
    }
  }, [cacheKey]);

  return { getCachedData, setCachedData, clearCache };
}

/**
 * Smart suggestions hook - provides contextual suggestions
 */
export function useSmartSuggestions(
  context: 'home' | 'requests' | 'tow' | 'mechanic'
): SmartSuggestion[] {
  return useMemo(() => {
    const contextSuggestions: Record<string, SmartSuggestion[]> = {
      home: [
        {
          id: 'recent-requests',
          title: 'View Recent Requests',
          description: 'Check your last interactions',
          icon: 'list',
          action: () => {},
          priority: 1,
        },
        {
          id: 'quick-tow',
          title: 'Order a Tow Now',
          description: 'Fast towing service nearby',
          icon: 'car',
          action: () => {},
          priority: 2,
        },
      ],
      requests: [
        {
          id: 'call-service',
          title: 'Call Service Provider',
          description: 'Direct contact with provider',
          icon: 'phone',
          action: () => {},
          priority: 1,
        },
        {
          id: 'view-details',
          title: 'View Full Details',
          description: 'See complete service information',
          icon: 'list',
          action: () => {},
          priority: 2,
        },
      ],
      tow: [
        {
          id: 'location-update',
          title: 'Update Location',
          description: 'Refresh your current location',
          icon: 'mapPin',
          action: () => {},
          priority: 1,
        },
        {
          id: 'filter-services',
          title: 'Sort by Rating',
          description: 'Find the best-rated services',
          icon: 'star',
          action: () => {},
          priority: 2,
        },
      ],
      mechanic: [
        {
          id: 'describe-issue',
          title: 'Describe Your Issue',
          description: 'Get better matching',
          icon: 'wrench',
          action: () => {},
          priority: 1,
        },
        {
          id: 'location-help',
          title: 'Add Your Location',
          description: 'Help mechanics find you',
          icon: 'mapPin',
          action: () => {},
          priority: 2,
        },
      ],
    };

    return [...(contextSuggestions[context] || [])].sort((a, b) => a.priority - b.priority);
  }, [context]);
}

/**
 * Smart analytics hook for tracking user behavior
 */
export function useSmartAnalytics() {
  const trackEvent = useCallback(
    async (eventName: string, eventData: Record<string, any> = {}) => {
      try {
        const analyticsKey = 'app_analytics';
        const analytics = await AsyncStorage.getItem(analyticsKey);
        const events = analytics ? JSON.parse(analytics) : [];

        events.push({
          eventName,
          timestamp: Date.now(),
          data: eventData,
        });

        // Keep only last 100 events
        const recentEvents = events.slice(-100);
        await AsyncStorage.setItem(analyticsKey, JSON.stringify(recentEvents));
      } catch (error) {
        console.error('Analytics tracking error:', error);
      }
    },
    []
  );

  const getAnalytics = useCallback(async () => {
    try {
      const analyticsKey = 'app_analytics';
      const analytics = await AsyncStorage.getItem(analyticsKey);
      return analytics ? JSON.parse(analytics) : [];
    } catch (error) {
      console.error('Analytics read error:', error);
      return [];
    }
  }, []);

  return { trackEvent, getAnalytics };
}

/**
 * Smart preference tracking hook
 */
export function useSmartPreferences() {
  const [preferences, setPreferences] = useState<Record<string, any>>({});

  const savePreference = useCallback(
    async (key: string, value: any) => {
      try {
        const prefKey = 'user_preferences';
        const prefs = await AsyncStorage.getItem(prefKey);
        const currentPrefs = prefs ? JSON.parse(prefs) : {};

        currentPrefs[key] = value;
        await AsyncStorage.setItem(prefKey, JSON.stringify(currentPrefs));
        setPreferences(currentPrefs);
      } catch (error) {
        console.error('Preference save error:', error);
      }
    },
    []
  );

  const getPreference = useCallback(async (key: string) => {
    try {
      const prefKey = 'user_preferences';
      const prefs = await AsyncStorage.getItem(prefKey);
      const currentPrefs = prefs ? JSON.parse(prefs) : {};
      return currentPrefs[key];
    } catch (error) {
      console.error('Preference read error:', error);
      return null;
    }
  }, []);

  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const prefKey = 'user_preferences';
        const prefs = await AsyncStorage.getItem(prefKey);
        if (prefs) {
          setPreferences(JSON.parse(prefs));
        }
      } catch (error) {
        console.error('Preference load error:', error);
      }
    };

    loadPreferences();
  }, []);

  return { preferences, savePreference, getPreference };
}

/**
 * Smart debounce hook for search and input
 */
export function useSmartSearch<T>(
  searchQuery: string,
  searchFunction: (query: string) => Promise<T[]>,
  delay: number = 300
) {
  const [results, setResults] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const timeoutRef = useRef<number | NodeJS.Timeout | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!searchQuery.trim()) {
      requestIdRef.current += 1;
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(async () => {
      try {
        const searchResults = await searchFunction(searchQuery);
        if (requestIdRef.current === requestId) {
          setResults(searchResults);
        }
      } catch (error) {
        console.error('Search error:', error);
        if (requestIdRef.current === requestId) {
          setResults([]);
        }
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    }, delay);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [searchQuery, searchFunction, delay]);

  return { results, loading };
}
