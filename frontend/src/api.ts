export const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL as string;
export const API = `${BACKEND_URL}/api`;

export function wsUrl(eventCode: string, clientId: string) {
  const base = BACKEND_URL.replace(/^https/, "wss").replace(/^http/, "ws");
  return `${base}/api/ws/${eventCode}/${clientId}`;
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = `Errore ${res.status}`;
    try {
      const body = await res.json();
      if (body.detail) detail = typeof body.detail === "string" ? body.detail : detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export interface CameraSlot {
  slot: number;
  stream_key: string;
  urls: StreamUrls;
}

export interface StreamUrls {
  publish_srt: string;
  read_srt: string;
  publish_rtmp: string;
  hls: string;
}

export interface LiveEvent {
  id: string;
  code: string;
  name: string;
  num_cameras: number;
  media_host: string;
  cameras: CameraSlot[];
  created_at: string;
}

export interface Operator {
  id: string;
  event_code: string;
  name: string;
  cam_slot: number;
  stream_key: string;
  online: boolean;
  on_air: boolean;
  streaming: boolean;
  battery: number | null;
  bitrate: number;
  ping: number | null;
  urls?: StreamUrls;
  event_name?: string;
}

export interface ChatMessage {
  id: string;
  sender: string;
  sender_name: string;
  channel: string;
  text: string;
  preset: boolean;
  ts: string;
}

export interface LogEntry {
  id: string;
  kind: string;
  message: string;
  ts: string;
}
