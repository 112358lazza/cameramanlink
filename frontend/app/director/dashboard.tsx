import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { API, apiFetch, ChatMessage, LiveEvent, LogEntry, Operator } from "@/src/api";
import { useEventSocket } from "@/src/hooks/useEventSocket";
import { colors, fonts, radius, spacing, type } from "@/src/theme";

export default function Dashboard() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code } = useLocalSearchParams<{ code: string }>();
  const { width } = useWindowDimensions();
  const wide = width >= 980;

  const [event, setEvent] = useState<LiveEvent | null>(null);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [channel, setChannel] = useState("all");
  const [tab, setTab] = useState<"chat" | "log">("chat");
  const [chatText, setChatText] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [hostDraft, setHostDraft] = useState("");
  const [editingHost, setEditingHost] = useState(false);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatListRef = useRef<FlatList>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const onWsMessage = useCallback((data: any) => {
    if (data.type === "presence") {
      setOperators(data.operators || []);
    } else if (data.type === "status") {
      setOperators((prev) => prev.map((o) => (o.id === data.operator_id ? { ...o, ...data, id: o.id } : o)));
    } else if (data.type === "chat") {
      setMessages((prev) => [...prev, data.message]);
    } else if (data.type === "log") {
      setLogs((prev) => [data.entry, ...prev]);
    }
  }, []);

  const { connected, send } = useEventSocket(code, "director", onWsMessage);

  useEffect(() => {
    if (!code) return;
    apiFetch<LiveEvent>(`/events/${code}`).then(setEvent).catch(() => {});
    apiFetch<Operator[]>(`/events/${code}/operators`).then(setOperators).catch(() => {});
    apiFetch<LogEntry[]>(`/events/${code}/logs`).then(setLogs).catch(() => {});
    apiFetch<ChatMessage[]>(`/events/${code}/messages`).then(setMessages).catch(() => {});
  }, [code]);

  const copy = async (text: string, label: string) => {
    await Clipboard.setStringAsync(text);
    showToast(`${label} copiato negli appunti`);
  };

  const toggleTally = (op: Operator) => {
    send({ type: "tally", operator_id: op.id, on_air: !op.on_air });
  };

  const sendChat = () => {
    const t = chatText.trim();
    if (!t) return;
    send({ type: "chat", channel, text: t, preset: false });
    setChatText("");
  };

  const saveHost = async () => {
    if (!hostDraft.trim() || !event) return;
    try {
      const ev = await apiFetch<LiveEvent>(`/events/${event.code}`, {
        method: "PATCH",
        body: JSON.stringify({ media_host: hostDraft.trim() }),
      });
      setEvent(ev);
      setEditingHost(false);
      showToast("Media server aggiornato");
    } catch (e: any) {
      showToast(e.message);
    }
  };

  const downloadLog = () => {
    const url = `${API}/events/${code}/logs/download`;
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-undef
      window.open(url, "_blank");
    } else {
      Linking.openURL(url);
    }
  };

  if (!event) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  const visibleMessages = messages.filter((m) => (channel === "all" ? m.channel === "all" : m.channel === channel));

  const channelChips = [
    { id: "all", label: "TUTTI" },
    ...operators.map((o) => ({ id: o.id, label: `CAM${o.cam_slot} ${o.name}` })),
  ];

  const cameraGrid = (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.xl }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.grid}>
        {event.cameras.map((cam) => {
          const op = operators.find((o) => o.cam_slot === cam.slot);
          const borderColor = op?.on_air ? colors.brand : op?.online ? colors.success : colors.border;
          return (
            <View
              key={cam.slot}
              testID={`camera-tile-${cam.slot}`}
              style={[styles.tile, { borderColor }, wide && { width: "48.5%" }]}
            >
              <View style={styles.tileHeader}>
                <Text style={styles.tileCam}>CAM {cam.slot}</Text>
                {op?.on_air ? (
                  <View style={styles.tileOnAir} testID={`tile-onair-badge-${cam.slot}`}>
                    <Text style={styles.tileOnAirText}>ON AIR</Text>
                  </View>
                ) : (
                  <View style={[styles.statusDot, { backgroundColor: op?.online ? colors.success : colors.borderStrong }]} />
                )}
              </View>

              <View style={styles.preview}>
                <Ionicons
                  name={op?.streaming ? "radio" : "videocam-off-outline"}
                  size={30}
                  color={op?.streaming ? colors.success : colors.onSurfaceSecondary}
                />
                <Text style={styles.previewText}>
                  {!op
                    ? "In attesa dell'operatore"
                    : !op.online
                      ? `${op.name} — offline`
                      : op.streaming
                        ? "SEGNALE ATTIVO — preview via MediaMTX/OBS"
                        : `${op.name} in stand-by`}
                </Text>
              </View>

              <View style={styles.metricsRow}>
                <View style={styles.metric}>
                  <Ionicons name="battery-half" size={13} color={colors.onSurfaceSecondary} />
                  <Text style={styles.metricText}>{op?.battery != null ? `${op.battery}%` : "--"}</Text>
                </View>
                <View style={styles.metric}>
                  <Ionicons name="cellular" size={13} color={colors.onSurfaceSecondary} />
                  <Text style={styles.metricText}>{op?.streaming ? `${((op.bitrate || 0) / 1000).toFixed(1)} Mbps` : "0.0"}</Text>
                </View>
                <View style={styles.metric}>
                  <Ionicons name="pulse" size={13} color={colors.onSurfaceSecondary} />
                  <Text style={styles.metricText}>{op?.ping != null ? `${op.ping}ms` : "--"}</Text>
                </View>
              </View>

              <Pressable
                testID={`tally-button-${cam.slot}`}
                style={[styles.tallyBtn, op?.on_air ? styles.tallyOn : !op?.online && styles.tallyDisabled]}
                onPress={() => op && toggleTally(op)}
                disabled={!op}
              >
                <Text style={[styles.tallyText, op?.on_air && { color: colors.onBrand }]}>
                  {op?.on_air ? "TOGLI DALL'ONDA" : "METTI IN ONDA"}
                </Text>
              </Pressable>

              <View style={styles.tileActions}>
                <Pressable
                  testID={`copy-obs-url-${cam.slot}`}
                  style={styles.smallBtn}
                  onPress={() => copy(cam.urls.read_srt, "URL OBS (SRT)")}
                >
                  <Ionicons name="copy-outline" size={14} color={colors.onSurfaceTertiary} />
                  <Text style={styles.smallBtnText}>SRT per OBS</Text>
                </Pressable>
                <Pressable
                  testID={`copy-publish-url-${cam.slot}`}
                  style={styles.smallBtn}
                  onPress={() => copy(cam.urls.publish_srt, "URL pubblicazione")}
                >
                  <Ionicons name="cloud-upload-outline" size={14} color={colors.onSurfaceTertiary} />
                  <Text style={styles.smallBtnText}>SRT publish</Text>
                </Pressable>
                <Pressable
                  testID={`copy-rtmp-url-${cam.slot}`}
                  style={styles.smallBtn}
                  onPress={() => copy(cam.urls.publish_rtmp, "URL RTMP")}
                >
                  <Ionicons name="git-branch-outline" size={14} color={colors.onSurfaceTertiary} />
                  <Text style={styles.smallBtnText}>RTMP</Text>
                </Pressable>
                {op && (
                  <Pressable
                    testID={`chat-with-${cam.slot}`}
                    style={styles.smallBtn}
                    onPress={() => {
                      setChannel(op.id);
                      setTab("chat");
                    }}
                  >
                    <Ionicons name="chatbubble-outline" size={14} color={colors.onSurfaceTertiary} />
                    <Text style={styles.smallBtnText}>Chat 1:1</Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
      </View>

      {operators.length === 0 && (
        <View style={styles.emptyState} testID="dashboard-empty-state">
          <Ionicons name="videocam-off-outline" size={40} color={colors.onSurfaceSecondary} />
          <Text style={styles.emptyTitle}>NESSUN OPERATORE CONNESSO</Text>
          <Text style={styles.emptyDesc}>
            Condividi il codice evento {event.code} con i cameramen per farli entrare in stand-by.
          </Text>
        </View>
      )}

      <View style={styles.serverCard} testID="media-server-card">
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Ionicons name="server-outline" size={16} color={colors.onSurfaceSecondary} />
          <Text style={styles.serverTitle}>MEDIA SERVER (MediaMTX)</Text>
        </View>
        {editingHost ? (
          <View style={styles.hostRow}>
            <TextInput
              testID="media-host-edit-input"
              style={styles.hostInput}
              value={hostDraft}
              onChangeText={setHostDraft}
              placeholder="IP o dominio DigitalOcean"
              placeholderTextColor={colors.onSurfaceSecondary}
              autoCapitalize="none"
            />
            <Pressable testID="media-host-save-button" style={styles.hostSaveBtn} onPress={saveHost}>
              <Ionicons name="checkmark" size={18} color={colors.onBrand} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.hostRow}>
            <Text style={styles.hostText} testID="media-host-value">
              {event.media_host}
            </Text>
            <Pressable
              testID="media-host-edit-button"
              style={styles.hostEditBtn}
              onPress={() => {
                setHostDraft(event.media_host === "YOUR_DO_SERVER_IP" ? "" : event.media_host);
                setEditingHost(true);
              }}
            >
              <Ionicons name="pencil" size={14} color={colors.onSurfaceTertiary} />
            </Pressable>
          </View>
        )}
        {event.media_host === "YOUR_DO_SERVER_IP" && (
          <Text style={styles.serverHint}>
            Imposta l&apos;IP del tuo droplet DigitalOcean con MediaMTX — vedi MEDIAMTX_SETUP.md nel progetto.
          </Text>
        )}
      </View>
    </ScrollView>
  );

  const sidePanel = (
    <View style={[styles.sidePanel, wide ? { width: 360, borderLeftWidth: 1 } : { flex: 1 }]}>
      <View style={styles.tabRow}>
        <Pressable
          testID="tab-chat-button"
          style={[styles.tabBtn, tab === "chat" && styles.tabBtnActive]}
          onPress={() => setTab("chat")}
        >
          <Text style={[styles.tabText, tab === "chat" && { color: colors.onSurface }]}>CHAT</Text>
        </Pressable>
        <Pressable
          testID="tab-log-button"
          style={[styles.tabBtn, tab === "log" && styles.tabBtnActive]}
          onPress={() => setTab("log")}
        >
          <Text style={[styles.tabText, tab === "log" && { color: colors.onSurface }]}>LOG EVENTO</Text>
        </Pressable>
        {tab === "log" && (
          <Pressable testID="download-log-button" style={styles.dlBtn} onPress={downloadLog}>
            <Ionicons name="download-outline" size={16} color={colors.onSurfaceTertiary} />
          </Pressable>
        )}
      </View>

      {tab === "chat" ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={0}
        >
          <View style={styles.chipRowWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowContent}>
              {channelChips.map((c) => (
                <Pressable
                  key={c.id}
                  testID={`channel-chip-${c.id === "all" ? "all" : c.label.split(" ")[0].toLowerCase()}`}
                  style={[styles.chip, channel === c.id && styles.chipActive]}
                  onPress={() => setChannel(c.id)}
                >
                  <Text style={[styles.chipText, channel === c.id && { color: colors.onBrand }]}>{c.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
          <FlatList
            ref={chatListRef}
            data={visibleMessages}
            keyExtractor={(m) => m.id}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: spacing.md }}
            onContentSizeChange={() => chatListRef.current?.scrollToEnd({ animated: false })}
            renderItem={({ item }) => (
              <View style={[styles.msgRow, item.sender === "director" && styles.msgRowMine]}>
                <Text style={styles.msgSender}>
                  {item.sender === "director" ? "Tu (Regia)" : item.sender_name}
                  {item.preset ? "  ·  preset" : ""}
                </Text>
                <Text style={styles.msgText}>{item.text}</Text>
              </View>
            )}
            ListEmptyComponent={<Text style={styles.emptyDesc}>Nessun messaggio in questo canale</Text>}
          />
          <View style={[styles.chatInputRow, { paddingBottom: insets.bottom + spacing.md }]}>
            <TextInput
              testID="director-chat-input"
              style={styles.chatInput}
              value={chatText}
              onChangeText={setChatText}
              placeholder={channel === "all" ? "Messaggio a tutti…" : "Messaggio privato…"}
              placeholderTextColor={colors.onSurfaceSecondary}
              onSubmitEditing={sendChat}
              returnKeyType="send"
            />
            <Pressable testID="director-chat-send-button" style={styles.sendBtn} onPress={sendChat}>
              <Ionicons name="send" size={18} color={colors.onBrand} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(l) => l.id}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: insets.bottom + spacing.lg }}
          renderItem={({ item }) => (
            <View style={styles.logRow}>
              <Text style={styles.logTs}>{new Date(item.ts).toLocaleTimeString("it-IT")}</Text>
              <Text style={styles.logKind}>{item.kind.toUpperCase()}</Text>
              <Text style={styles.logMsg}>{item.message}</Text>
            </View>
          )}
          ListEmptyComponent={<Text style={styles.emptyDesc}>Nessuna voce di log</Text>}
        />
      )}
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]} testID="director-dashboard">
      {/* Header */}
      <View style={styles.header}>
        <Pressable testID="dashboard-back-button" onPress={() => router.replace("/")} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={colors.onSurface} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {event.name.toUpperCase()}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <View style={[styles.statusDot, { backgroundColor: connected ? colors.success : colors.error }]} />
            <Text style={styles.headerSub}>{connected ? "Regia online" : "Riconnessione…"}</Text>
          </View>
        </View>
        <Pressable testID="copy-event-code-button" style={styles.codeBadge} onPress={() => copy(event.code, "Codice evento")}>
          <Text style={styles.codeText}>{event.code}</Text>
          <Ionicons name="copy-outline" size={14} color={colors.onBrandTertiary} />
        </Pressable>
      </View>

      {wide ? (
        <View style={{ flex: 1, flexDirection: "row" }}>
          <View style={{ flex: 1 }}>{cameraGrid}</View>
          {sidePanel}
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={{ flex: 1 }}>{cameraGrid}</View>
          <View style={{ height: 380, borderTopWidth: 1, borderTopColor: colors.border }}>{sidePanel}</View>
        </View>
      )}

      {toast && (
        <View style={[styles.toast, { top: insets.top + 70, pointerEvents: "none" }]} testID="dashboard-toast">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  header: {
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
    backgroundColor: colors.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontFamily: fonts.display, color: colors.onSurface, fontSize: 22, letterSpacing: 0.5 },
  headerSub: { color: colors.onSurfaceSecondary, fontSize: type.sm },
  codeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 44,
  },
  codeText: { fontFamily: fonts.display, color: colors.onBrandTertiary, fontSize: 20, letterSpacing: 2 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  tile: {
    width: "100%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 2,
    padding: spacing.md,
  },
  tileHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  tileCam: { fontFamily: fonts.display, color: colors.onSurface, fontSize: 20, letterSpacing: 1 },
  tileOnAir: {
    backgroundColor: colors.brand,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  tileOnAirText: { fontFamily: fonts.display, color: colors.onBrand, fontSize: 14, letterSpacing: 1.5 },
  statusDot: { width: 10, height: 10, borderRadius: radius.pill },
  preview: {
    height: 110,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  previewText: { color: colors.onSurfaceSecondary, fontSize: type.sm, textAlign: "center" },
  metricsRow: { flexDirection: "row", gap: spacing.lg, marginBottom: spacing.md },
  metric: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  metricText: { color: colors.onSurfaceTertiary, fontSize: type.sm, fontWeight: "600" },
  tallyBtn: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  tallyOn: { backgroundColor: colors.brand },
  tallyDisabled: { borderColor: colors.borderStrong, opacity: 0.6 },
  tallyText: { fontFamily: fonts.display, color: colors.brand, fontSize: 19, letterSpacing: 1.5 },
  tileActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  smallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: 36,
  },
  smallBtnText: { color: colors.onSurfaceTertiary, fontSize: type.sm, fontWeight: "600" },
  emptyState: { alignItems: "center", padding: spacing.xxl, gap: spacing.sm },
  emptyTitle: { fontFamily: fonts.display, color: colors.onSurface, fontSize: 22, letterSpacing: 1 },
  emptyDesc: { color: colors.onSurfaceSecondary, fontSize: type.base, textAlign: "center", padding: spacing.md },
  serverCard: {
    marginTop: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  serverTitle: { color: colors.onSurfaceSecondary, fontSize: type.sm, letterSpacing: 1.5, fontWeight: "700" },
  hostRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  hostText: { flex: 1, color: colors.onSurface, fontSize: type.lg, fontWeight: "600" },
  hostInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    color: colors.onSurface,
    paddingHorizontal: spacing.md,
    minHeight: 44,
  },
  hostSaveBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  hostEditBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  serverHint: { color: colors.warning, fontSize: type.sm },
  sidePanel: { backgroundColor: colors.surfaceSecondary, borderColor: colors.border },
  tabRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    height: 48,
  },
  tabBtn: { paddingHorizontal: spacing.md, height: 48, justifyContent: "center" },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: colors.brand },
  tabText: { color: colors.onSurfaceSecondary, fontSize: type.sm, letterSpacing: 1.5, fontWeight: "700" },
  dlBtn: { marginLeft: "auto", width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  chipRowWrap: { height: 56, borderBottomWidth: 1, borderBottomColor: colors.border },
  chipRowContent: { gap: spacing.sm, paddingHorizontal: spacing.md, alignItems: "center" },
  chip: {
    flexShrink: 0,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.onSurfaceTertiary, fontSize: type.sm, fontWeight: "700" },
  msgRow: { marginBottom: spacing.md },
  msgRowMine: { alignItems: "flex-end" },
  msgSender: { color: colors.onSurfaceSecondary, fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  msgText: { color: colors.onSurface, fontSize: type.base, marginTop: 1 },
  chatInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  chatInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    color: colors.onSurface,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    fontSize: type.base,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  logRow: { marginBottom: spacing.md },
  logTs: { color: colors.onSurfaceSecondary, fontSize: 10, fontVariant: ["tabular-nums"] },
  logKind: { color: colors.info, fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  logMsg: { color: colors.onSurfaceTertiary, fontSize: type.base },
  toast: {
    position: "absolute",
    alignSelf: "center",
    backgroundColor: "rgba(18,18,20,0.95)",
    borderLeftWidth: 3,
    borderLeftColor: colors.success,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    maxWidth: 420,
  },
  toastText: { color: colors.onSurface, fontSize: type.base },
});
