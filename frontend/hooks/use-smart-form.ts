import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

interface FormFieldState {
  value: string | number;
  error: string | null;
  isDirty: boolean;
  isTouched: boolean;
}

interface SmartFormState {
  [key: string]: FormFieldState;
}

interface SmartFormOptions {
  autoSave?: boolean;
  autoSaveDelay?: number;
  storageKey?: string;
  validate?: (values: Record<string, any>) => Record<string, string>;
}

export function useSmartForm(
  initialValues: Record<string, string | number>,
  options: SmartFormOptions = {}
) {
  const {
    autoSave = true,
    autoSaveDelay = 1000,
    storageKey,
    validate,
  } = options;

  const [formState, setFormState] = useState<SmartFormState>(() => {
    const state: SmartFormState = {};
    Object.entries(initialValues).forEach(([key, value]) => {
      state[key] = {
        value,
        error: null,
        isDirty: false,
        isTouched: false,
      };
    });
    return state;
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasErrors, setHasErrors] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-save functionality
  useEffect(() => {
    if (!autoSave || !storageKey) return;

    const hasDirtyFields = Object.values(formState).some((field) => field.isDirty);
    if (!hasDirtyFields) {
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const values: Record<string, any> = {};
        Object.entries(formState).forEach(([key, field]) => {
          values[key] = field.value;
        });
        await AsyncStorage.setItem(storageKey, JSON.stringify(values));
      } catch (error) {
        console.error('Failed to auto-save form:', error);
      }
    }, autoSaveDelay);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
  }, [formState, autoSave, autoSaveDelay, storageKey]);

  // Validate function
  const validateField = useCallback(
    (name: string, value: any) => {
      if (!validate) return null;

      const allValues = Object.entries(formState).reduce((acc, [key, field]) => {
        acc[key] = key === name ? value : field.value;
        return acc;
      }, {} as Record<string, any>);

      const errors = validate(allValues);
      return errors[name] || null;
    },
    [formState, validate]
  );

  // Handle field change
  const setFieldValue = useCallback(
    (name: string, value: string | number) => {
      setFormState((prev) => ({
        ...prev,
        [name]: {
          ...prev[name],
          value,
          isDirty: true,
          error: validateField(name, value),
        },
      }));
    },
    [validateField]
  );

  // Handle field blur
  const setFieldTouched = useCallback((name: string) => {
    setFormState((prev) => ({
      ...prev,
      [name]: {
        ...prev[name],
        isTouched: true,
      },
    }));
  }, []);

  // Get field props
  const getFieldProps = useCallback(
    (name: string) => ({
      value: formState[name]?.value || '',
      onChangeText: (value: string) => setFieldValue(name, value),
      onBlur: () => setFieldTouched(name),
      error: formState[name]?.error,
      isTouched: formState[name]?.isTouched,
    }),
    [formState, setFieldValue, setFieldTouched]
  );

  // Handle form submission
  const handleSubmit = useCallback(
    async (onSubmit: (values: Record<string, any>) => Promise<void>) => {
      setIsSubmitting(true);

      // Mark all fields as touched
      const newFormState = { ...formState };
      Object.keys(newFormState).forEach((key) => {
        newFormState[key] = {
          ...newFormState[key],
          isTouched: true,
        };
      });
      setFormState(newFormState);

      // Check for errors
      const errors: Record<string, string | null> = {};
      Object.entries(newFormState).forEach(([key]) => {
        errors[key] = validateField(key, newFormState[key].value);
      });

      const hasAnyErrors = Object.values(errors).some((err) => err !== null);
      setHasErrors(hasAnyErrors);

      if (!hasAnyErrors) {
        try {
          const values: Record<string, any> = {};
          Object.entries(formState).forEach(([key, field]) => {
            values[key] = field.value;
          });
          await onSubmit(values);
        } catch (error) {
          console.error('Form submission error:', error);
        }
      }

      setIsSubmitting(false);
    },
    [formState, validateField]
  );

  // Reset form
  const resetForm = useCallback(() => {
    setFormState((prev) => {
      const newState: SmartFormState = {};
      Object.entries(prev).forEach(([key, field]) => {
        newState[key] = {
          value: initialValues[key] || '',
          error: null,
          isDirty: false,
          isTouched: false,
        };
      });
      return newState;
    });
    setHasErrors(false);
  }, [initialValues]);

  // Load saved form
  const loadSavedForm = useCallback(
    async (key: string) => {
      try {
        const saved = await AsyncStorage.getItem(key);
        if (saved) {
          const values = JSON.parse(saved);
          Object.entries(values).forEach(([fieldName, value]) => {
            setFieldValue(fieldName, value as string | number);
          });
        }
      } catch (error) {
        console.error('Failed to load saved form:', error);
      }
    },
    [setFieldValue]
  );

  return {
    formState,
    setFieldValue,
    setFieldTouched,
    getFieldProps,
    handleSubmit,
    resetForm,
    loadSavedForm,
    isSubmitting,
    hasErrors,
  };
}
