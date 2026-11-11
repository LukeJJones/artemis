"""Static conversation UI on the public plugin router; Hermes owns auth/RPC."""
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

router = APIRouter()
ASSETS = Path(__file__).parent / "assets"
HEADERS = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
           "Referrer-Policy": "no-referrer"}
FILES = {"chat.css": "text/css", "app.mjs": "text/javascript", "routing.mjs": "text/javascript", "gateway.mjs": "text/javascript",
         "conversation.mjs": "text/javascript", "signin.mjs": "text/javascript", "appearance.js": "text/javascript",
         "appearance-controls.mjs": "text/javascript", "view-state.mjs": "text/javascript", "artemis.png": "image/png",
         "Manrope-variable.ttf": "font/ttf", "CaesarDressing-Regular.ttf": "font/ttf",
         "Manrope-OFL.txt": "text/plain", "CaesarDressing-OFL.txt": "text/plain"}


@router.get("/ui")
def ui():
    return HTMLResponse((ASSETS / "index.html").read_text(encoding="utf-8"), headers={**HEADERS,
        "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; "
        "font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; object-src 'none'; "
        "frame-ancestors 'none'; form-action 'self'"})


@router.get("/assets/{name}")
def asset(name: str):
    if name not in FILES:
        raise HTTPException(404, "Not found")
    return FileResponse(ASSETS / name, media_type=FILES[name], headers=HEADERS)


@router.get("/connection")
def connection():
    # Identity comes from authenticated host roster/runtime metadata, not labels
    # or filesystem configuration. This is not an authorization reduction.
    return JSONResponse({"protocol": "artemis-owner-routing-v1", "authority": "owner"},
                        headers=HEADERS)


@router.post("/probe")
def probe():
    return JSONResponse({"scope": "owner-hosting-proof", "message_sent": False},
                        headers={"Cache-Control": "no-store"})
