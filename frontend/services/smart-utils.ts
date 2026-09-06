/**
 * Smart utility functions for intelligent app behavior
 */

// Debounce function for search, input validation, etc.
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: number | null = null;

  return function debounced(...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, delay);
  };
}

// Throttle function for handling frequent events
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean = false;

  return function throttled(...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

// Smart phone validation for Ghana carriers
export function validatePhoneNumber(
  phone: string,
  provider?: 'mtn' | 'telecel' | 'airtel'
): { isValid: boolean; message: string } {
  const cleanPhone = phone.replace(/\D/g, '');

  if (!cleanPhone) {
    return { isValid: false, message: 'Phone number is required' };
  }

  if (cleanPhone.length !== 10) {
    return { isValid: false, message: 'Phone number must be 10 digits' };
  }

  const prefix = cleanPhone.substring(0, 3);
  const mtnPrefixes = ['024', '054', '055', '059'];
  const telecelPrefixes = ['020', '050', '055', '057'];
  const airtelPrefixes = ['010', '020', '027', '057'];

  if (provider) {
    switch (provider) {
      case 'mtn':
        return {
          isValid: mtnPrefixes.includes(prefix),
          message: mtnPrefixes.includes(prefix)
            ? 'Valid MTN number'
            : 'Invalid MTN phone number',
        };
      case 'telecel':
        return {
          isValid: telecelPrefixes.includes(prefix),
          message: telecelPrefixes.includes(prefix)
            ? 'Valid Telecel number'
            : 'Invalid Telecel phone number',
        };
      case 'airtel':
        return {
          isValid: airtelPrefixes.includes(prefix),
          message: airtelPrefixes.includes(prefix)
            ? 'Valid AirtelTigo number'
            : 'Invalid AirtelTigo phone number',
        };
    }
  }

  const isValid =
    [...mtnPrefixes, ...telecelPrefixes, ...airtelPrefixes].includes(prefix);
  return {
    isValid,
    message: isValid ? 'Valid phone number' : 'Invalid phone number for Ghana',
  };
}

// Smart amount validation
export function validateAmount(
  amount: string
): { isValid: boolean; message: string; value: number } {
  const value = parseFloat(amount);

  if (!amount.trim()) {
    return { isValid: false, message: 'Amount is required', value: 0 };
  }

  if (isNaN(value)) {
    return { isValid: false, message: 'Please enter a valid number', value: 0 };
  }

  if (value <= 0) {
    return { isValid: false, message: 'Amount must be greater than 0', value: 0 };
  }

  if (value > 10000) {
    return {
      isValid: false,
      message: 'Amount exceeds maximum limit (GHS 10,000)',
      value: 0,
    };
  }

  return { isValid: true, message: 'Valid amount', value };
}

// Format phone number for display
export function formatPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `${cleaned.substring(0, 3)} ${cleaned.substring(3, 6)} ${cleaned.substring(6)}`;
  }
  return phone;
}

// Format amount as currency
export function formatCurrency(amount: number, currency: string = 'GHS'): string {
  const value = typeof amount === 'number' && !isNaN(amount) ? amount.toFixed(2) : '0.00';
  return `${currency} ${value}`;
}

// Calculate distance between two coordinates (in km)
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Smart error handler with retry logic
export async function retryAsync<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => 
          setTimeout(resolve, delayMs * Math.pow(2, attempt - 1))
        );
      }
    }
  }

  throw lastError || new Error('Max retry attempts reached');
}

// Cache manager for smart data persistence
export class SmartCache {
  private cache: Map<string, { value: any; expiry: number }> = new Map();

  set(key: string, value: any, ttlSeconds: number = 300): void {
    const expiry = Date.now() + ttlSeconds * 1000;
    this.cache.set(key, { value, expiry });
  }

  get<T = any>(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }

    return item.value as T;
  }

  clear(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  has(key: string): boolean {
    const item = this.cache.get(key);
    return Boolean(item);
  }
}

// Smart string formatting
export function truncateString(text: string, maxLength: number = 20): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

// Time ago formatter
export function timeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

  return date.toLocaleDateString();
}

// Batch operations for efficient updates
export class BatchOperations<T> {
  private operations: Array<() => Promise<void>> = [];
  private isRunning = false;

  add(operation: () => Promise<void>): void {
    this.operations.push(operation);
  }

  async execute(concurrency: number = 3): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    const chunks: Array<Array<() => Promise<void>>> = [];
    for (let i = 0; i < this.operations.length; i += concurrency) {
      chunks.push(this.operations.slice(i, i + concurrency));
    }

    for (const chunk of chunks) {
      await Promise.all(chunk.map((op) => op()));
    }

    this.isRunning = false;
  }

  clear(): void {
    this.operations = [];
  }
}

// Smart sorting and filtering utilities for requests
export type SortBy = 'date' | 'price' | 'rating' | 'distance' | 'eta';
export type FilterType = 'all' | 'service' | 'tow' | 'call';
export type FilterStatus = 'all' | 'pending' | 'completed' | 'called';

export interface SmartFilterOptions {
  type?: FilterType;
  status?: FilterStatus;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  dateRange?: { from: Date; to: Date };
  location?: string;
  searchQuery?: string;
}

// Smart sort function
export function sortByField<T extends { [key: string]: any }>(
  items: T[],
  sortBy: SortBy,
  descending: boolean = true
): T[] {
  const sorted = [...items];

  switch (sortBy) {
    case 'date':
      sorted.sort((a, b) => {
        const dateA = new Date(a.timestamp || a.createdAt || 0).getTime();
        const dateB = new Date(b.timestamp || b.createdAt || 0).getTime();
        return descending ? dateB - dateA : dateA - dateB;
      });
      break;

    case 'price':
      sorted.sort((a, b) => {
        const priceA = parseFloat(a.price || 0);
        const priceB = parseFloat(b.price || 0);
        return descending ? priceB - priceA : priceA - priceB;
      });
      break;

    case 'rating':
      sorted.sort((a, b) => {
        const ratingA = parseFloat(a.rating || 0);
        const ratingB = parseFloat(b.rating || 0);
        return descending ? ratingB - ratingA : ratingA - ratingB;
      });
      break;

    case 'distance':
      sorted.sort((a, b) => {
        const distA = parseFloat(a.distance || 0);
        const distB = parseFloat(b.distance || 0);
        return descending ? distB - distA : distA - distB;
      });
      break;

    case 'eta':
      sorted.sort((a, b) => {
        const etaA = parseFloat(a.estimatedTime || a.eta || 0);
        const etaB = parseFloat(b.estimatedTime || b.eta || 0);
        return descending ? etaB - etaA : etaA - etaB;
      });
      break;
  }

  return sorted;
}

// Smart filter function
export function filterByOptions<T extends { [key: string]: any }>(
  items: T[],
  options: SmartFilterOptions
): T[] {
  return items.filter((item) => {
    // Type filter
    if (options.type && options.type !== 'all') {
      if (options.type === 'service' && item.type !== 'service') return false;
      if (options.type === 'tow' && item.type !== 'tow') return false;
      if (options.type === 'call' && item.type !== 'call') return false;
    }

    // Status filter
    if (options.status && options.status !== 'all') {
      if (item.status !== options.status) return false;
    }

    // Price range filter
    if (options.minPrice !== undefined) {
      const price = parseFloat(item.price || 0);
      if (price < options.minPrice) return false;
    }
    if (options.maxPrice !== undefined) {
      const price = parseFloat(item.price || 0);
      if (price > options.maxPrice) return false;
    }

    // Rating filter
    if (options.minRating !== undefined) {
      const rating = parseFloat(item.rating || 0);
      if (rating < options.minRating) return false;
    }

    // Date range filter
    if (options.dateRange) {
      const itemDate = new Date(item.timestamp || item.createdAt || 0);
      if (itemDate < options.dateRange.from || itemDate > options.dateRange.to) {
        return false;
      }
    }

    // Location filter (partial match)
    if (options.location) {
      const itemLocation = (item.location || '').toLowerCase();
      const searchLocation = options.location.toLowerCase();
      if (!itemLocation.includes(searchLocation)) return false;
    }

    // Search query filter (fuzzy matching across multiple fields)
    if (options.searchQuery) {
      const query = options.searchQuery.toLowerCase();
      const searchFields = [
        item.serviceName,
        item.name,
        item.location,
        item.servicePhone,
        item.driverName,
      ];

      const matches = searchFields.some((field) =>
        field && field.toLowerCase().includes(query)
      );

      if (!matches) return false;
    }

    return true;
  });
}

// Group items by category
export function groupBy<T extends { [key: string]: any }>(
  items: T[],
  keySelector: (item: T) => string | number
): { [key: string]: T[] } {
  return items.reduce(
    (groups, item) => {
      const key = String(keySelector(item));
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(item);
      return groups;
    },
    {} as { [key: string]: T[] }
  );
}

// Deduplicate items based on a key
export function deduplicateBy<T extends { [key: string]: any }>(
  items: T[],
  keySelector: (item: T) => string | number
): T[] {
  const seen = new Set<string | number>();
  return items.filter((item) => {
    const key = keySelector(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Fuzzy search implementation
export function fuzzySearch<T extends { [key: string]: any }>(
  items: T[],
  query: string,
  searchFields: (keyof T)[]
): Array<{ item: T; score: number }> {
  const lowerQuery = query.toLowerCase();

  return items
    .map((item) => {
      let score = 0;

      for (const field of searchFields) {
        const value = String(item[field] || '').toLowerCase();

        // Exact match
        if (value === lowerQuery) {
          score += 100;
        }
        // Starts with query
        else if (value.startsWith(lowerQuery)) {
          score += 50;
        }
        // Contains query
        else if (value.includes(lowerQuery)) {
          score += 25;
        }
        // Fuzzy match (character by character)
        else {
          let pos = 0;
          let matchScore = 0;
          for (const char of lowerQuery) {
            const charPos = value.indexOf(char, pos);
            if (charPos === -1) {
              matchScore = 0;
              break;
            }
            matchScore += 1;
            pos = charPos + 1;
          }
          if (matchScore > 0) {
            score += matchScore;
          }
        }
      }

      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
}

// Smart pagination
export function paginate<T>(
  items: T[],
  pageNumber: number = 1,
  pageSize: number = 10
): { items: T[]; total: number; pages: number; currentPage: number } {
  const total = items.length;
  const pages = Math.ceil(total / pageSize);
  const startIndex = (pageNumber - 1) * pageSize;
  const endIndex = startIndex + pageSize;

  return {
    items: items.slice(startIndex, endIndex),
    total,
    pages,
    currentPage: pageNumber,
  };
}

// Aggregate statistics
export function aggregateStats<T extends { [key: string]: any }>(
  items: T[],
  numericFields: (keyof T)[]
): {
  [key: string]: { sum: number; avg: number; min: number; max: number };
} {
  const stats: {
    [key: string]: { sum: number; avg: number; min: number; max: number };
  } = {};

  for (const field of numericFields) {
    const values = items
      .map((item) => parseFloat(String(item[field] || 0)))
      .filter((v) => !isNaN(v));

    if (values.length === 0) continue;

    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);

    stats[String(field)] = { sum, avg, min, max };
  }

  return stats;
}
