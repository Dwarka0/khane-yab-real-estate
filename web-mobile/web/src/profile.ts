/**
 * Device-local memory.
 *
 * The platform does not keep the listing data: a search reads the sources at
 * that moment. What the seeker learns stays on the device. This module holds
 * the profile, the listings that were fetched, and the hints the app derives
 * from what the seeker saved.
 */

export type DeviceProfile = {
  version: 1;
  deviceId: string;
  transactionType: 'buy' | 'rent';
  city: string;
  neighborhoods: string[];
  propertyTypes: string[];
  budgetMin?: number;
  budgetMax?: number;
  minBedrooms?: number;
  minAreaM2?: number;
  mustHave: string[];
  avoid: string[];
  savedListings: SavedListing[];
  /** What the device has learned about what the seeker looks for. */
  learned: LearnedHints;
  /** The listings the device has seen, with the moment they were seen. */
  cache: CachedListing[];
  lastSearch?: { at: string; total: number; city?: string; transactionType: string };
  updatedAt: string;
};

export type SavedListing = {
  id: string;
  title: string;
  source: string;
  url?: string;
  price?: number;
  city?: string;
  areaM2?: number;
  bedrooms?: number;
  savedAt?: string;
};

export type CachedListing = {
  id: string;
  title: string;
  source: string;
  url?: string;
  city?: string;
  neighborhood?: string;
  price: number;
  areaM2?: number;
  bedrooms?: number;
  propertyType: string;
  transactionType: string;
  score: number;
  reasons: string[];
  fetchedAt: string;
};

export type LearnedHints = {
  cities: string[];
  propertyTypes: string[];
  budgetMax?: number;
  minAreaM2?: number;
  minBedrooms?: number;
  samples: number;
};

const STORAGE_KEY = 'khane-yab.profile.v1';
const MAX_CACHE = 200;

export const defaultProfile = (): DeviceProfile => ({
  version: 1,
  deviceId: '',
  transactionType: 'buy',
  city: 'تهران',
  neighborhoods: [],
  propertyTypes: ['apartment'],
  budgetMax: 9_000_000_000,
  minAreaM2: 90,
  minBedrooms: 2,
  mustHave: [],
  avoid: [],
  savedListings: [],
  learned: { cities: [], propertyTypes: [], samples: 0 },
  cache: [],
  updatedAt: new Date().toISOString(),
});

const randomDeviceId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/** Reads the memory of the device, repairing anything unreadable. */
export function loadProfile(): DeviceProfile {
  const fallback = defaultProfile();
  if (typeof localStorage === 'undefined') return { ...fallback, deviceId: randomDeviceId() };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const created = { ...fallback, deviceId: randomDeviceId() };
      saveProfile(created);
      return created;
    }
    const parsed = JSON.parse(raw) as Partial<DeviceProfile>;
    return {
      ...fallback,
      ...parsed,
      version: 1,
      deviceId: parsed.deviceId || randomDeviceId(),
      neighborhoods: Array.isArray(parsed.neighborhoods) ? parsed.neighborhoods : [],
      propertyTypes: Array.isArray(parsed.propertyTypes) ? parsed.propertyTypes : [],
      mustHave: Array.isArray(parsed.mustHave) ? parsed.mustHave : [],
      avoid: Array.isArray(parsed.avoid) ? parsed.avoid : [],
      savedListings: Array.isArray(parsed.savedListings) ? parsed.savedListings : [],
      cache: Array.isArray(parsed.cache) ? parsed.cache : [],
      learned: { ...fallback.learned, ...(parsed.learned ?? {}) },
    };
  } catch {
    const created = { ...fallback, deviceId: randomDeviceId() };
    saveProfile(created);
    return created;
  }
}

/** Writes the memory of the device. */
export function saveProfile(profile: DeviceProfile): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...profile, version: 1, updatedAt: new Date().toISOString() }));
  } catch {
    // A full or blocked storage must never break the search.
  }
}

/** Removes the profile, the favourites, and the local cache from the device. */
export function clearProfile(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Adds or removes a listing from the device-local favourites. */
export function toggleSaved(profile: DeviceProfile, listing: SavedListing): DeviceProfile {
  const exists = profile.savedListings.some((item) => item.id === listing.id);
  const savedListings = exists
    ? profile.savedListings.filter((item) => item.id !== listing.id)
    : [{ ...listing, savedAt: new Date().toISOString() }, ...profile.savedListings].slice(0, 100);
  const next = { ...profile, savedListings, updatedAt: new Date().toISOString() };
  saveProfile(next);
  return next;
}

/**
 * Learns from the listings the seeker saved: the cities, the property types,
 * the budget, the area, and the room count that appear most often become the
 * hints the app suggests next time.
 */
export function learnFromSaved(profile: DeviceProfile): DeviceProfile {
  const samples = profile.savedListings.filter((item) => item.price && item.price > 0);
  if (samples.length === 0) {
    return { ...profile, learned: { ...profile.learned, samples: profile.learned.samples } };
  }
  const cities = [...new Set(profile.savedListings.map((item) => item.city).filter(Boolean) as string[])];
  const prices = samples.map((item) => item.price).filter((price): price is number => Boolean(price)).sort((a, b) => a - b);
  const areas = samples.map((item) => item.areaM2).filter(Boolean) as number[];
  const rooms = samples.map((item) => item.bedrooms).filter((value) => value !== undefined) as number[];
  const learned: LearnedHints = {
    cities,
    propertyTypes: profile.learned.propertyTypes,
    budgetMax: prices[Math.floor(prices.length / 2)],
    minAreaM2: areas.length ? Math.min(...areas) : undefined,
    minBedrooms: rooms.length ? Math.max(...rooms) : undefined,
    samples: profile.learned.samples + samples.length,
  };
  const next = { ...profile, learned, updatedAt: new Date().toISOString() };
  saveProfile(next);
  return next;
}

/** Stores the listings a search returned on the device. */
export function rememberListings(profile: DeviceProfile, listings: CachedListing[]): DeviceProfile {
  const merged = new Map<string, CachedListing>();
  for (const item of profile.cache) merged.set(item.id, item);
  for (const item of listings) merged.set(item.id, item);
  const cache = [...merged.values()].sort((a, b) => (b.fetchedAt > a.fetchedAt ? 1 : -1)).slice(0, MAX_CACHE);
  const next = { ...profile, cache, updatedAt: new Date().toISOString() };
  saveProfile(next);
  return next;
}

/** The criteria a search is made with. */
export type SearchCriteria = {
  transactionType: 'buy' | 'rent';
  city?: string;
  propertyTypes?: string[];
  budgetMin?: number;
  budgetMax?: number;
  minBedrooms?: number;
  minAreaM2?: number;
  neighborhoods?: string[];
};

/** The listings the device already has that fit the criteria. */
export function matchCached(profile: DeviceProfile, criteria: SearchCriteria): CachedListing[] {
  return profile.cache.filter((item) => {
    if (item.transactionType !== criteria.transactionType) return false;
    if (criteria.city && item.city && item.city !== criteria.city) return false;
    if (criteria.neighborhoods?.length && item.neighborhood && !criteria.neighborhoods.some((name) => item.neighborhood!.includes(name))) return false;
    if (criteria.propertyTypes?.length && item.propertyType && !criteria.propertyTypes.includes(item.propertyType)) return false;
    // An unknown price is not a budget mismatch.
    if (item.price > 0 && criteria.budgetMax !== undefined && item.price > criteria.budgetMax) return false;
    if (item.price > 0 && criteria.budgetMin !== undefined && item.price < criteria.budgetMin) return false;
    if (criteria.minAreaM2 !== undefined && item.areaM2 !== undefined && item.areaM2 < criteria.minAreaM2) return false;
    if (criteria.minBedrooms !== undefined && item.bedrooms !== undefined && item.bedrooms < criteria.minBedrooms) return false;
    return true;
  });
}
