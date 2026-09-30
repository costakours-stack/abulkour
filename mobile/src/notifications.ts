import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api/client";
import { realtime } from "./api/realtime";

let enabled = true;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Registers the device with the backend and shows alerts as local notifications
 * while the app is running. Remote push (app closed) additionally needs an EAS
 * project ID and EXPO_PUSH_ENABLED=true on the server.
 */
export async function initNotifications(deviceId: string) {
  let pushToken: string | null = null;
  try {
    const perm = await Notifications.requestPermissionsAsync();
    if (perm.granted) {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("alerts", { name: "News alerts", importance: Notifications.AndroidImportance.DEFAULT });
      }
      try {
        pushToken = (await Notifications.getExpoPushTokenAsync()).data;
      } catch {
        pushToken = null; // no EAS project configured: local notifications only
      }
    }
  } catch {
    /* notifications unsupported (e.g. web) */
  }

  const prefs = await api.alertPrefs(deviceId).catch(() => null);
  enabled = prefs?.device?.notificationsEnabled ?? true;
  await api.registerDevice(deviceId, pushToken, enabled).catch(() => {});

  realtime.setDeviceId(deviceId);
  realtime.subscribe(["alerts"], (msg) => {
    if (msg.type !== "alert" || !enabled) return;
    Notifications.scheduleNotificationAsync({
      content: { title: msg.data.title, body: msg.data.body, data: { articleId: msg.data.articleId, symbol: msg.data.symbol } },
      trigger: null,
    }).catch(() => {});
  });
  return pushToken;
}

export async function setNotificationsEnabled(deviceId: string, value: boolean) {
  enabled = value;
  let token: string | null = null;
  try {
    token = (await Notifications.getExpoPushTokenAsync()).data;
  } catch {}
  await api.registerDevice(deviceId, token, value).catch(() => {});
}
