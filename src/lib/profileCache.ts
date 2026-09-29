import type { ProfileDto } from '../types';
import * as settings from './settings';

export async function saveProfileCache(profile: ProfileDto): Promise<void> {
  await settings.set(settings.KEY_PROFILE_CACHE, JSON.stringify(profile));
}

export async function loadProfileCache(): Promise<ProfileDto | null> {
  const raw = await settings.get(settings.KEY_PROFILE_CACHE);
  if (!raw) return null;
  try {
    return withProfileDefaults(JSON.parse(raw) as ProfileDto);
  } catch {
    return null;
  }
}

export async function clearProfileCache(): Promise<void> {
  await settings.remove(settings.KEY_PROFILE_CACHE);
}

/** Profiles cached by older app versions lack the newer header fields. */
function withProfileDefaults(p: ProfileDto): ProfileDto {
  return {
    ...p,
    coverUrl: p.coverUrl ?? null,
    coverPositionY: p.coverPositionY ?? null,
    banners: p.banners ?? [],
    location: p.location ?? null,
    isStaff: p.isStaff ?? false,
    isModerator: p.isModerator ?? false,
    joinedAtTs: p.joinedAtTs ?? null,
    lastSeenTs: p.lastSeenTs ?? null,
    followState: p.followState ?? null,
    conversationUrl: p.conversationUrl ?? null,
    activity: (p.activity ?? []).map((a) => ({
      ...a,
      dateTs: a.dateTs ?? null,
      meta: a.meta ?? null,
    })),
  };
}
