// WebRTC Peer Connection Helper for LiveCast Emergent App

const STUN_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" },
  ],
};

export class WebRTCBroadcaster {
  private peers: Map<string, RTCPeerConnection> = new Map();
  private pendingTargets: Set<string> = new Set();
  private localStream: MediaStream | null = null;
  private sendWsMessage: (msg: any) => void;
  private myId: string;
  private camSlot: number;

  constructor(myId: string, camSlot: number, sendWsMessage: (msg: any) => void) {
    this.myId = myId;
    this.camSlot = camSlot;
    this.sendWsMessage = sendWsMessage;
  }

  public async setStream(stream: MediaStream | null) {
    this.localStream = stream;
    if (!stream) {
      this.closeAll();
      return;
    }
    // Re-create offer for all pending and existing targets with the active stream tracks
    const targets = Array.from(new Set([...Array.from(this.pendingTargets), ...Array.from(this.peers.keys())]));
    for (const targetId of targets) {
      await this.createOfferFor(targetId);
    }
  }

  public async handleMessage(data: any) {
    const { type, from, target, sdp, candidate, cam_slot } = data;
    if (target !== this.myId && target !== "all") return;

    if (type === "request-stream" && from && from !== this.myId) {
      // If request specifies a camera slot, only respond if it matches our camera slot!
      if (cam_slot && parseInt(cam_slot, 10) !== this.camSlot) {
        return;
      }
      this.pendingTargets.add(from);
      if (this.localStream) {
        await this.createOfferFor(from);
      }
    } else if (type === "webrtc-answer" && from && sdp) {
      const peer = this.peers.get(from);
      if (peer && peer.signalingState !== "stable") {
        await peer.setRemoteDescription(new RTCSessionDescription(sdp)).catch(() => {});
      }
    } else if (type === "webrtc-candidate" && from && candidate) {
      const peer = this.peers.get(from);
      if (peer) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      }
    }
  }

  public async createOfferFor(targetId: string) {
    if (!this.localStream) return;

    // Close previous connection to targetId if open
    const existing = this.peers.get(targetId);
    if (existing) {
      existing.close();
    }

    const peer = new RTCPeerConnection(STUN_SERVERS);
    this.peers.set(targetId, peer);

    this.localStream.getTracks().forEach((track) => {
      peer.addTrack(track, this.localStream!);
    });

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendWsMessage({
          type: "webrtc-candidate",
          from: this.myId,
          cam_slot: this.camSlot,
          target: targetId,
          candidate: event.candidate,
        });
      }
    };

    try {
      const offer = await peer.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });
      await peer.setLocalDescription(offer);

      this.sendWsMessage({
        type: "webrtc-offer",
        from: this.myId,
        cam_slot: this.camSlot,
        target: targetId,
        sdp: offer,
      });
    } catch (e) {
      console.warn("createOffer error:", e);
    }
  }

  public closeAll() {
    for (const peer of this.peers.values()) {
      peer.close();
    }
    this.peers.clear();
    this.pendingTargets.clear();
  }
}
