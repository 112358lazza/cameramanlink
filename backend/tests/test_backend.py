"""Backend tests for LiveCast Regia — REST + WebSocket flow."""
import asyncio
import json
import uuid

import pytest
import requests
import websockets


def _ws_url(http_url: str) -> str:
    return http_url.replace("https://", "wss://").replace("http://", "ws://")


@pytest.fixture(scope="module")
def created_event(base_url, api_client):
    """Create one event reused across tests in this module."""
    r = api_client.post(
        f"{base_url}/api/events",
        json={"name": f"TEST_Event_{uuid.uuid4().hex[:6]}", "num_cameras": 3},
    )
    assert r.status_code == 200, r.text
    ev = r.json()
    assert len(ev["code"]) == 6
    return ev


# ---------- Health / root ----------
class TestHealth:
    def test_root(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/")
        assert r.status_code == 200
        assert r.json().get("message") == "LiveCast Regia API"


# ---------- Event CRUD ----------
class TestEvents:
    def test_create_event(self, created_event):
        ev = created_event
        assert ev["num_cameras"] == 3
        assert len(ev["cameras"]) == 3
        for cam in ev["cameras"]:
            urls = cam["urls"]
            assert urls["publish_srt"].startswith("srt://")
            assert urls["read_srt"].startswith("srt://")
            assert urls["publish_rtmp"].startswith("rtmp://")
            assert urls["hls"].startswith("http://")
            assert cam["stream_key"] in urls["publish_srt"]

    def test_get_event_case_insensitive(self, base_url, api_client, created_event):
        code = created_event["code"]
        r = api_client.get(f"{base_url}/api/events/{code.lower()}")
        assert r.status_code == 200
        assert r.json()["code"] == code

    def test_get_event_404(self, base_url, api_client):
        r = api_client.get(f"{base_url}/api/events/ZZZZZZ")
        assert r.status_code == 404

    def test_patch_media_host_updates_urls(self, base_url, api_client, created_event):
        code = created_event["code"]
        new_host = "203.0.113.55"
        r = api_client.patch(
            f"{base_url}/api/events/{code}", json={"media_host": new_host}
        )
        assert r.status_code == 200
        data = r.json()
        assert data["media_host"] == new_host
        for cam in data["cameras"]:
            assert new_host in cam["urls"]["publish_srt"]
            assert new_host in cam["urls"]["hls"]

    def test_create_event_bounds(self, base_url, api_client):
        r = api_client.post(
            f"{base_url}/api/events", json={"name": "TEST_Bad", "num_cameras": 10}
        )
        assert r.status_code == 422


# ---------- Join ----------
class TestJoin:
    def test_join_and_rejoin(self, base_url, api_client, created_event):
        code = created_event["code"]
        name = f"TEST_Op_{uuid.uuid4().hex[:4]}"
        r1 = api_client.post(f"{base_url}/api/events/{code}/join", json={"name": name})
        assert r1.status_code == 200, r1.text
        j1 = r1.json()
        assert j1["cam_slot"] == 1
        assert j1["event_name"] == created_event["name"]
        # rejoin with same name -> same slot
        r2 = api_client.post(f"{base_url}/api/events/{code}/join", json={"name": name})
        assert r2.status_code == 200
        j2 = r2.json()
        assert j2["cam_slot"] == j1["cam_slot"]
        assert j2["id"] == j1["id"]

    def test_join_fills_and_rejects_when_full(self, base_url, api_client):
        # Fresh 2-cam event
        ev = api_client.post(
            f"{base_url}/api/events", json={"name": "TEST_Full", "num_cameras": 2}
        ).json()
        code = ev["code"]
        assert api_client.post(
            f"{base_url}/api/events/{code}/join", json={"name": "TEST_A"}
        ).status_code == 200
        assert api_client.post(
            f"{base_url}/api/events/{code}/join", json={"name": "TEST_B"}
        ).status_code == 200
        r = api_client.post(
            f"{base_url}/api/events/{code}/join", json={"name": "TEST_C"}
        )
        assert r.status_code == 409

    def test_join_empty_name(self, base_url, api_client, created_event):
        r = api_client.post(
            f"{base_url}/api/events/{created_event['code']}/join", json={"name": "  "}
        )
        assert r.status_code == 400


# ---------- Messages / logs REST ----------
class TestLogs:
    def test_get_logs(self, base_url, api_client, created_event):
        r = api_client.get(f"{base_url}/api/events/{created_event['code']}/logs")
        assert r.status_code == 200
        logs = r.json()
        assert isinstance(logs, list)
        assert any(l["kind"] == "event" for l in logs)

    def test_download_logs(self, base_url, created_event):
        r = requests.get(
            f"{base_url}/api/events/{created_event['code']}/logs/download"
        )
        assert r.status_code == 200
        assert "attachment" in r.headers.get("content-disposition", "").lower()
        assert created_event["code"] in r.text

    def test_messages_empty(self, base_url, api_client, created_event):
        r = api_client.get(f"{base_url}/api/events/{created_event['code']}/messages")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------- WebSocket ----------
class TestWebSocket:
    @pytest.mark.asyncio
    async def test_director_ws_and_chat_and_tally(self, base_url, api_client):
        # Fresh event + operator
        ev = api_client.post(
            f"{base_url}/api/events", json={"name": "TEST_WS", "num_cameras": 2}
        ).json()
        code = ev["code"]
        op = api_client.post(
            f"{base_url}/api/events/{code}/join", json={"name": "TEST_WSOp"}
        ).json()
        ws_base = _ws_url(base_url)

        async with websockets.connect(f"{ws_base}/api/ws/{code}/director") as d_ws, \
                websockets.connect(f"{ws_base}/api/ws/{code}/{op['id']}") as o_ws:
            # Drain initial presence/log messages briefly
            async def drain(ws, seconds=1.0):
                out = []
                end = asyncio.get_event_loop().time() + seconds
                while asyncio.get_event_loop().time() < end:
                    try:
                        msg = await asyncio.wait_for(ws.recv(), timeout=0.3)
                        out.append(json.loads(msg))
                    except asyncio.TimeoutError:
                        break
                return out

            initial_d = await drain(d_ws, 1.5)
            await drain(o_ws, 0.5)
            # Presence should include operator online
            presence_msgs = [m for m in initial_d if m.get("type") == "presence"]
            assert presence_msgs, "director should receive presence"
            latest = presence_msgs[-1]
            assert any(o["id"] == op["id"] and o["online"] for o in latest["operators"])

            # Ping/pong
            await d_ws.send(json.dumps({"type": "ping", "ts": 123}))
            pong = None
            for _ in range(5):
                m = json.loads(await asyncio.wait_for(d_ws.recv(), timeout=2))
                if m.get("type") == "pong":
                    pong = m
                    break
            assert pong and pong["ts"] == 123

            # Broadcast chat director -> op
            await d_ws.send(
                json.dumps({"type": "chat", "channel": "all", "text": "hello all"})
            )
            got_chat_on_op = False
            for _ in range(6):
                m = json.loads(await asyncio.wait_for(o_ws.recv(), timeout=2))
                if m.get("type") == "chat" and m["message"]["text"] == "hello all":
                    got_chat_on_op = True
                    break
            assert got_chat_on_op

            # Tally on-air
            await d_ws.send(
                json.dumps({"type": "tally", "operator_id": op["id"], "on_air": True})
            )
            saw_on_air = False
            for _ in range(8):
                m = json.loads(await asyncio.wait_for(d_ws.recv(), timeout=2))
                if m.get("type") == "presence":
                    if any(
                        o["id"] == op["id"] and o["on_air"]
                        for o in m["operators"]
                    ):
                        saw_on_air = True
                        break
            assert saw_on_air

            # Operator status -> director sees status
            await o_ws.send(
                json.dumps({"type": "status", "battery": 77, "bitrate": 2500, "streaming": True})
            )
            got_status = False
            for _ in range(8):
                m = json.loads(await asyncio.wait_for(d_ws.recv(), timeout=2))
                if m.get("type") == "status" and m.get("operator_id") == op["id"]:
                    assert m.get("battery") == 77
                    got_status = True
                    break
            assert got_status

        # After disconnect, messages should be persisted
        msgs = api_client.get(f"{base_url}/api/events/{code}/messages").json()
        assert any(msg["text"] == "hello all" for msg in msgs)

    @pytest.mark.asyncio
    async def test_ws_unknown_event_closes(self, base_url):
        ws_base = _ws_url(base_url)
        with pytest.raises(Exception):
            async with websockets.connect(
                f"{ws_base}/api/ws/ZZZZZZ/director", open_timeout=5
            ) as ws:
                await asyncio.wait_for(ws.recv(), timeout=3)
