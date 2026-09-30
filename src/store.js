import { Preferences } from '@capacitor/preferences';

const EVENTS_KEY = 'events';
const PENDING_KEY = 'pending_events';

async function readList(key) {
  const { value } = await Preferences.get({ key });
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeList(key, items) {
  await Preferences.set({ key, value: JSON.stringify(items) });
}

export const loadEvents = () => readList(EVENTS_KEY);
export const loadPendingEvents = () => readList(PENDING_KEY);

export async function addEvents(events) {
  const current = await loadEvents();
  await writeList(EVENTS_KEY, [...current, ...events]);
}

export async function updateEvent(id, patch) {
  const current = await loadEvents();
  await writeList(EVENTS_KEY, current.map((event) => event.id === id ? { ...event, ...patch } : event));
}

export async function deleteEvent(id) {
  const current = await loadEvents();
  await writeList(EVENTS_KEY, current.filter((event) => event.id !== id));
}

export async function addPendingEvents(events) {
  const current = await loadPendingEvents();
  await writeList(PENDING_KEY, [...current, ...events]);
}

export async function updatePendingEvent(id, patch) {
  const current = await loadPendingEvents();
  await writeList(PENDING_KEY, current.map((event) => event.id === id ? { ...event, ...patch } : event));
}

export async function deletePendingEvent(id) {
  const current = await loadPendingEvents();
  await writeList(PENDING_KEY, current.filter((event) => event.id !== id));
}
