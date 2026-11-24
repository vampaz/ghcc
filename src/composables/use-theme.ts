import { computed, onMounted, onUnmounted, ref } from 'vue';

export type ThemePreference = 'light' | 'dark' | null;
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'color-scheme';

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const val = window.localStorage.getItem(STORAGE_KEY);
    return val === 'light' || val === 'dark' ? val : null;
  } catch {
    return null;
  }
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark';
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyMetaTheme(preference: ThemePreference): void {
  if (typeof document === 'undefined') {
    return;
  }
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) {
    meta.setAttribute('content', preference ?? 'light dark');
  }
}

export function useTheme() {
  // Keep initial values SSR-identical to prevent hydration mismatches; hydrate real state in onMounted.
  const preference = ref<ThemePreference>(null);
  const systemTheme = ref<ResolvedTheme>('dark');

  const resolvedTheme = computed<ResolvedTheme>(() => {
    return preference.value ?? systemTheme.value;
  });

  const isOverridden = computed<boolean>(() => preference.value !== null);

  function toggleTheme(): void {
    const currentSystem = getSystemTheme();
    systemTheme.value = currentSystem;
    const target: ResolvedTheme = resolvedTheme.value === 'dark' ? 'light' : 'dark';

    if (target === currentSystem) {
      preference.value = null;
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Ignore storage errors when site data is blocked.
      }
      applyMetaTheme(null);
      return;
    }

    preference.value = target;
    try {
      window.localStorage.setItem(STORAGE_KEY, target);
    } catch {
      // Ignore storage errors when site data is blocked.
    }
    applyMetaTheme(target);
  }

  function onStorage(event: StorageEvent): void {
    if (event.key !== STORAGE_KEY) {
      return;
    }
    const next: ThemePreference =
      event.newValue === 'light' || event.newValue === 'dark' ? event.newValue : null;
    preference.value = next;
    applyMetaTheme(next);
  }

  let mediaQuery: MediaQueryList | null = null;

  function onMediaChange(event: MediaQueryListEvent): void {
    // Only update systemTheme display; never erase a pinned override.
    systemTheme.value = event.matches ? 'dark' : 'light';
  }

  onMounted(() => {
    preference.value = readStoredPreference();
    systemTheme.value = getSystemTheme();
    applyMetaTheme(preference.value);
    window.addEventListener('storage', onStorage);
    if (typeof window.matchMedia === 'function') {
      mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', onMediaChange);
    }
  });

  onUnmounted(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
    if (mediaQuery) {
      mediaQuery.removeEventListener('change', onMediaChange);
    }
  });

  return {
    preference,
    resolvedTheme,
    isOverridden,
    toggleTheme,
  };
}
