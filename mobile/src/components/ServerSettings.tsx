import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { DEFAULT_SERVER_URL, DEFAULT_TOKEN, apiUrl, getAccessToken, getServerUrl, setServerUrl } from "../config";
import { colors } from "../theme";
import { Card, Chip } from "./ui";

/** Where the Abulkour backend runs (online or on a PC at home) and the app's access code. */
export function ServerSettings({ onChanged }: { onChanged?: () => void }) {
  const [value, setValue] = useState(getServerUrl());
  const [token, setToken] = useState(getAccessToken());
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const saveAndTest = async () => {
    setBusy(true);
    setResult(null);
    await setServerUrl(value, token);
    setValue(getServerUrl());
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 75_000); // a sleeping server can take ~1 min to start
      const health = await fetch(`${apiUrl()}/health`, { signal: ctrl.signal });
      const auth = health.ok ? await fetch(`${apiUrl()}/status`, { signal: ctrl.signal, headers: { "x-app-token": getAccessToken() } }) : null;
      clearTimeout(t);
      if (!health.ok) setResult({ ok: false, text: `Server answered HTTP ${health.status}.` });
      else if (auth && auth.status === 401) setResult({ ok: false, text: "Server reached, but the access code is wrong." });
      else {
        setResult({ ok: true, text: "Connected." });
        onChanged?.();
      }
    } catch {
      setResult({ ok: false, text: "Can’t reach the server. Check the address and your internet connection." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Text style={styles.title}>Server address</Text>
      <Text style={styles.sub}>Where the Abulkour backend runs, e.g. https://abulkour-api.onrender.com</Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="https://abulkour-api.onrender.com"
        placeholderTextColor={colors.faint}
        style={styles.input}
      />
      <Text style={[styles.sub, { marginTop: 12 }]}>Access code (APP_ACCESS_TOKEN from the server settings)</Text>
      <TextInput
        value={token}
        onChangeText={setToken}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        placeholder="leave empty if the server has none"
        placeholderTextColor={colors.faint}
        style={styles.input}
      />
      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
        <Chip label={busy ? "Testing… (can take a minute)" : "Save & test"} active onPress={busy ? undefined : saveAndTest} />
        {(value !== DEFAULT_SERVER_URL || token !== DEFAULT_TOKEN) && (
          <Chip
            label="Reset"
            onPress={() => {
              setValue(DEFAULT_SERVER_URL);
              setToken(DEFAULT_TOKEN);
            }}
          />
        )}
      </View>
      {result && <Text style={[styles.sub, { color: result.ok ? colors.up : colors.down, marginTop: 8 }]}>{result.text}</Text>}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 15, fontWeight: "700" },
  sub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  input: {
    backgroundColor: colors.cardAlt,
    color: colors.text,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.border,
    fontFamily: "monospace",
  },
});
