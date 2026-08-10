#!/bin/bash
# Installazione e Configurazione Automatica LiveCast Regia (cameramanlink-main)
# Dominio: cameraman.gerikult.it
# Backend: FastAPI (Python) su porta 8001 + MongoDB + MediaMTX (SRT/RTMP/HLS)
# Frontend: Expo React Native Web servito da Nginx con HTTPS (SSL)

set -e

DOMAIN="${1:-cameraman.gerikult.it}"
APP_DIR="/opt/cameramanlink-main"

echo "========================================================"
echo " Inizio Installazione LiveCast Regia (Emergent App)"
echo " Dominio: https://$DOMAIN"
echo "========================================================"

# 1. Dipendenze di Sistema
echo "[1/8] Installazione pacchetti di sistema (Python, Nginx, Docker)..."
apt-get update -y
apt-get install -y curl git ufw nginx certbot python3-certbot-nginx python3-pip python3-venv

# Installazione Docker se mancante
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
fi

# Avvia MongoDB via Docker
echo "Avvio MongoDB in Docker..."
docker rm -f mongodb || true
docker run -d --name mongodb --restart unless-stopped -p 127.0.0.1:27017:27017 mongo:latest

# Installazione Node.js LTS se mancante
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
    apt-get install -y nodejs
fi

# 2. Setup MediaMTX (Media Server per SRT, RTMP, HLS)
echo "[2/8] Configurazione ed Esecuzione MediaMTX (Media Server)..."
mkdir -p /opt/mediamtx
cat > /opt/mediamtx/mediamtx.yml <<EOF
logLevel: info

srt: yes
srtAddress: :8890

rtmp: yes
rtmpAddress: :1935

hls: yes
hlsAddress: :8888
hlsAlwaysRemux: yes
hlsVariant: lowLatency

webrtc: yes
webrtcAddress: :8889

paths:
  all_others:
EOF

docker rm -f mediamtx || true
docker run -d \
  --name mediamtx \
  --restart unless-stopped \
  -p 8890:8890/udp \
  -p 1935:1935 \
  -p 8888:8888 \
  -p 8889:8889 \
  -v /opt/mediamtx/mediamtx.yml:/mediamtx.yml \
  bluenviron/mediamtx:latest

# 3. Setup Codice Sorgente
echo "[3/8] Sincronizzazione codice sorgente..."
if [ -d "$APP_DIR" ]; then
    cd $APP_DIR
    git fetch --all
    git reset --hard origin/main || true
else
    git clone https://github.com/112358lazza/cameramanlink.git /opt/cameramanlink-repo
    cp -r /opt/cameramanlink-repo/cameramanlink-main $APP_DIR
fi

# 4. Configurazione Backend FastAPI
echo "[4/8] Setup Backend Python FastAPI..."
cd $APP_DIR/backend

cat > .env <<EOF
MONGO_URL=mongodb://127.0.0.1:27017
DB_NAME=livecast
MEDIA_SERVER_HOST=$DOMAIN
SRT_PORT=8890
RTMP_PORT=1935
HLS_PORT=8888
EOF

python3 -m venv venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install fastapi uvicorn motor pymongo python-dotenv pydantic starlette requests httpx

# Servizio Systemd per Backend
cat > /etc/systemd/system/livecast-backend.service <<EOF
[Unit]
Description=LiveCast FastAPI Backend
After=network.target docker.service

[Service]
ExecStart=$APP_DIR/backend/venv/bin/uvicorn server:app --host 127.0.0.1 --port 8001
WorkingDirectory=$APP_DIR/backend
Restart=always
User=root
EnvironmentFile=$APP_DIR/backend/.env

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable livecast-backend
systemctl restart livecast-backend

# 5. Build Frontend Expo Web
echo "[5/8] Compilazione Frontend Expo Web..."
cd $APP_DIR/frontend

cat > .env <<EOF
EXPO_PUBLIC_BACKEND_URL=https://$DOMAIN
EOF

npm install --legacy-peer-deps || true
npx expo export --platform web || npm run web -- --output-dir dist || true

mkdir -p /var/www/cameramanlink-web
if [ -d "$APP_DIR/frontend/dist" ]; then
    cp -r $APP_DIR/frontend/dist/* /var/www/cameramanlink-web/
fi

# 6. Configurazione Nginx Reverse Proxy
echo "[6/8] Configurazione Nginx..."
cat > /etc/nginx/sites-available/cameramanlink <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    root /var/www/cameramanlink-web;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # API Backend & WebSockets
    location /api {
        proxy_pass http://127.0.0.1:8001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

ln -sf /etc/nginx/sites-available/cameramanlink /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# Certificato SSL HTTPS
echo "[7/8] Configurazione Certificato SSL (Let's Encrypt)..."
certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m admin@$DOMAIN --redirect || true

# 7. Firewall (UFW)
echo "[8/8] Configurazione Firewall..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 1935/tcp
ufw allow 8888/tcp
ufw allow 8889/tcp
ufw allow 8890/udp
ufw --force enable

echo "========================================================"
echo " LIVECAST REGIA PUBLICATO CON SUCCESSO!"
echo " Accedi all'App: https://$DOMAIN"
echo "========================================================"
