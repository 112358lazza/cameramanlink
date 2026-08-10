import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch, Operator } from "@/src/api";
import { storage } from "@/src/utils/storage";
import { colors, fonts, radius, spacing, type } from "@/src/theme";

export default function JoinScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code: urlCode, cam: urlCam } = useLocalSearchParams<{ code?: string; cam?: string }>();
  const [code, setCode] = useState(urlCode ? urlCode.toUpperCase() : "");
  const [name, setName] = useState("");
  const [loadingSlot, setLoadingSlot] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Direct auto-join if url has code & cam
  useEffect(() => {
    if (urlCode && urlCam) {
      joinCamera(parseInt(urlCam, 10));
    }
  }, [urlCode, urlCam]);

  const joinCamera = async (slot: number) => {
    const targetCode = code.trim().toUpperCase();
    if (!targetCode) {
      setError("Inserisci il Codice Evento fornito dalla Regia");
      return;
    }
    setLoadingSlot(slot);
    setError(null);
    try {
      const opName = name.trim() || `Operatore CAM ${slot}`;
      const op = await apiFetch<Operator>(`/events/${targetCode}/join`, {
        method: "POST",
        body: JSON.stringify({ name: opName, cam_slot: slot }),
      });
      await storage.setItem("livecast-op-session", JSON.stringify(op));
      router.replace({ pathname: "/operator/live", params: { code: op.event_code, opId: op.id } });
    } catch (e: any) {
      setError(e.message || "Connessione alla telecamera fallita");
    } finally {
      setLoadingSlot(null);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable testID="join-back-button" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.topTitle}>ACCESSO RAPIDO CAMERAMAN</Text>
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
        <Text style={styles.title}>SCEGLI LA TUA TELECAMERA</Text>
        <Text style={styles.desc}>Tocca la telecamera per entrare direttamente ed iniziare a trasmettere.</Text>

        <Text style={styles.label}>CODICE EVENTO REGIA</Text>
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

        <Text style={styles.label}>NOME CAMERAMAN (OPZIONALE)</Text>
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

        <Text style={[styles.label, { marginTop: spacing.md, marginBottom: spacing.sm }]}>TELECAMERE DISPONIBILI</Text>
        
        <View style={styles.cameraGrid}>
          {[1, 2, 3, 4].map((slot) => (
            <Pressable
              key={slot}
              style={({ pressed }) => [
                styles.camCard,
                pressed && styles.camCardPressed,
                loadingSlot === slot && { opacity: 0.6 },
              ]}
              onPress={() => joinCamera(slot)}
              disabled={loadingSlot !== null}
            >
              <View style={styles.camIconWrap}>
                <Ionicons name="videocam" size={26} color="#60a5fa" />
              </View>
              <View style={styles.camCardBody}>
                <Text style={styles.camCardTitle}>CAMERA {slot}</Text>
                <Text style={styles.camCardSub}>Tocca per accedere a CAM {slot}</Text>
              </View>
              {loadingSlot === slot ? (
                <ActivityIndicator color="#3b82f6" />
              ) : (
                <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceSecondary} />
              )}
            </Pressable>
          ))}
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    padding: spacing.xs,
    marginRight: spacing.sm,
  },
  topTitle: {
    color: colors.onSurface,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1,
  },
  scroll: {
    padding: spacing.lg,
  },
  iconWrap: {
    width: 60,
    height: 60,
    borderRadius: radius.md,
    backgroundColor: colors.brandSecondary,
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  title: {
    color: colors.onSurface,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  desc: {
    color: colors.onSurfaceSecondary,
    fontSize: 14,
    textAlign: "center",
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  label: {
    color: colors.onSurfaceSecondary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.onSurface,
    fontSize: 16,
    fontWeight: "600",
    marginBottom: spacing.md,
  },
  error: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: spacing.md,
    textAlign: "center",
  },
  cameraGrid: {
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  camCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#111827",
    borderColor: "#1f2937",
    borderWidth: 1.5,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  camCardPressed: {
    borderColor: "#3b82f6",
    backgroundColor: "#1e293b",
  },
  camIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: "#1e3a8a",
    justifyContent: "center",
    alignItems: "center",
    marginRight: spacing.md,
  },
  camCardBody: {
    flex: 1,
  },
  camCardTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  camCardSub: {
    color: "#94A3B8",
    fontSize: 12,
    marginTop: 2,
  },
});
