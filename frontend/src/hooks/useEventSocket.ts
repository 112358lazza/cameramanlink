import { useCallback, useEffect, useRef, useState } from "react";

import { wsUrl } from "@/src/api";

type Handler = (data: any) => void;

export function useEventSocket(eventCode: string | undefined, clientId: string | undefined, onMessage: Handler) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef<Handler>(onMessage);
  const retryRef = useRef(0);
  const aliveRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  handlerRef.current = onMessage;

  const connect = useCallback(() => {
    if (!eventCode || !clientId || !aliveRef.current) return;
    try {
      const ws = new WebSocket(wsUrl(eventCode, clientId));
      wsRef.current = ws;
      ws.onopen = () => {
        retryRef.current = 0;
        setConnected(true);
      };
      ws.onmessage = (e) => {
        try {
          handlerRef.current(JSON.parse(e.data as string));
        } catch {}
      };
      ws.onclose = () => {
        setConnected(false);
        if (!aliveRef.current) return;
        const delay = Math.min(1000 * 2 ** retryRef.current, 10000);
        retryRef.current += 1;
        timerRef.current = setTimeout(connect, delay);
      };
      ws.onerror = () => {
        ws.close();
      };
    } catch {
      timerRef.current = setTimeout(connect, 3000);
    }
  }, [eventCode, clientId]);

  useEffect(() => {
    aliveRef.current = true;
    connect();
    return () => {
      aliveRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const send = useCallback((payload: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }, []);

  return { connected, send };
}
