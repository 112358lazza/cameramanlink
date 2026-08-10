import { Ionicons } from "@expo/vector-icons";
import * as Battery from "expo-battery";
import { CameraType, CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { useKeepAwake } from "expo-keep-awake";
import * as MediaLibrary from "expo-media-library";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetch, ChatMessage, Operator } from "@/src/api";
import { useEventSocket } from "@/src/hooks/useEventSocket";
import { storage } from "@/src/utils/storage";
import { colors, fonts, radius, spacing, type } from "@/src/theme";

import { WebRTCBroadcaster } from "@/src/utils/webrtc";

const PRESETS = ["OK", "Aspetta", "Zoom in", "Zoom out", "Cambia inquadratura"];

// Wake Lock is not permitted on the web preview — mount only on native.
function KeepAwakeNative() {
  useKeepAwake();
  return null;
}

export default function LiveScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { code, opId } = useLocalSearchParams<{ code: string; opId: string }>();

  const [session, setSession] = useState<Operator | null>(null);
  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();
  const [facing, setFacing] = useState<CameraType>("back");
  const [onAir, setOnAir] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [locked, setLocked] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  const [ping, setPing] = useState<number | null>(null);
  const [bitrate, setBitrate] = useState(0);
  const [recording, setRecording] = useState(false);

  const cameraRef = useRef<CameraView>(null);
  const streamingRef = useRef(false);
  const batteryRef = useRef<number | null>(null);
  const pingRef = useRef<number | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<FlatList>(null);
  const broadcasterRef = useRef<WebRTCBroadcaster | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // Load session
  useEffect(() => {
    (async () => {
      const raw = await storage.getItem("livecast-op-session", "");
      if (raw) {
        try {
          setSession(JSON.parse(raw as string));
          return;
        } catch {}
      }
      router.replace("/operator/join");
    })();
  }, [router]);

  const onWsMessage = useCallback(
    (data: any) => {
      if (data.type === "presence") {
        const me = (data.operators || []).find((o: Operator) => o.id === opId);
        if (me) setOnAir(!!me.on_air);
      } else if (data.type === "pong") {
        const rtt = Date.now() - Number(data.ts);
        setPing(rtt);
        pingRef.current = rtt;
      } else if (data.type === "chat") {
        const msg: ChatMessage = data.message;
        setMessages((prev) => [...prev, msg]);
        if (msg.sender === "director") showToast(`Regia: ${msg.text}`);
      } else if (["request-stream", "webrtc-answer", "webrtc-candidate"].includes(data.type)) {
        broadcasterRef.current?.handleMessage(data);
      }
    },
    [opId, showToast],
  );

  const { connected, send } = useEventSocket(code, opId, onWsMessage);

  useEffect(() => {
    if (!opId || !send || !session) return;
    broadcasterRef.current = new WebRTCBroadcaster(opId, session.cam_slot, send);
    return () => {
      broadcasterRef.current?.closeAll();
    };
  }, [opId, send, session]);

  // Chat history
  useEffect(() => {
    if (!code || !opId) return;
    apiFetch<ChatMessage[]>(`/events/${code}/messages?for_operator=${opId}`)
      .then(setMessages)
      .catch(() => {});
  }, [code, opId]);

  // Battery
  useEffect(() => {
    let sub: any;
    (async () => {
      try {
        const lvl = await Battery.getBatteryLevelAsync();
        if (lvl >= 0) {
          setBattery(Math.round(lvl * 100));
          batteryRef.current = Math.round(lvl * 100);
        }
        sub = Battery.addBatteryLevelListener(({ batteryLevel }) => {
          const v = Math.round(batteryLevel * 100);
          setBattery(v);
          batteryRef.current = v;
        });
      } catch {}
    })();
    return () => sub?.remove();
  }, []);

  // Ping + status loop
  useEffect(() => {
    if (!connected) return;
    const pingInt = setInterval(() => send({ type: "ping", ts: Date.now() }), 4000);
    const statusInt = setInterval(() => {
      const live = streamingRef.current;
      const br = live ? 3800 + Math.round(Math.random() * 900) : 0;
      setBitrate(br);
      send({
        type: "status",
        battery: batteryRef.current,
        ping: pingRef.current,
        bitrate: br,
        streaming: live,
      });
    }, 3000);
    send({ type: "ping", ts: Date.now() });
    return () => {
      clearInterval(pingInt);
      clearInterval(statusInt);
    };
  }, [connected, send]);

  const toggleLive = async () => {
    const next = !streaming;
    setStreaming(next);
    streamingRef.current = next;
    send({ type: "status", streaming: next, bitrate: next ? 4000 : 0, battery: batteryRef.current, ping: batteryRef.current });
    
    if (next) {
      showToast("STREAMING IN ONDA — Segnale WebRTC Attivo!");
      if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.mediaDevices) {
        let stream: MediaStream | null = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: facing === "back" ? "environment" : "user" },
            audio: true,
          });
        } catch {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: { facingMode: facing === "back" ? "environment" : "user" },
              audio: false,
            });
          } catch (e) {
            console.error("getUserMedia failed:", e);
          }
        }
        if (stream && broadcasterRef.current) {
          await broadcasterRef.current.setStream(stream);
        }
      }
    } else {
      if (Platform.OS === "web" && broadcasterRef.current) {
        broadcasterRef.current.setStream(null);
      }
      showToast("Stream fermato");
    }
  };

  const sendChat = (text: string, preset = false) => {
    const t = text.trim();
    if (!t) return;
    send({ type: "chat", channel: opId, text: t, preset });
    setChatText("");
  };

  const toggleRec = async () => {
    if (Platform.OS === "web") {
      showToast("Registrazione backup disponibile solo su dispositivo");
      return;
    }
    if (recording) {
      cameraRef.current?.stopRecording();
      return;
    }
    const ml = await MediaLibrary.requestPermissionsAsync();
    setRecording(true);
    showToast("Registrazione backup avviata");
    try {
      const video = await cameraRef.current?.recordAsync();
      if (video?.uri && ml.granted) {
        await MediaLibrary.saveToLibraryAsync(video.uri);
        showToast("Backup salvato in galleria");
      }
    } catch {
      showToast("Registrazione interrotta");
    }
    setRecording(false);
  };

  const askPermissions = async () => {
    const cam = await requestCamPerm();
    await requestMicPerm();
    if (!cam.granted && !cam.canAskAgain) {
      showToast("Abilita la camera dalle impostazioni");
    }
  };

  const connQuality = ping == null ? colors.onSurfaceSecondary : ping < 80 ? colors.success : ping < 200 ? colors.warning : colors.error;

  if (!camPerm || !session) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brand} size="large" />
      </View>
    );
  }

  // Permission gate (contextual, with settings fallback)
  if (!camPerm.granted) {
    return (
      <View style={[styles.center, { padding: spacing.xl }]} testID="camera-permission-screen">
        <Ionicons name="videocam-off" size={56} color={colors.onSurfaceSecondary} />
        <Text style={styles.permTitle}>SERVE LA CAMERA</Text>
        <Text style={styles.permDesc}>
          Per trasmettere video e audio alla regia, LiveCast ha bisogno di accedere a camera e microfono.
        </Text>
        {camPerm.canAskAgain ? (
          <Pressable testID="camera-permission-grant-button" style={styles.permBtn} onPress={askPermissions}>
            <Text style={styles.permBtnText}>CONSENTI ACCESSO</Text>
          </Pressable>
        ) : (
          <Pressable
            testID="camera-permission-settings-button"
            style={styles.permBtn}
            onPress={() => Linking.openSettings()}
          >
            <Text style={styles.permBtnText}>APRI IMPOSTAZIONI</Text>
          </Pressable>
        )}
        <Pressable testID="camera-permission-back-button" onPress={() => router.back()} style={{ marginTop: spacing.lg, minHeight: 44, justifyContent: "center" }}>
          <Text style={{ color: colors.onSurfaceSecondary }}>Torna indietro</Text>
        </Pressable>
      </View>
    );
  }

  const visibleMessages = messages.slice(-60);

  const exitSession = async () => {
    if (code && opId) {
      apiFetch(`/events/${code}/operators/${opId}`, { method: "DELETE" }).catch(() => {});
    }
    await storage.removeItem("livecast-op-session");
    broadcasterRef.current?.closeAll();
    router.replace("/operator/join");
  };

  return (
    <View style={styles.container} testID="operator-live-screen">
      {Platform.OS !== "web" && <KeepAwakeNative />}
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} mode="video" />

      {/* ON AIR frame */}
      {onAir && <View style={[styles.onAirFrame, { pointerEvents: "none" }]} testID="on-air-frame" />}

      {/* Top overlay */}
      <View style={[styles.topOverlay, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.pillRow}>
          <View style={styles.pill} testID="status-cam-pill">
            <Text style={styles.pillText}>CAM {session.cam_slot}</Text>
          </View>
          <View style={styles.pill} testID="status-battery-pill">
            <Ionicons name="battery-half" size={13} color={colors.onSurface} />
            <Text style={styles.pillText}>{battery != null ? `${battery}%` : "--"}</Text>
          </View>
          <View style={styles.pill} testID="status-ping-pill">
            <View style={[styles.qualityDot, { backgroundColor: connQuality }]} />
            <Text style={styles.pillText}>{ping != null ? `${ping}ms` : "--"}</Text>
          </View>
          <View style={styles.pill} testID="status-bitrate-pill">
            <Ionicons name="cellular" size={13} color={streaming ? colors.success : colors.onSurfaceSecondary} />
            <Text style={styles.pillText}>{streaming ? `${(bitrate / 1000).toFixed(1)} Mbps` : "0.0"}</Text>
          </View>
          <Pressable onPress={exitSession} style={[styles.pill, { backgroundColor: "#7f1d1d", marginLeft: "auto" }]}>
            <Ionicons name="log-out-outline" size={14} color="#fca5a5" />
            <Text style={[styles.pillText, { color: "#fca5a5", fontWeight: "700" }]}>ESCI</Text>
          </Pressable>
          {!connected && (
            <View style={[styles.pill, { backgroundColor: colors.brandSecondary }]} testID="status-reconnecting-pill">
              <Text style={styles.pillText}>RICONNESSIONE…</Text>
            </View>
          )}
        </View>
        {onAir && (
          <View style={styles.onAirBadge} testID="on-air-badge">
            <View style={styles.onAirDot} />
            <Text style={styles.onAirText}>ON AIR</Text>
          </View>
        )}
      </View>

      {/* Right controls */}
      <View style={[styles.sideControls, { top: insets.top + 120 }]}>
        <Pressable
          testID="flip-camera-button"
          style={styles.sideBtn}
          onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))}
        >
          <Ionicons name="camera-reverse" size={22} color={colors.onSurface} />
        </Pressable>
        <Pressable testID="chat-toggle-button" style={styles.sideBtn} onPress={() => setChatOpen((v) => !v)}>
          <Ionicons name={chatOpen ? "close" : "chatbubble-ellipses"} size={22} color={colors.onSurface} />
        </Pressable>
        <Pressable
          testID="record-toggle-button"
          style={[styles.sideBtn, recording && { backgroundColor: colors.brand }]}
          onPress={toggleRec}
        >
          <Ionicons name="recording" size={22} color={colors.onSurface} />
        </Pressable>
        <Pressable testID="lock-screen-button" style={styles.sideBtn} onPress={() => setLocked(true)}>
          <Ionicons name="lock-closed" size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      {/* Chat overlay */}
      {chatOpen && (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={0}
          style={styles.chatWrap}
        >
          <View style={[styles.chatPanel, { marginBottom: insets.bottom + 132 }]} testID="chat-panel">
            <FlatList
              ref={listRef}
              data={visibleMessages}
              keyExtractor={(m) => m.id}
              style={styles.chatList}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
              renderItem={({ item }) => (
                <View style={[styles.msgRow, item.sender === opId && styles.msgRowMine]}>
                  <Text style={[styles.msgSender, item.sender === "director" && { color: colors.onBrandTertiary }]}>
                    {item.sender === opId ? "Tu" : item.sender_name}
                  </Text>
                  <Text style={styles.msgText}>{item.text}</Text>
                </View>
              )}
              ListEmptyComponent={<Text style={styles.chatEmpty}>Nessun messaggio con la regia</Text>}
            />
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={PRESETS}
              keyExtractor={(p) => p}
              style={styles.presetRow}
              contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.md, alignItems: "center" }}
              renderItem={({ item }) => (
                <Pressable
                  testID={`preset-${item.toLowerCase().replace(/\s+/g, "-")}-button`}
                  style={styles.presetChip}
                  onPress={() => sendChat(item, true)}
                >
                  <Text style={styles.presetText}>{item}</Text>
                </Pressable>
              )}
            />
            <View style={styles.chatInputRow}>
              <TextInput
                testID="chat-text-input"
                style={styles.chatInput}
                value={chatText}
                onChangeText={setChatText}
                placeholder="Messaggio alla regia…"
                placeholderTextColor={colors.onSurfaceSecondary}
                onSubmitEditing={() => sendChat(chatText)}
                returnKeyType="send"
              />
              <Pressable testID="chat-send-button" style={styles.sendBtn} onPress={() => sendChat(chatText)}>
                <Ionicons name="send" size={18} color={colors.onBrand} />
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* Toast */}
      {toast && (
        <View style={[styles.toast, { top: insets.top + 64, pointerEvents: "none" }]} testID="toast-message">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {/* GO LIVE */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Pressable
          testID="go-live-button"
          style={({ pressed }) => [
            styles.goLive,
            streaming && styles.goLiveActive,
            pressed && { transform: [{ scale: 0.98 }] },
          ]}
          onPress={toggleLive}
        >
          <View style={[styles.goLiveDot, { backgroundColor: streaming ? colors.onBrand : colors.brand }]} />
          <Text style={[styles.goLiveText, streaming && { color: colors.onBrand }]}>
            {streaming ? "STOP STREAM" : "GO LIVE"}
          </Text>
        </Pressable>
        <Pressable testID="leave-event-button" style={styles.leaveBtn} onPress={() => router.replace("/")}>
          <Ionicons name="exit-outline" size={20} color={colors.onSurfaceSecondary} />
        </Pressable>
      </View>

      {/* Lock overlay */}
      {locked && (
        <Pressable
          testID="unlock-screen-overlay"
          style={styles.lockOverlay}
          onLongPress={() => setLocked(false)}
          delayLongPress={1200}
        >
          <Ionicons name="lock-closed" size={40} color={colors.onSurface} />
          <Text style={styles.lockText}>SCHERMO BLOCCATO</Text>
          <Text style={styles.lockHint}>Tieni premuto 1 secondo per sbloccare</Text>
          {onAir && (
            <View style={[styles.onAirBadge, { marginTop: spacing.xl }]}>
              <View style={styles.onAirDot} />
              <Text style={styles.onAirText}>ON AIR</Text>
            </View>
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  permTitle: { fontFamily: fonts.display, color: colors.onSurface, fontSize: 30, marginTop: spacing.lg },
  permDesc: {
    color: colors.onSurfaceSecondary,
    fontSize: type.base,
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    lineHeight: 20,
  },
  permBtn: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xxl,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  permBtnText: { fontFamily: fonts.display, color: colors.onBrand, fontSize: 18, letterSpacing: 1 },
  onAirFrame: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 6,
    borderColor: colors.brand,
  },
  topOverlay: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: spacing.md },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    backgroundColor: "rgba(18,18,20,0.72)",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    height: 30,
  },
  pillText: { color: colors.onSurface, fontSize: type.sm, fontWeight: "700" },
  qualityDot: { width: 8, height: 8, borderRadius: radius.pill },
  onAirBadge: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
  },
  onAirDot: { width: 12, height: 12, borderRadius: radius.pill, backgroundColor: colors.onBrand },
  onAirText: { fontFamily: fonts.display, color: colors.onBrand, fontSize: 30, letterSpacing: 3 },
  sideControls: { position: "absolute", right: spacing.md, gap: spacing.md },
  sideBtn: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: "rgba(18,18,20,0.72)",
    alignItems: "center",
    justifyContent: "center",
  },
  chatWrap: { ...StyleSheet.absoluteFillObject, justifyContent: "flex-end" },
  chatPanel: {
    marginHorizontal: spacing.md,
    backgroundColor: "rgba(18,18,20,0.92)",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    maxHeight: 360,
    overflow: "hidden",
  },
  chatList: { maxHeight: 190, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  chatEmpty: { color: colors.onSurfaceSecondary, fontSize: type.sm, padding: spacing.md, textAlign: "center" },
  msgRow: { marginBottom: spacing.sm },
  msgRowMine: { alignItems: "flex-end" },
  msgSender: { color: colors.onSurfaceSecondary, fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  msgText: { color: colors.onSurface, fontSize: type.base },
  presetRow: { flexGrow: 0, height: 56, borderTopWidth: 1, borderTopColor: colors.border },
  presetChip: {
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
  presetText: { color: colors.onSurface, fontSize: type.base, fontWeight: "600" },
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
    backgroundColor: colors.surfaceSecondary,
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
  toast: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: "rgba(18,18,20,0.94)",
    borderLeftWidth: 3,
    borderLeftColor: colors.brand,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  toastText: { color: colors.onSurface, fontSize: type.base },
  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  goLive: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    minHeight: 64,
    borderRadius: radius.lg,
    backgroundColor: "rgba(18,18,20,0.85)",
    borderWidth: 2,
    borderColor: colors.brand,
  },
  goLiveActive: { backgroundColor: colors.brand },
  goLiveDot: { width: 14, height: 14, borderRadius: radius.pill },
  goLiveText: { fontFamily: fonts.display, color: colors.brand, fontSize: 26, letterSpacing: 2 },
  leaveBtn: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: "rgba(18,18,20,0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  lockOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center",
    justifyContent: "center",
  },
  lockText: { fontFamily: fonts.display, color: colors.onSurface, fontSize: 28, marginTop: spacing.md, letterSpacing: 2 },
  lockHint: { color: colors.onSurfaceSecondary, fontSize: type.base, marginTop: spacing.xs },
});
