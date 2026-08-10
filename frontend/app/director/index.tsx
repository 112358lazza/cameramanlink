import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch, LiveEvent } from "@/src/api";
import { colors, fonts, radius, spacing, type } from "@/src/theme";

export default function DirectorHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [numCams, setNumCams] = useState(3);
  const [mediaHost, setMediaHost] = useState("");
  const [openCode, setOpenCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createEvent = async () => {
    if (!name.trim()) {
      setError("Dai un nome all'evento");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ev = await apiFetch<LiveEvent>("/events", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), num_cameras: numCams, media_host: mediaHost.trim() || null }),
      });
      router.replace({ pathname: "/director/dashboard", params: { code: ev.code } });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const openEvent = async () => {
    if (!openCode.trim()) {
      setError("Inserisci il codice evento");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ev = await apiFetch<LiveEvent>(`/events/${openCode.trim().toUpperCase()}`);
      router.replace({ pathname: "/director/dashboard", params: { code: ev.code } });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable testID="director-back-button" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.topTitle}>REGIA</Text>
      </View>
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.xxl }]}
        bottomOffset={24}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionTitle}>CREA NUOVO EVENTO</Text>
        <Text style={styles.label}>NOME EVENTO</Text>
        <TextInput
          testID="event-name-input"
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Es. Maratona 12h"
          placeholderTextColor={colors.onSurfaceSecondary}
        />
        <Text style={styles.label}>NUMERO CAMERE</Text>
        <View style={styles.camRow}>
          {[2, 3, 4].map((n) => (
            <Pressable
              key={n}
              testID={`num-cameras-${n}-option`}
              style={[styles.camOption, numCams === n && styles.camOptionActive]}
              onPress={() => setNumCams(n)}
            >
              <Text style={[styles.camOptionText, numCams === n && { color: colors.onBrand }]}>{n}</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.label}>IP / DOMINIO MEDIA SERVER (OPZIONALE)</Text>
        <TextInput
          testID="media-host-input"
          style={styles.input}
          value={mediaHost}
          onChangeText={setMediaHost}
          placeholder="Es. 164.90.220.10 — modificabile dopo"
          placeholderTextColor={colors.onSurfaceSecondary}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable
          testID="create-event-button"
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }, loading && { opacity: 0.6 }]}
          onPress={createEvent}
          disabled={loading}
        >
          {loading ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.ctaText}>CREA EVENTO</Text>}
        </Pressable>

        <View style={styles.divider} />

        <Text style={styles.sectionTitle}>APRI EVENTO ESISTENTE</Text>
        <View style={styles.openRow}>
          <TextInput
            testID="open-event-code-input"
            style={[styles.input, { flex: 1, marginBottom: 0 }]}
            value={openCode}
            onChangeText={(t) => setOpenCode(t.toUpperCase())}
            placeholder="CODICE"
            placeholderTextColor={colors.onSurfaceSecondary}
            autoCapitalize="characters"
            maxLength={6}
          />
          <Pressable testID="open-event-button" style={styles.openBtn} onPress={openEvent} disabled={loading}>
            <Ionicons name="arrow-forward" size={22} color={colors.onSurface} />
          </Pressable>
        </View>

        {error ? (
          <Text testID="director-error-text" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSecondary,
  },
  topTitle: { fontFamily: fonts.display, color: colors.onSurface, fontSize: 20, letterSpacing: 1 },
  scroll: { padding: spacing.xl },
  sectionTitle: { fontFamily: fonts.display, color: colors.onSurface, fontSize: 28, marginBottom: spacing.lg },
  label: {
    color: colors.onSurfaceSecondary,
    fontSize: type.sm,
    letterSpacing: 1.5,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    color: colors.onSurface,
    fontSize: type.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
    minHeight: 52,
  },
  camRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.lg },
  camOption: {
    width: 64,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  camOptionActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  camOptionText: { fontFamily: fonts.display, color: colors.onSurface, fontSize: 22 },
  cta: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  ctaText: { fontFamily: fonts.display, color: colors.onBrand, fontSize: 22, letterSpacing: 1.5 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xxl },
  openRow: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  openBtn: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  error: { color: colors.error, fontSize: type.base, marginTop: spacing.lg },
});
