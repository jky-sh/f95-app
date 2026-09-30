import type { FollowedUser, MemberCardDto } from '../types/social';
import * as settings from './settings';

/**
 * Last known following list and member cards, so the Friends page renders
 * instantly (and offline) while fresh data loads. Keyed by the logged-in
 * account so switching accounts never shows someone else's list.
 */

export interface Cached<T> {
  savedAt: number;
  data: T;
}

const followingKey = (ownerId: string) => `social_following:${ownerId}`;
const cardsKey = (ownerId: string) => `social_member_cards:${ownerId}`;

async function readJson<T>(key: string): Promise<T | null> {
  const raw = await settings.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function loadFollowingCache(ownerId: string): Promise<Cached<FollowedUser[]> | null> {
  return readJson<Cached<FollowedUser[]>>(followingKey(ownerId));
}

export async function saveFollowingCache(ownerId: string, users: FollowedUser[]): Promise<void> {
  const value: Cached<FollowedUser[]> = { savedAt: Date.now(), data: users };
  await settings.set(followingKey(ownerId), JSON.stringify(value));
}

export type CardCache = Record<string, Cached<MemberCardDto>>;

export async function loadMemberCardsCache(ownerId: string): Promise<CardCache> {
  return (await readJson<CardCache>(cardsKey(ownerId))) ?? {};
}

export async function saveMemberCardsCache(ownerId: string, cards: CardCache): Promise<void> {
  await settings.set(cardsKey(ownerId), JSON.stringify(cards));
}
