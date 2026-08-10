# MediaMTX su DigitalOcean — Guida installazione (LiveCast Regia)

Guida passo-passo per creare il media server che riceve gli stream SRT/RTMP dai telefoni
e li serve a OBS e alla dashboard.

## 1. Crea il Droplet

1. Vai su https://cloud.digitalocean.com → **Create → Droplet**
2. Scegli:
   - **Immagine**: Ubuntu 24.04 LTS
   - **Piano**: Basic — 4 GB RAM / 2 vCPU (≈ $24/mese) — sufficiente per 3 camere a 5 Mbps
   - **Datacenter**: il più vicino a te (es. Frankfurt `fra1`)
3. Crea il droplet e annota l'**IP pubblico** (es. `164.90.220.10`)

## 2. Installa Docker

```bash
ssh root@TUO_IP
curl -fsSL https://get.docker.com | sh
```

## 3. Configura MediaMTX

Crea il file di configurazione:

```bash
mkdir -p /opt/mediamtx && cd /opt/mediamtx
nano mediamtx.yml
```

Incolla:

```yaml
# mediamtx.yml — LiveCast Regia
logLevel: info

# SRT (consigliato per i telefoni — resiliente su 4G/5G)
srt: yes
srtAddress: :8890

# RTMP (fallback)
rtmp: yes
rtmpAddress: :1935

# HLS (preview browser/dashboard)
hls: yes
hlsAddress: :8888
hlsAlwaysRemux: yes
hlsVariant: lowLatency

# WebRTC (preview a bassissima latenza, opzionale)
webrtc: yes
webrtcAddress: :8889

paths:
  all_others:
```

> Con `paths: all_others` qualsiasi stream key generato dall'app è accettato automaticamente.
> Per bloccare stream key non autorizzati puoi elencare i path espliciti (uno per stream key).

## 4. Avvia MediaMTX con Docker

```bash
docker run -d \
  --name mediamtx \
  --restart unless-stopped \
  -p 8890:8890/udp \
  -p 1935:1935 \
  -p 8888:8888 \
  -p 8889:8889 \
  -v /opt/mediamtx/mediamtx.yml:/mediamtx.yml \
  bluenviron/mediamtx:latest
```

Verifica: `docker logs mediamtx` → devi vedere `[SRT] listener opened on :8890`.

## 5. Apri il firewall

```bash
ufw allow 22/tcp
ufw allow 8890/udp   # SRT
ufw allow 1935/tcp   # RTMP
ufw allow 8888/tcp   # HLS
ufw allow 8889/tcp   # WebRTC
ufw enable
```

## 6. Collega l'app

1. Apri la **dashboard regia** → card "MEDIA SERVER (MediaMTX)" → inserisci l'IP del droplet.
2. Gli URL SRT/RTMP di ogni camera si aggiornano automaticamente.

## 7. URL generati (per ogni camera)

| Uso | URL |
|---|---|
| Telefono → server (publish SRT) | `srt://TUO_IP:8890?streamid=publish:STREAM_KEY` |
| Telefono → server (fallback RTMP) | `rtmp://TUO_IP:1935/STREAM_KEY` |
| **OBS → Media Source** | `srt://TUO_IP:8890?streamid=read:STREAM_KEY` |
| Preview browser (HLS) | `http://TUO_IP:8888/STREAM_KEY/index.m3u8` |

## 8. Configura OBS

1. **Sorgenti → + → Sorgente multimediale (Media Source)**
2. Deseleziona "File locale"
3. In **Input** incolla l'URL SRT copiato dalla dashboard (pulsante "SRT per OBS")
4. Input Format: `mpegts` — Buffering: 2 MB
5. Ripeti per ogni camera (una Media Source per camera)

## Note

- Latenza SRT tipica: 1–2 s. Aggiungi `&latency=2000` all'URL per reti molto instabili.
- Banda: ~5 Mbps per camera in ingresso → 3 camere ≈ 15 Mbps (ok per DigitalOcean).
- Lo streaming SRT dal telefono richiede la **build nativa** dell'app (dopo il deploy con
  il pulsante Publish); in Expo Go l'app mostra l'anteprima camera locale.
