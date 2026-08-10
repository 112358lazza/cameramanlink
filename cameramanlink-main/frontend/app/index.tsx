import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, fonts, radius, spacing, type } from "@/src/theme";

const BG =
  "https://images.unsplash.com/photo-1636226570637-3fbda7ca09dc?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2NDJ8MHwxfHNlYXJjaHwyfHxkYXJrJTIwYnJvYWRjYXN0JTIwc3R1ZGlvJTIwY29udHJvbCUyMHJvb218ZW58MHx8fHwxNzg2MzQ5NTYxfDA&ixlib=rb-4.1.0&q=85";

export default function RoleSelection() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container} testID="role-selection-screen">
      <Image source={{ uri: BG }} style={StyleSheet.absoluteFill} contentFit="cover" />
      <LinearGradient
        colors={["rgba(18,18,20,0.55)", "rgba(18,18,20,0.92)", "#121214"]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.content, { paddingTop: insets.top + spacing.xxxl, paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.header}>
          <View style={styles.liveDot} />
          <Text style={styles.brand}>LIVECAST REGIA</Text>
        </View>
        <Text style={styles.title}>DIRETTA{"\n"}MULTICAMERA</Text>
        <Text style={styles.subtitle}>
          Trasmetti dal telefono verso OBS. Tally, chat e monitoraggio in tempo reale.
        </Text>

          <Pressable
            testID="role-webrtc-card"
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed, { borderColor: "#3b82f6" }]}
            onPress={() => {
              if (Platform.OS === "web") {
                window.location.href = "https://cameraman.gerikult.it/studio/director";
              }
            }}
          >
            <View style={[styles.cardIcon, { backgroundColor: "#1e3a8a" }]}>
              <Ionicons name="flash" size={26} color="#60a5fa" />
            </View>
            <View style={styles.cardBody}>
              <Text style={[styles.cardTitle, { color: "#93c5fd" }]}>STREAMING BROWSER DIRETTO (OBS)</Text>
              <Text style={styles.cardDesc}>Trasmissione video immediata da Safari/Chrome senza app installate</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceSecondary} />
          </Pressable>

          <Pressable
            testID="role-cameraman-card"
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => router.push("/operator/join")}
          >
            <View style={[styles.cardIcon, { backgroundColor: colors.brandTertiary }]}>
              <Ionicons name="videocam" size={26} color={colors.onBrandTertiary} />
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>SONO UN CAMERAMAN (SRT)</Text>
              <Text style={styles.cardDesc}>Entra con il codice evento e vai in onda</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceSecondary} />
          </Pressable>

          <Pressable
            testID="role-director-card"
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => router.push("/director")}
          >
            <View style={[styles.cardIcon, { backgroundColor: "#12321B" }]}>
              <Ionicons name="tv" size={26} color={colors.success} />
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>SONO LA REGIA (SRT)</Text>
              <Text style={styles.cardDesc}>Crea l&apos;evento, gestisci tally e OBS</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.onSurfaceSecondary} />
          </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  content: { flex: 1, paddingHorizontal: spacing.xl, justifyContent: "flex-end" },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  liveDot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.brand },
  brand: {
    color: colors.onSurfaceSecondary,
    fontSize: type.sm,
    letterSpacing: 3,
    fontWeight: "700",
  },
  title: {
    fontFamily: fonts.display,
    color: colors.onSurface,
    fontSize: 52,
    lineHeight: 52,
  },
  subtitle: {
    color: colors.onSurfaceSecondary,
    fontSize: type.lg,
    lineHeight: 22,
    marginTop: spacing.md,
    marginBottom: spacing.xxl,
  },
  cards: { gap: spacing.md },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.lg,
    minHeight: 84,
  },
  cardPressed: { backgroundColor: colors.surfaceTertiary },
  cardIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: { flex: 1 },
  cardTitle: { fontFamily: fonts.display, color: colors.onSurface, fontSize: 22, letterSpacing: 0.5 },
  cardDesc: { color: colors.onSurfaceSecondary, fontSize: type.base, marginTop: 2 },
});
