# Responsive & Smart App Features

## Overview
The app now includes intelligent features for better responsiveness, validation, and user experience. This document explains all the new tools available.

---

## 1. Responsive Design Hook (`useResponsive`)

**Location:** `hooks/use-responsive.ts`

**Purpose:** Make UI adapt to different screen sizes automatically.

**Usage:**
```typescript
import { useResponsive } from '../hooks/use-responsive';

export default function MyScreen() {
  const { isSmallScreen, isMediumScreen, isLargeScreen, scale } = useResponsive();
  
  return (
    <View style={{
      padding: isSmallScreen ? 8 : 16,
      fontSize: isSmallScreen ? 14 : 16,
    }}>
      {/* Content scales based on screen size */}
    </View>
  );
}
```

**Available Properties:**
- `window` - Current window dimensions
- `isSmallScreen` - true if width < 375px
- `isMediumScreen` - true if width 375-768px
- `isLargeScreen` - true if width >= 768px
- `scale` - Responsive scale factor (base 375px)

---

## 2. Smart Form Management (`useSmartForm`)

**Location:** `hooks/use-smart-form.ts`

**Purpose:** Handle form state, validation, and auto-save with minimal code.

**Features:**
- Real-time validation
- Auto-save to AsyncStorage
- Touch tracking for better error display
- Dirty field detection
- Server-side submission handling

**Usage:**
```typescript
import { useSmartForm } from '../hooks/use-smart-form';

export default function LoginScreen() {
  const { 
    getFieldProps, 
    handleSubmit, 
    formState,
    isSubmitting 
  } = useSmartForm(
    { email: '', password: '' },
    {
      autoSave: true,
      autoSaveDelay: 1000,
      storageKey: 'loginForm',
      validate: (values) => {
        const errors: Record<string, string> = {};
        if (!values.email) errors.email = 'Email required';
        if (!values.password) errors.password = 'Password required';
        return errors;
      },
    }
  );

  const handleLogin = async (values: Record<string, any>) => {
    // Submit form...
  };

  return (
    <View>
      <TextInput {...getFieldProps('email')} />
      {formState.email.error && <Text>{formState.email.error}</Text>}
    </View>
  );
}
```

---

## 3. Smart Validation Utilities (`smart-utils.ts`)

**Location:** `services/smart-utils.ts`

**Available Functions:**

### Phone Number Validation
```typescript
import { validatePhoneNumber } from '../services/smart-utils';

const result = validatePhoneNumber('0241234567', 'mtn');
// { isValid: true, message: 'Valid MTN number' }
```

### Amount Validation
```typescript
import { validateAmount } from '../services/smart-utils';

const result = validateAmount('50.00');
// { isValid: true, message: 'Valid amount', value: 50.00 }
```

### Phone Formatting
```typescript
import { formatPhoneNumber } from '../services/smart-utils';

const formatted = formatPhoneNumber('0241234567');
// '024 123 4567'
```

### Currency Formatting
```typescript
import { formatCurrency } from '../services/smart-utils';

const formatted = formatCurrency(50.00, 'GHS');
// 'GHS 50.00'
```

---

## 4. Debouncing & Throttling

**Usage:**
```typescript
import { debounce, throttle } from '../services/smart-utils';

// Debounce: Wait 500ms after user stops typing
const debouncedSearch = debounce((query: string) => {
  // Search API call
}, 500);

// On every keystroke
<TextInput onChangeText={debouncedSearch} />

// Throttle: Max once per second
const throttledScroll = throttle(() => {
  // Handle scroll
}, 1000);
```

---

## 5. Distance Calculation

**Usage:**
```typescript
import { calculateDistance } from '../services/smart-utils';

const distance = calculateDistance(6.6137, -0.4659, 6.6150, -0.4670);
// Distance in kilometers
```

---

## 6. Retry Logic with Exponential Backoff

**Usage:**
```typescript
import { retryAsync } from '../services/smart-utils';

const data = await retryAsync(
  async () => {
    return await fetch('/api/data').then(r => r.json());
  },
  3, // max attempts
  1000 // initial delay in ms
);
```

---

## 7. Smart Cache Manager

**Usage:**
```typescript
import { SmartCache } from '../services/smart-utils';

const cache = new SmartCache();

// Set a value with 5-minute TTL
cache.set('user-data', userData, 300);

// Get cached value
const cached = cache.get('user-data');

// Auto-expires if TTL exceeded
```

---

## 8. Skeleton Loaders

**Location:** `components/skeleton-loader.tsx`

**Purpose:** Show beautiful loading states while data loads.

**Usage:**
```typescript
import { SkeletonLoader, SkeletonLines } from '../components/skeleton-loader';

{isLoading ? (
  <SkeletonLines count={3} spacing={10} />
) : (
  // Actual content
)}

// Custom skeleton
<SkeletonLoader width={100} height={100} borderRadius={50} variant="circle" />
```

---

## 9. Time Formatting

**Usage:**
```typescript
import { timeAgo } from '../services/smart-utils';

const displayTime = timeAgo('2024-04-06T10:30:00Z');
// 'Just now' | '5m ago' | '2h ago' | etc.
```

---

## 10. String Utilities

**Truncate Text:**
```typescript
import { truncateString } from '../services/smart-utils';

const short = truncateString('Very long text...', 20);
// 'Very long text...'
```

---

## 11. Batch Operations

**Usage:**
```typescript
import { BatchOperations } from '../services/smart-utils';

const batch = new BatchOperations();

batch.add(async () => { await saveData1(); });
batch.add(async () => { await saveData2(); });
batch.add(async () => { await saveData3(); });

// Execute with 3 concurrent operations
await batch.execute(3);
```

---

## Implementation Examples

### Example 1: Smart Payment Form

The `payment.tsx` has been updated to use:
- Real-time phone validation with debounce
- Real-time amount validation with debounce
- Visual feedback (error in red, success in green)
- Responsive design
- Smart formatting for display

### Example 2: Responsive Layout

```typescript
const { isSmallScreen, scale } = useResponsive();

return (
  <View style={{
    padding: isSmallScreen ? 8 : 16,
    marginVertical: isSmallScreen ? 4 : 8,
  }}>
    {/* Automatically scales based on device */}
  </View>
);
```

---

## Best Practices

1. **Always use debounce for search/input validation** - Prevents excessive re-renders
2. **Use throttle for scroll/resize events** - Improves performance
3. **Enable auto-save for important forms** - Never lose user data
4. **Use skeleton loaders** - Better UX than blank screens
5. **Validate early and provide feedback** - Guide users to success
6. **Use cache for repeated API calls** - Reduce network requests
7. **Handle errors with retry** - Improve reliability
8. **Test on multiple screen sizes** - Use responsive hooks

---

## For Future Enhancements

These tools are designed to scale:
- Add more validation rules as needed
- Extend SmartCache with localStorage support
- Add animations to SkeletonLoader variants
- Create custom hooks combining multiple utilities
- Add offline support with cache fallbacks
