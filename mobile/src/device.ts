import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "marketpulse.deviceId";
let cached: string | null = null;

/** Anonymous per-install ID used for watchlist and alert preferences. */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  let id = await AsyncStorage.getItem(KEY).catch(() => null);
  if (!id) {
    id = `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem(KEY, id).catch(() => {});
  }
  cached = id;
  return id;
}
