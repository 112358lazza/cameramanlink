import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import { useEventSocket } from "@/src/hooks/useEventSocket";

export default function ObsScreen() {
  const { event: eventCode, cam: camSlot } = useLocalSearchParams<{ event: string; cam: string }>();
  const [status, setStatus] = useState("In attesa di connessione...");
  const [streaming, setStreaming] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamingRef = useRef(false);

  const onWsMessage = async (data: any) => {
    if (data.type === "webrtc-offer" && data.sdp) {
      setStatus("Connessione WebRTC in corso...");
      try {
        const peer = new RTCPeerConnection({
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
          ],
        });
        peerRef.current = peer;

        peer.ontrack = (evt) => {
          if (evt.streams && evt.streams[0]) {
            setStreaming(true);
            streamingRef.current = true;
            setStatus("IN ONDA");
            if (videoRef.current) {
              videoRef.current.srcObject = evt.streams[0];
              videoRef.current.play().catch(() => {});
            }
          }
        };

        peer.onicecandidate = (evt) => {
          if (evt.candidate && send) {
            send({
              type: "webrtc-candidate",
              from: obsClientId,
              target: data.from,
              candidate: evt.candidate,
            });
          }
        };

        await peer.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        if (send) {
          send({
            type: "webrtc-answer",
            from: obsClientId,
            target: data.from,
            sdp: answer,
          });
        }
      } catch (e) {
        console.error("WebRTC offer handle error:", e);
      }
    } else if (data.type === "webrtc-candidate" && data.candidate && peerRef.current) {
      await peerRef.current.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
    }
  };

  const { connected, send } = useEventSocket(eventCode || "", obsClientId, onWsMessage);

  useEffect(() => {
    if (!connected || !send) return;
    setStatus(`Connesso alla Regia (${eventCode}). In attesa di CAM ${camSlot}...`);
    send({ type: "request-stream", target: "all", from: obsClientId });
    const interval = setInterval(() => {
      if (!streamingRef.current) {
        send({ type: "request-stream", target: "all", from: obsClientId });
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [connected, send, eventCode, camSlot, obsClientId]);

  if (Platform.OS !== "web") {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>OBS Source è utilizzabile da Browser/OBS Studio</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <video
        ref={(el) => {
          if (el) videoRef.current = el;
        }}
        autoPlay
        playsInline
        muted
        style={{
          width: "100%",
          height: "100%",
          objectFit: "contain",
          backgroundColor: "#000",
        }}
      />
      {!streaming && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#3b82f6" style={{ marginBottom: 16 }} />
          <Text style={styles.title}>LIVECAST STUDIO — OBS SOURCE</Text>
          <Text style={styles.subtitle}>{status}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(10, 10, 15, 0.92)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 1,
    marginBottom: 8,
  },
  subtitle: {
    color: "#94A3B8",
    fontSize: 14,
    textAlign: "center",
  },
  text: {
    color: "#FFF",
    fontSize: 16,
  },
});
