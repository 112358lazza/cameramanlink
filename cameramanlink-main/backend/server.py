from fastapi import FastAPI, APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import PlainTextResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import logging
import random
import string
import uuid
from pathlib import Path
from pydantic import BaseModel, Field
from typing import Optional, List, Dict
from datetime import datetime, timezone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

MEDIA_HOST_DEFAULT = os.environ.get('MEDIA_SERVER_HOST', 'YOUR_DO_SERVER_IP')
SRT_PORT = os.environ.get('SRT_PORT', '8890')
RTMP_PORT = os.environ.get('RTMP_PORT', '1935')
HLS_PORT = os.environ.get('HLS_PORT', '8888')

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("livecast")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def gen_event_code():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))


def build_urls(media_host: str, stream_key: str):
    return {
        "publish_srt": f"srt://{media_host}:{SRT_PORT}?streamid=publish:{stream_key}",
        "read_srt": f"srt://{media_host}:{SRT_PORT}?streamid=read:{stream_key}",
        "publish_rtmp": f"rtmp://{media_host}:{RTMP_PORT}/{stream_key}",
        "hls": f"http://{media_host}:{HLS_PORT}/{stream_key}/index.m3u8",
    }


# ---------- Models ----------

class EventCreate(BaseModel):
    name: str
    num_cameras: int = Field(default=3, ge=1, le=6)
    media_host: Optional[str] = None


class EventPatch(BaseModel):
    media_host: str


class JoinRequest(BaseModel):
    name: str


# ---------- Helpers ----------

async def log_event(event_code: str, kind: str, message: str):
    entry = {
        "id": str(uuid.uuid4()),
        "event_code": event_code,
        "kind": kind,
        "message": message,
        "ts": now_iso(),
    }
    await db.logs.insert_one({**entry})
    return entry


async def get_event_or_404(code: str):
    ev = await db.events.find_one({"code": code.upper()}, {"_id": 0})
    if not ev:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    return ev


def event_with_urls(ev: dict):
    host = ev.get("media_host") or MEDIA_HOST_DEFAULT
    cameras = []
    for cam in ev["cameras"]:
        cameras.append({**cam, "urls": build_urls(host, cam["stream_key"])})
    return {**ev, "media_host": host, "cameras": cameras}


# ---------- REST ----------

@api_router.get("/")
async def root():
    return {"message": "LiveCast Regia API"}


@api_router.post("/events")
async def create_event(body: EventCreate):
    code = gen_event_code()
    while await db.events.find_one({"code": code}):
        code = gen_event_code()
    cameras = []
    for i in range(1, body.num_cameras + 1):
        cameras.append({
            "slot": i,
            "stream_key": f"{code.lower()}-cam{i}-{uuid.uuid4().hex[:6]}",
        })
    ev = {
        "id": str(uuid.uuid4()),
        "code": code,
        "name": body.name.strip(),
        "num_cameras": body.num_cameras,
        "media_host": (body.media_host or "").strip() or MEDIA_HOST_DEFAULT,
        "cameras": cameras,
        "created_at": now_iso(),
    }
    await db.events.insert_one({**ev})
    await log_event(code, "event", f"Evento '{ev['name']}' creato con {body.num_cameras} camere")
    return event_with_urls(ev)


@api_router.get("/events/{code}")
async def get_event(code: str):
    ev = await get_event_or_404(code)
    return event_with_urls(ev)


@api_router.patch("/events/{code}")
async def patch_event(code: str, body: EventPatch):
    ev = await get_event_or_404(code)
    await db.events.update_one({"code": ev["code"]}, {"$set": {"media_host": body.media_host.strip()}})
    ev["media_host"] = body.media_host.strip()
    await log_event(ev["code"], "event", f"Media server aggiornato: {body.media_host}")
    return event_with_urls(ev)


@api_router.post("/events/{code}/join")
async def join_event(code: str, body: JoinRequest):
    ev = await get_event_or_404(code)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nome operatore obbligatorio")
    # Reuse the slot if same operator name rejoins
    existing = await db.operators.find_one({"event_code": ev["code"], "name": name}, {"_id": 0})
    if existing:
        cam = next(c for c in ev["cameras"] if c["slot"] == existing["cam_slot"])
        host = ev.get("media_host") or MEDIA_HOST_DEFAULT
        return {**existing, "urls": build_urls(host, cam["stream_key"]), "event_name": ev["name"]}
    taken = await db.operators.distinct("cam_slot", {"event_code": ev["code"]})
    free = [c for c in ev["cameras"] if c["slot"] not in taken]
    if not free:
        raise HTTPException(status_code=409, detail="Evento al completo: tutti gli slot camera sono occupati")
    cam = free[0]
    op = {
        "id": str(uuid.uuid4()),
        "event_code": ev["code"],
        "name": name,
        "cam_slot": cam["slot"],
        "stream_key": cam["stream_key"],
        "online": False,
        "on_air": False,
        "streaming": False,
        "battery": None,
        "bitrate": 0,
        "ping": None,
        "joined_at": now_iso(),
    }
    await db.operators.insert_one({**op})
    await log_event(ev["code"], "join", f"{name} registrato come CAM{cam['slot']}")
    host = ev.get("media_host") or MEDIA_HOST_DEFAULT
    return {**op, "urls": build_urls(host, cam["stream_key"]), "event_name": ev["name"]}


@api_router.get("/events/{code}/operators")
async def list_operators(code: str):
    ev = await get_event_or_404(code)
    ops = await db.operators.find({"event_code": ev["code"]}, {"_id": 0}).to_list(50)
    return sorted(ops, key=lambda o: o["cam_slot"])


@api_router.get("/events/{code}/messages")
async def get_messages(code: str, channel: Optional[str] = None, for_operator: Optional[str] = None):
    ev = await get_event_or_404(code)
    query: dict = {"event_code": ev["code"]}
    if for_operator:
        query["channel"] = {"$in": ["all", for_operator]}
    elif channel:
        query["channel"] = channel
    msgs = await db.messages.find(query, {"_id": 0}).sort("ts", 1).to_list(500)
    return msgs


@api_router.get("/events/{code}/logs")
async def get_logs(code: str):
    ev = await get_event_or_404(code)
    logs = await db.logs.find({"event_code": ev["code"]}, {"_id": 0}).sort("ts", -1).to_list(1000)
    return logs


@api_router.get("/events/{code}/logs/download")
async def download_logs(code: str):
    ev = await get_event_or_404(code)
    logs = await db.logs.find({"event_code": ev["code"]}, {"_id": 0}).sort("ts", 1).to_list(5000)
    lines = [f"LOG EVENTO — {ev['name']} ({ev['code']})", "=" * 50]
    for l in logs:
        lines.append(f"[{l['ts']}] [{l['kind'].upper()}] {l['message']}")
    return PlainTextResponse(
        "\n".join(lines),
        headers={"Content-Disposition": f"attachment; filename=log_{ev['code']}.txt"},
    )


# ---------- WebSocket ----------

class ConnectionManager:
    def __init__(self):
        # event_code -> {client_id: websocket}
        self.rooms: Dict[str, Dict[str, WebSocket]] = {}

    async def connect(self, event_code: str, client_id: str, ws: WebSocket):
        await ws.accept()
        self.rooms.setdefault(event_code, {})[client_id] = ws

    def disconnect(self, event_code: str, client_id: str):
        room = self.rooms.get(event_code, {})
        room.pop(client_id, None)

    async def send_to(self, event_code: str, client_id: str, payload: dict):
        ws = self.rooms.get(event_code, {}).get(client_id)
        if ws:
            try:
                await ws.send_text(json.dumps(payload))
            except Exception:
                pass

    async def broadcast(self, event_code: str, payload: dict):
        for cid in list(self.rooms.get(event_code, {}).keys()):
            await self.send_to(event_code, cid, payload)


manager = ConnectionManager()


async def presence_snapshot(event_code: str):
    ops = await db.operators.find({"event_code": event_code}, {"_id": 0}).to_list(50)
    return {"type": "presence", "operators": sorted(ops, key=lambda o: o["cam_slot"])}


@api_router.websocket("/ws/{event_code}/{client_id}")
async def ws_endpoint(websocket: WebSocket, event_code: str, client_id: str):
    event_code = event_code.upper()
    ev = await db.events.find_one({"code": event_code}, {"_id": 0})
    if not ev:
        await websocket.close(code=4404)
        return
    is_director = client_id == "director"
    op = None
    if not is_director:
        op = await db.operators.find_one({"id": client_id}, {"_id": 0})
        if not op:
            await websocket.close(code=4404)
            return

    await manager.connect(event_code, client_id, websocket)

    if not is_director:
        await db.operators.update_one({"id": client_id}, {"$set": {"online": True}})
        entry = await log_event(event_code, "connect", f"{op['name']} (CAM{op['cam_slot']}) connesso")
        await manager.broadcast(event_code, {"type": "log", "entry": entry})
    else:
        entry = await log_event(event_code, "connect", "Regia connessa")
        await manager.broadcast(event_code, {"type": "log", "entry": entry})

    await manager.broadcast(event_code, await presence_snapshot(event_code))

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            mtype = data.get("type")

            if mtype == "ping":
                await manager.send_to(event_code, client_id, {"type": "pong", "ts": data.get("ts")})

            elif mtype == "chat":
                sender_name = "Regia" if is_director else op["name"]
                channel = data.get("channel", "all")
                msg = {
                    "id": str(uuid.uuid4()),
                    "event_code": event_code,
                    "sender": client_id,
                    "sender_name": sender_name,
                    "channel": channel,
                    "text": (data.get("text") or "").strip()[:500],
                    "preset": bool(data.get("preset")),
                    "ts": now_iso(),
                }
                if not msg["text"]:
                    continue
                await db.messages.insert_one({**msg})
                await log_event(event_code, "chat", f"{sender_name} → {'tutti' if channel == 'all' else 'privato'}: {msg['text']}")
                payload = {"type": "chat", "message": msg}
                if channel == "all":
                    await manager.broadcast(event_code, payload)
                else:
                    # 1-to-1 between director and one operator
                    await manager.send_to(event_code, "director", payload)
                    await manager.send_to(event_code, channel, payload)
                    if client_id not in ("director", channel):
                        await manager.send_to(event_code, client_id, payload)

            elif mtype == "tally" and is_director:
                target = data.get("operator_id")
                on_air = bool(data.get("on_air"))
                target_op = await db.operators.find_one({"id": target}, {"_id": 0})
                if not target_op:
                    continue
                if on_air:
                    # only one camera on air at a time
                    await db.operators.update_many({"event_code": event_code}, {"$set": {"on_air": False}})
                await db.operators.update_one({"id": target}, {"$set": {"on_air": on_air}})
                entry = await log_event(
                    event_code, "tally",
                    f"CAM{target_op['cam_slot']} ({target_op['name']}) {'IN ONDA' if on_air else 'fuori onda'}",
                )
                await manager.broadcast(event_code, {"type": "log", "entry": entry})
                await manager.broadcast(event_code, await presence_snapshot(event_code))

            elif mtype == "status" and not is_director:
                fields = {}
                for k in ("battery", "bitrate", "ping", "streaming"):
                    if k in data:
                        fields[k] = data[k]
                if fields:
                    prev = await db.operators.find_one({"id": client_id}, {"_id": 0})
                    await db.operators.update_one({"id": client_id}, {"$set": fields})
                    if "streaming" in fields and prev and prev.get("streaming") != fields["streaming"]:
                        verb = "ha avviato lo stream (GO LIVE)" if fields["streaming"] else "ha fermato lo stream"
                        entry = await log_event(event_code, "stream", f"{op['name']} (CAM{op['cam_slot']}) {verb}")
                        await manager.broadcast(event_code, {"type": "log", "entry": entry})
                    await manager.send_to(event_code, "director", {"type": "status", "operator_id": client_id, **fields})

    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(event_code, client_id)
        if not is_director:
            await db.operators.update_one({"id": client_id}, {"$set": {"online": False, "streaming": False}})
            entry = await log_event(event_code, "disconnect", f"{op['name']} (CAM{op['cam_slot']}) disconnesso")
        else:
            entry = await log_event(event_code, "disconnect", "Regia disconnessa")
        await manager.broadcast(event_code, {"type": "log", "entry": entry})
        await manager.broadcast(event_code, await presence_snapshot(event_code))


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
