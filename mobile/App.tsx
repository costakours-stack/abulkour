import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { DarkTheme, NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { api, onServerWaking } from "./src/api/client";
import { Icon, type IconName } from "./src/components/ui";
import { loadServerUrl } from "./src/config";
import { getDeviceId } from "./src/device";
import { initNotifications } from "./src/notifications";
import { AlertsScreen } from "./src/screens/AlertsScreen";
import { ArticleScreen } from "./src/screens/ArticleScreen";
import { AssetScreen } from "./src/screens/AssetScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { ModelScreen } from "./src/screens/ModelScreen";
import { NewsScreen } from "./src/screens/NewsScreen";
import { PredictionTraceScreen } from "./src/screens/PredictionTraceScreen";
import { SearchScreen } from "./src/screens/SearchScreen";
import { TopPicksScreen } from "./src/screens/TopPicksScreen";
import { colors } from "./src/theme";

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, border: colors.border, primary: colors.accent, text: colors.text },
};

function tabIcon(active: IconName, inactive: IconName) {
  function TabIcon({ color, focused }: { color: string; focused: boolean }) {
    return <Icon name={focused ? active : inactive} size={22} color={color} />;
  }
  return TabIcon;
}

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.border, height: 62, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        headerStyle: { backgroundColor: colors.bg },
        headerTitleStyle: { fontWeight: "800", fontSize: 20 },
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen name="Home" component={HomeScreen} options={{ headerShown: false, tabBarIcon: tabIcon("pulse", "pulse-outline") }} />
      <Tabs.Screen name="Picks" component={TopPicksScreen} options={{ headerShown: false, title: "Top Picks", tabBarIcon: tabIcon("trophy", "trophy-outline") }} />
      <Tabs.Screen name="News" component={NewsScreen} options={{ title: "News", tabBarIcon: tabIcon("newspaper", "newspaper-outline") }} />
      <Tabs.Screen name="AI" component={ModelScreen} options={{ title: "AI Model", tabBarIcon: tabIcon("sparkles", "sparkles-outline") }} />
      <Tabs.Screen name="Alerts" component={AlertsScreen} options={{ title: "Alerts", tabBarIcon: tabIcon("notifications", "notifications-outline") }} />
    </Tabs.Navigator>
  );
}

/** Shown while a free-tier server is starting up after being idle. */
function WakingBanner() {
  const [waking, setWaking] = useState(false);
  useEffect(() => onServerWaking(setWaking), []);
  const insets = useSafeAreaInsets();
  if (!waking) return null;
  return (
    <View style={[styles.waking, { paddingTop: insets.top + 8 }]}>
      <ActivityIndicator size="small" color={colors.delayed} />
      <Text style={styles.wakingText}>Waking up the server… it sleeps when unused and takes about a minute to start.</Text>
    </View>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadServerUrl().finally(() => {
      setReady(true);
      getDeviceId()
        .then(async (id) => {
          await api.restoreWatchlist(id);
          await initNotifications(id);
        })
        .catch(() => {});
    });
  }, []);

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <SafeAreaProvider>
      <NavigationContainer
        theme={theme}
        documentTitle={{ formatter: (options, route) => `${options?.title ?? route?.name ?? ""} · Abulkour` }}
      >
        <StatusBar style="light" />
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTitleStyle: { fontWeight: "800" },
            headerShadowVisible: false,
            headerTintColor: colors.text,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="Tabs" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="Asset" component={AssetScreen} />
          <Stack.Screen name="Search" component={SearchScreen} options={{ title: "Search stocks & ETFs" }} />
          <Stack.Screen name="Article" component={ArticleScreen} options={{ title: "Article" }} />
          <Stack.Screen name="PredictionTrace" component={PredictionTraceScreen} options={{ title: "Prediction trace" }} />
        </Stack.Navigator>
      </NavigationContainer>
      <WakingBanner />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  waking: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: "#2A2110",
    borderBottomWidth: 1,
    borderBottomColor: "#4A3A14",
  },
  wakingText: { color: colors.text, fontSize: 12, flex: 1 },
});