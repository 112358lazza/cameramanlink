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
  private localStream: MediaStream | null = null;
  private sendWsMessage: (msg: any) => void;
  private myId: string;

  constructor(myId: string, sendWsMessage: (msg: any) => void) {
    this.myId = myId;
    this.sendWsMessage = sendWsMessage;
  }

  public async setStream(stream: MediaStream) {
    this.localStream = stream;
    for (const [targetId, peer] of this.peers.entries()) {
      const senders = peer.getSenders();
      for (const track of stream.getTracks()) {
        const existing = senders.find((s) => s.track?.kind === track.kind);
        if (existing) {
          existing.replaceTrack(track);
        } else {
          peer.addTrack(track, stream);
        }
      }
    }
  }

  public async handleMessage(data: any) {
    const { type, from, target, sdp, candidate } = data;
    if (target !== this.myId && target !== "all") return;

    if (type === "request-stream" && from) {
      await this.createOfferFor(from);
    } else if (type === "webrtc-answer" && from && sdp) {
      const peer = this.peers.get(from);
      if (peer) {
        await peer.setRemoteDescription(new RTCSessionDescription(sdp));
      }
    } else if (type === "webrtc-candidate" && from && candidate) {
      const peer = this.peers.get(from);
      if (peer) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      }
    }
  }

  private async createOfferFor(targetId: string) {
    const peer = new RTCPeerConnection(STUN_SERVERS);
    this.peers.set(targetId, peer);

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        peer.addTrack(track, this.localStream!);
      });
    }

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendWsMessage({
          type: "webrtc-candidate",
          from: this.myId,
          target: targetId,
          candidate: event.candidate,
        });
      }
    };

    const offer = await peer.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false,
    });
    await peer.setLocalDescription(offer);

    this.sendWsMessage({
      type: "webrtc-offer",
      from: this.myId,
      target: targetId,
      sdp: offer,
    });
  }

  public closeAll() {
    for (const peer of this.peers.values()) {
      peer.close();
    }
    this.peers.clear();
  }
}
