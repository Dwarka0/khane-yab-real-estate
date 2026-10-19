/**
 * Device-local profile.
 *
 * The profile never leaves the device: it is stored in the browser's own
 * storage, needs no account, and is sent with a search only as the short
 * lived anonymous criteria the API already accepts. Saved listings are kept
 * here as well, so the favourites list also works without a login.
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
  updatedAt: string;
};

export type SavedListing = {
  id: string;
  title: string;
  source: string;
  url?: string;
  price?: number;
  city?: string;
  savedAt?: string;
};

const STORAGE_KEY = 'khane-yab.profile.v1';

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
  updatedAt: new Date().toISOString(),
});

const randomDeviceId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/** Reads the profile from the device, repairing anything unreadable. */
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
    };
  } catch {
    const created = { ...fallback, deviceId: randomDeviceId() };
    saveProfile(created);
    return created;
  }
}

/** Writes the profile to the device. */
export function saveProfile(profile: DeviceProfile): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...profile, version: 1, updatedAt: new Date().toISOString() }));
  } catch {
    // A full or blocked storage must never break the search.
  }
}

/** Removes the profile and everything it holds from the device. */
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
