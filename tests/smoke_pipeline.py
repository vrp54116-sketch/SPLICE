"""Manual smoke: upload fixture → configure → process → verify job/clips."""
import base64, hashlib, json, sys, time, urllib.request

BASE = "http://localhost:3001"

def api(path, data=None, method=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(BASE + path, data=body, method=method or ("POST" if body else "GET"),
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())

fixture = sys.argv[1] if len(sys.argv) > 1 else "/tmp/splice-test.mp4"
raw = open(fixture, "rb").read()
h = hashlib.sha256(raw).hexdigest()
u = api("/api/upload/init", {"name": "smoke.mp4", "size": len(raw), "hash": h})
CH = 8 * 1024 * 1024
for i in range((len(raw) + CH - 1) // CH):
    chunk = raw[i * CH:(i + 1) * CH]
    api("/api/upload/chunk", {"id": u["id"], "index": i, "hash": hashlib.sha256(chunk).hexdigest(),
                              "chunk": base64.b64encode(chunk).decode()})
done = api("/api/upload/complete", {"id": u["id"]})
print("upload:", done)

cfg = {
  "source": {"kind": "upload", "ref": u["id"], "filename": "smoke.mp4"},
  "attestation": "owned",
  "clipType": "viral", "clipCount": 1, "duration": "short", "aspect": "9:16",
  "language": "auto", "timeframe": {"start": 0, "end": 60},
  "captions": True, "captionStyle": "classic", "autoHook": True, "hookTone": "bold",
  "reframe": "center", "music": False, "musicMood": "lofi", "musicVolume": 0.2,
  "splitScreen": False, "backgrounds": [], "splitRatio": 0.55,
  "rightsPolicy": "balanced", "resolution": 480, "filenameTemplate": "splice-{rank}"
}
job = api("/api/projects", {"config": cfg})
print("job:", job)
jid = job["jobId"]
for _ in range(180):
    s = api("/api/jobs/" + jid)
    print(s["phase"], s["pct"], s["message"])
    if s["phase"] in ("ready", "error", "canceled"):
        print("FINAL:", json.dumps(s, indent=2)[:4000])
        break
    time.sleep(2)
else:
    print("TIMEOUT")
