// Backend URL + the app's access code. The app never holds market-data, news or
// AI API keys — every provider call goes through the Abulkour backend.
//
// Defaults come from mobile/.env at build time (EXPO_PUBLIC_API_URL,
// EXPO_PUBLIC_APP_TOKEN). The user can override both in the app
// (Alerts tab → Server address).

import AsyncStorage from "@react-native-async-storage/async-storage";

const URL_KEY = "abulkour.serverUrl";
const TOKEN_KEY = "abulkour.accessToken";
export const DEFAULT_SERVER_URL = normalize(process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000");
export const DEFAULT_TOKEN = process.env.EXPO_PUBLIC_APP_TOKEN || "";

let base = DEFAULT_SERVER_URL;
let token = DEFAULT_TOKEN;
const listeners = new Set<() => void>();

function normalize(url: string): string {
  let u = url.trim().replace(/\/+$/, "");
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}

export const getServerUrl = () => base;
export const getAccessToken = () => token;
export const apiUrl = () => `${base}/api`;
export const wsUrl = () => `${base.replace(/^http/, "ws")}/ws${token ? `?token=${encodeURIComponent(token)}` : ""}`;

/** Load saved overrides (call once before the app renders). */
export async function loadServerUrl(): Promise<void> {
  try {
    const [u, t] = await Promise.all([
      AsyncStorage.getItem(URL_KEY).catch(() => null),
      AsyncStorage.getItem(TOKEN_KEY).catch(() => null),
    ]);
    if (u) base = normalize(u);
    if (t !== null) token = t;
  } catch {}
}

export async function setServerUrl(url: string, accessToken?: string): Promise<void> {
  base = normalize(url) || DEFAULT_SERVER_URL;
  if (accessToken !== undefined) token = accessToken.trim();
  try {
    await AsyncStorage.setItem(URL_KEY, base);
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } catch {}
  listeners.forEach((l) => l());
}

export function onServerUrlChange(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
