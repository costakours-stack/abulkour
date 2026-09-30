import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { api } from "../api/client";
import type { AlertEvent, AlertPrefs } from "../api/types";
import { Card, Empty, Label, Section } from "../components/ui";
import { ServerSettings } from "../components/ServerSettings";
import { getDeviceId } from "../device";
import { ago } from "../format";
import { realtime } from "../api/realtime";
import { setNotificationsEnabled } from "../notifications";
import { colors } from "../theme";

/** News alerts for watchlist assets. Users can turn all notifications off. */
export function AlertsScreen() {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [prefs, setPrefs] = useState<Record<string, AlertPrefs>>({});
  const [history, setHistory] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const [nonce, setNonce] = useState(0);
  const load = useCallback(() => {
    setLoading(true);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let current = true;
    (async () => {
      const id = await getDeviceId();
      if (!current) return;
      setDeviceId(id);
      try {
        const [wl, p, h] = await Promise.all([api.watchlist(id), api.alertPrefs(id), api.alertHistory(id)]);
        if (!current) return;
        setWatchlist(wl);
        setEnabled(p.device?.notificationsEnabled ?? true);
        setPrefs(Object.fromEntries(p.prefs.map((x) => [x.symbol, x])));
        setHistory(h);
      } catch {
        /* shown as empty */
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => {
      current = false;
    };
  }, [nonce]);

  useEffect(
    () =>
      realtime.subscribe(["alerts"], (msg) => {
        if (msg.type === "alert") setHistory((h) => [msg.data, ...h]);
      }),
    [],
  );

  const toggleAll = async (v: boolean) => {
    setEnabled(v);
    if (deviceId) await setNotificationsEnabled(deviceId, v);
  };

  const update = async (symbol: string, patch: Partial<AlertPrefs>) => {
    if (!deviceId) return;
    const cur = prefs[symbol] ?? { symbol, newArticle: false, highImpact: false, unusualSentiment: false };
    const next = { ...cur, ...patch };
    setPrefs((p) => ({ ...p, [symbol]: next }));
    await api.setAlertPrefs(deviceId, next).catch(() => {});
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
    >
      <Card style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Notifications</Text>
          <Text style={styles.sub}>Turn off to stop all alerts on this device.</Text>
        </View>
        <Switch value={enabled} onValueChange={toggleAll} />
      </Card>

      <Section title="WATCHLIST ALERTS">
        {watchlist.length === 0 && <Empty text="Add assets to your watchlist to set alerts." />}
        {watchlist.map((s) => {
          const p = prefs[s];
          return (
            <Card key={s} style={{ marginBottom: 8, opacity: enabled ? 1 : 0.5 }}>
              <Text style={styles.title}>{s}</Text>
              <Toggle label="High-impact news detected" value={!!p?.highImpact} onChange={(v) => update(s, { highImpact: v })} disabled={!enabled} />
              <Toggle label="Unusual news sentiment detected" value={!!p?.unusualSentiment} onChange={(v) => update(s, { unusualSentiment: v })} disabled={!enabled} />
              <Toggle label="Every new article" value={!!p?.newArticle} onChange={(v) => update(s, { newArticle: v })} disabled={!enabled} />
            </Card>
          );
        })}
      </Section>

      <Section title="CONNECTION">
        <ServerSettings onChanged={load} />
      </Section>

      <Section title="RECENT ALERTS">
        {history.length === 0 && <Empty text="No alerts yet." />}
        {history.map((a) => (
          <Card key={a.id} style={{ marginBottom: 8 }}>
            <Label color={a.kind === "high_impact" ? colors.delayed : colors.accent}>{a.kind.replace("_", " ").toUpperCase()}</Label>
            <Text style={[styles.title, { marginTop: 4 }]}>{a.title}</Text>
            <Text style={styles.sub}>{a.body}</Text>
            <Text style={styles.time}>{ago(a.createdAt)}</Text>
          </Card>
        ))}
      </Section>
    </ScrollView>
  );
}

function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <View style={[styles.row, { marginTop: 8 }]}>
      <Text style={[styles.sub, { flex: 1, marginTop: 0 }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} disabled={disabled} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { color: colors.text, fontSize: 15, fontWeight: "700" },
  sub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  time: { color: colors.faint, fontSize: 11, marginTop: 4 },
});
