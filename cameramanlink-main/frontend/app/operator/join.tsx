import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch, Operator } from "@/src/api";
import { storage } from "@/src/utils/storage";
import { colors, fonts, radius, spacing, type } from "@/src/theme";

export default function JoinScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code: urlCode } = useLocalSearchParams<{ code?: string; cam?: string }>();
  const [code, setCode] = useState(urlCode ? urlCode.toUpperCase() : "");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    if (!code.trim() || !name.trim()) {
      setError("Inserisci codice evento e nome operatore");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const op = await apiFetch<Operator>(`/events/${code.trim().toUpperCase()}/join`, {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      });
      await storage.setItem("livecast-op-session", JSON.stringify(op));
      router.replace({ pathname: "/operator/live", params: { code: op.event_code, opId: op.id } });
    } catch (e: any) {
      setError(e.message || "Connessione fallita");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable testID="join-back-button" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.topTitle}>ACCESSO OPERATORE</Text>
      </View>
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        bottomOffset={96}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.iconWrap}>
          <Ionicons name="videocam" size={34} color={colors.onBrandTertiary} />
        </View>
        <Text style={styles.title}>ENTRA NELL&apos;EVENTO</Text>
        <Text style={styles.desc}>Chiedi alla regia il codice evento a 6 caratteri.</Text>

        <Text style={styles.label}>CODICE EVENTO</Text>
        <TextInput
          testID="join-event-code-input"
          style={styles.input}
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          placeholder="ES. A1B2C3"
          placeholderTextColor={colors.onSurfaceSecondary}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
        />

        <Text style={styles.label}>NOME OPERATORE</Text>
        <TextInput
          testID="join-operator-name-input"
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="Es. Marco"
          placeholderTextColor={colors.onSurfaceSecondary}
          autoCorrect={false}
        />

        {error ? (
          <Text testID="join-error-text" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </KeyboardAwareScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Pressable
          testID="join-submit-button"
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }, loading && { opacity: 0.6 }]}
          onPress={join}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color={colors.onBrand} />
          ) : (
            <Text style={styles.ctaText}>ENTRA IN STAND-BY</Text>
          )}
        </Pressable>
      </View>
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
  iconWrap: {
    width: 68,
    height: 68,
    borderRadius: radius.lg,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  title: { fontFamily: fonts.display, color: colors.onSurface, fontSize: 34 },
  desc: { color: colors.onSurfaceSecondary, fontSize: type.base, marginTop: spacing.xs, marginBottom: spacing.xl },
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
    fontSize: type.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.xl,
    minHeight: 52,
  },
  error: { color: colors.error, fontSize: type.base },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, backgroundColor: colors.surface },
  cta: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { fontFamily: fonts.display, color: colors.onBrand, fontSize: 22, letterSpacing: 1.5 },
});
