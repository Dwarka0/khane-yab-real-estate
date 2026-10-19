import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

/**
 * Device-local profile for the mobile app.
 *
 * The profile is stored in the app's own storage on the phone. It needs no
 * account, it is never uploaded as a profile, and the user can erase it from
 * the app at any time. Saved listings live here as well.
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

/** Reads the profile from the device, repairing anything unreadable. */
export async function loadProfile(): Promise<DeviceProfile> {
  const fallback = defaultProfile();
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const created = { ...fallback, deviceId: Crypto.randomUUID() };
      await saveProfile(created);
      return created;
    }
    const parsed = JSON.parse(raw) as Partial<DeviceProfile>;
    return {
      ...fallback,
      ...parsed,
      version: 1,
      deviceId: parsed.deviceId || Crypto.randomUUID(),
      neighborhoods: Array.isArray(parsed.neighborhoods) ? parsed.neighborhoods : [],
      propertyTypes: Array.isArray(parsed.propertyTypes) ? parsed.propertyTypes : [],
      mustHave: Array.isArray(parsed.mustHave) ? parsed.mustHave : [],
      avoid: Array.isArray(parsed.avoid) ? parsed.avoid : [],
      savedListings: Array.isArray(parsed.savedListings) ? parsed.savedListings : [],
    };
  } catch {
    return { ...fallback, deviceId: Crypto.randomUUID() };
  }
}

/** Writes the profile to the device. */
export async function saveProfile(profile: DeviceProfile): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...profile, version: 1, updatedAt: new Date().toISOString() }));
  } catch {
    // A full or blocked storage must never break the search.
  }
}

/** Removes the profile and everything it holds from the device. */
export async function clearProfile(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Adds or removes a listing from the device-local favourites. */
export async function toggleSaved(profile: DeviceProfile, listing: SavedListing): Promise<DeviceProfile> {
  const exists = profile.savedListings.some((item) => item.id === listing.id);
  const savedListings = exists
    ? profile.savedListings.filter((item) => item.id !== listing.id)
    : [{ ...listing, savedAt: new Date().toISOString() }, ...profile.savedListings].slice(0, 100);
  const next = { ...profile, savedListings, updatedAt: new Date().toISOString() };
  await saveProfile(next);
  return next;
}
