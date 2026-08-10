# PRD — LiveCast Regia

## Problem statement (original)
Sistema completo per gestire una diretta di 12 ore con 2-3 operatori che riprendono dal cellulare.
App mobile per cameramen (Expo/React Native) + dashboard regia (stessa codebase, via web) + ingestion
MediaMTX su DigitalOcean. Ogni operatore trasmette verso il media server; la regia importa gli stream
in OBS come sorgenti SRT. Chat bidirezionale, tally ON AIR, monitoraggio stato operatori, log evento.

## User choices
- Streaming SRT: predisposto (URL generati, guida MediaMTX) ma MOCKED in Expo Go — anteprima camera locale; streaming reale con build nativa (fase 2)
- MediaMTX: utente non ha ancora il server → guida completa in /app/MEDIAMTX_SETUP.md + host configurabile da dashboard
- Login: solo codice evento + nome operatore (niente account)
- Audio: microfoni smartphone
- Dashboard: stessa codebase Expo (web)

## Architecture
- Backend: FastAPI + MongoDB (collections: events, operators, messages, logs) su :8001, prefisso /api
- Realtime: WebSocket /api/ws/{event_code}/{client_id} (client_id = "director" | operator_id) — presenza, chat (broadcast + 1:1), tally (una sola cam on air), status operatore (batteria/bitrate/ping/streaming), ping/pong per latenza, log persistiti
- URL stream generati da media_host evento (default env MEDIA_SERVER_HOST): publish_srt, read_srt (per OBS), publish_rtmp, hls
- Frontend Expo Router: / (scelta ruolo) → /operator/join → /operator/live ; /director → /director/dashboard
- Design: dark-first utility (#121214), Signal Red #E52E2D, font Barlow Condensed (assets/fonts)

## Implemented (2026-06)
- [x] Creazione evento (nome, 2-4 camere, media host opzionale) → codice 6 char + stream key per camera
- [x] Join operatore con codice evento + nome (rejoin riusa slot; 409 se pieno)
- [x] Camera live screen: preview full-screen (expo-camera), flip front/back, GO LIVE (stato mock bitrate), badge+cornice ON AIR, pill batteria/ping/bitrate/qualità, riconnessione WS automatica (backoff), blocco schermo (long-press per sbloccare), keep-awake (solo nativo), registrazione backup locale → galleria (solo nativo), gestione permessi contestuale con fallback impostazioni
- [x] Chat: broadcast + 1:1, preset rapidi (OK/Aspetta/Zoom in/Zoom out/Cambia inquadratura), toast messaggi regia, storico persistito
- [x] Dashboard regia: griglia camere con tally rosso/verde, metriche live, copia URL SRT-OBS/SRT-publish/RTMP, chat con chip canali, log evento live + download txt, edit media server host, responsive (side panel ≥980px)
- [x] Guida MediaMTX DigitalOcean (/app/MEDIAMTX_SETUP.md) + config OBS
- [x] Testing: backend 14/14 pytest, E2E frontend 2 contesti (tally + chat cross-client) PASS; fix wake-lock web + pointerEvents deprecato

## Mocked / limitations
- Streaming video SRT reale MOCKED: richiede build nativa (libreria SRT tipo haishinkit) — segnalazione/tally/chat sono reali
- Preview video in dashboard: placeholder (HLS player da MediaMTX in backlog)

## Backlog (priorità)
- P0: integrazione SRT nativa (config plugin/build nativa) per publish reale verso MediaMTX
- P1: player HLS/WebRTC nella dashboard per preview reali; auth path MediaMTX (stream key whitelisting)
- P1: return video (programma OBS sul telefono)
- P2: intercom audio bidirezionale, overlay grafiche comandate da regia, registrazione cloud, multi-evento/ruoli

## Test refs
- /app/memory/test_credentials.md (nessuna credenziale: flusso a codice evento)
- /app/backend/tests/test_backend.py, /app/test_reports/iteration_1.json
