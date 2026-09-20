// Auto-generated — Colab backend source code
export const COLAB_CODE = `# ╔═══════════════════════════════════════════════════════════════════╗
# ║  AI IMAGE EDITOR — COLAB BACKEND                                 ║
# ║  FastAPI + Ollama (llava + hermes3:8b) + Cloudflare Tunnel       ║
# ║  Run করো → URL পাও → Vercel frontend এ paste করো               ║
# ╚═══════════════════════════════════════════════════════════════════╝
#
# 📌 HOW TO USE:
#   1. Google Colab এ এই পুরো code একটা cell এ paste করো
#   2. Runtime: T4 GPU
#   3. Run করো → https://xxxx.trycloudflare.com URL পাবে
#   4. Vercel website এ সেই URL paste করো → Image upload করো!
# ═══════════════════════════════════════════════════════════════════

import subprocess, time, threading, re, os, json, base64
from IPython.display import display, Javascript, HTML

# ── Anti-Disconnect ──
display(Javascript("""
    if(window._ka) clearInterval(window._ka);
    window._ka = setInterval(()=>{
        var b=document.querySelector("colab-toolbar-button#connect");
        if(b) b.click();
    }, 30000);
"""))
print("✅ Anti-Disconnect চালু!")

# ── GPU Check ──
try:
    r = subprocess.run(["nvidia-smi","--query-gpu=name","--format=csv,noheader"],
                       capture_output=True, text=True)
    print(f"🖥️ GPU: {r.stdout.strip() or 'CPU'}")
except: print("🖥️ CPU Mode")

# ── Install Packages ──
print("\\n⏳ [1/5] Packages install হচ্ছে...")
subprocess.run(["pip","install","-q","fastapi","uvicorn[standard]","python-multipart",
                "easyocr","opencv-python-headless","pillow","requests",
                "numpy","colorthief"], check=True)
subprocess.run(["apt-get","install","-y","-qq","libgl1-mesa-glx"], capture_output=True)
print("✅ Packages done!")

# ── Google Drive ──
print("\\n⏳ [2/5] Google Drive...")
try:
    from google.colab import drive
    drive.mount('/content/drive', force_remount=False)
    model_dir = "/content/drive/MyDrive/ollama_models"
    os.makedirs(model_dir, exist_ok=True)
    print("✅ Drive connected — models save হবে!")
except:
    model_dir = "/content/ollama_models"
    os.makedirs(model_dir, exist_ok=True)
    print("⚠️ Drive ছাড়া চলবে")

os.environ.update({
    "OLLAMA_MODELS": model_dir,
    "OLLAMA_HOST":   "0.0.0.0",
    "OLLAMA_FLASH_ATTENTION": "1",
    "CUDA_VISIBLE_DEVICES":   "0"
})
env = os.environ.copy()

# ── Ollama + Models ──
print("\\n⏳ [3/5] Ollama + Models লোড হচ্ছে...")
subprocess.run(["sh","-c","curl -fsSL https://ollama.com/install.sh | sh"], capture_output=True)
subprocess.Popen(["ollama","serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
time.sleep(8)
print("✅ Ollama server চালু!")

print("  ⏳ llava (Vision) লোড... (~4GB first time)")
subprocess.run(["ollama","pull","llava"], env=env)
print("  ✅ llava READY!")

print("  ⏳ hermes3:8b (Code Gen) লোড...")
subprocess.run(["ollama","pull","hermes3:8b"], env=env)
print("  ✅ hermes3:8b READY! (0% filter)")

# ── FastAPI Server ──
print("\\n⏳ [4/5] FastAPI Server তৈরি হচ্ছে...")

import cv2, numpy as np, easyocr, requests as req_lib
from PIL import Image as PILImage
from colorthief import ColorThief
from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn, io

OLLAMA_URL = "http://localhost:11434"
app = FastAPI(title="AI Image Editor Backend")

# ── CORS: Vercel থেকে request accept করবে ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # production এ Vercel URL দাও
    allow_methods=["*"],
    allow_headers=["*"],
)

def rgb_to_hex(rgb):
    return "#{:02x}{:02x}{:02x}".format(int(rgb[0]), int(rgb[1]), int(rgb[2]))

def ollama_vision(prompt, img_bytes, model="llava"):
    b64 = base64.b64encode(img_bytes).decode("utf-8")
    r = req_lib.post(f"{OLLAMA_URL}/api/generate",
        json={"model":model,"prompt":prompt,"images":[b64],"stream":False},
        timeout=180)
    return r.json().get("response","")

def ollama_chat(prompt, model="hermes3:8b", system=None):
    msgs = []
    if system: msgs.append({"role":"system","content":system})
    msgs.append({"role":"user","content":prompt})
    r = req_lib.post(f"{OLLAMA_URL}/api/chat",
        json={"model":model,"messages":msgs,"stream":False,
              "options":{"temperature":0.1,"num_ctx":8192}},
        timeout=300)
    return r.json().get("message",{}).get("content","")

# ── Health Check ──
@app.get("/")
def health():
    return {"status": "ok", "message": "AI Image Editor Backend চালু আছে! 🚀"}

@app.get("/ping")
def ping():
    return {"pong": True}

# ── Main API: Image → Editable HTML ──
@app.post("/analyze")
async def analyze_image(file: UploadFile = File(...)):
    try:
        img_bytes    = await file.read()
        filename     = file.filename or "image.png"
        content_type = file.content_type or "image/jpeg"

        # Load image
        nparr  = np.frombuffer(img_bytes, np.uint8)
        img_cv = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img_cv is None:
            return JSONResponse({"success":False,"error":"Invalid image"}, status_code=400)
        img_h, img_w = img_cv.shape[:2]

        # ── Color Extraction ──
        tmp_path = "/tmp/upload_img.jpg"
        cv2.imwrite(tmp_path, img_cv)
        ct             = ColorThief(tmp_path)
        dominant_color = ct.get_color(quality=1)
        palette        = ct.get_palette(color_count=8, quality=1)
        dominant_hex   = rgb_to_hex(dominant_color)
        palette_hex    = [rgb_to_hex(c) for c in palette]

        # ── OCR ──
        reader      = easyocr.Reader(['en','bn'], gpu=True)
        ocr_results = reader.readtext(tmp_path, detail=1)
        texts = []
        for (bbox, text, confidence) in ocr_results:
            if confidence < 0.3 or not text.strip(): continue
            pts   = np.array(bbox, dtype=np.int32)
            x_min = int(pts[:,0].min()); y_min = int(pts[:,1].min())
            x_max = int(pts[:,0].max()); y_max = int(pts[:,1].max())
            region = img_cv[y_min:y_max, x_min:x_max]
            if region.size > 0:
                avg  = region.mean(axis=(0,1))
                tcol = rgb_to_hex((255-avg[2],255-avg[1],255-avg[0]))
            else:
                tcol = "#000000"
            texts.append({
                "id":         f"txt_{len(texts)+1}",
                "text":       text,
                "confidence": round(confidence,3),
                "left":       round(x_min/img_w*100,2),
                "top":        round(y_min/img_h*100,2),
                "width":      round((x_max-x_min)/img_w*100,2),
                "height":     round((y_max-y_min)/img_h*100,2),
                "font_size":  max(8, int((y_max-y_min)*0.72)),
                "color":      tcol
            })

        # ── Vision AI (llava) ──
        vision_desc = ollama_vision(
            """Analyze this design image for HTML/CSS recreation:
1. Background (exact colors, gradient, pattern)
2. Layout and sections
3. Typography style and weights
4. Visual hierarchy
5. Decorative elements
6. Color scheme
7. Overall design style
Be technical and specific.""",
            img_bytes
        )

        # ── HTML Generation (hermes3:8b) ──
        ocr_json = json.dumps(texts, ensure_ascii=False)
        gen_html = ollama_chat(
            system="""Expert HTML/CSS developer. Create pixel-perfect replicas.
Output ONLY raw HTML starting with <!DOCTYPE html>. No markdown.""",
            prompt=f"""Recreate this design as a complete HTML file.
CANVAS: {img_w}x{img_h}px
DOMINANT: {dominant_hex}
PALETTE: {', '.join(palette_hex)}

VISION ANALYSIS:
{vision_desc}

OCR TEXTS (% positions):
{ocr_json}

RULES:
- .canvas: position:relative;width:100%;max-width:{img_w}px;margin:0 auto;padding-bottom:{round(img_h/img_w*100,2)}%;overflow:hidden;
- .content: position:absolute;top:0;left:0;right:0;bottom:0;
- Each text: position:absolute;left:[left]%;top:[top]%;font-size:[font_size]px;id="[id]";data-editable="true"
- Match background/colors from vision analysis
- Google Fonts: Inter + Noto Sans Bengali
Output complete HTML:"""
        )

        # Clean fences
        for fence in ["``````html","``````HTML","``````"]:
            if fence in gen_html:
                parts = gen_html.split(fence)
                if len(parts)>1: gen_html = parts[1].split("``````")[0].strip()
                break

        # Base64 of original image (for reference overlay in editor)
        img_b64     = base64.b64encode(img_bytes).decode("utf-8")
        img_ext     = filename.split(".")[-1].lower().replace("jpg","jpeg")
        img_data_url = f"data:image/{img_ext};base64,{img_b64}"

        return JSONResponse({
            "success":      True,
            "filename":     filename,
            "width":        img_w,
            "height":       img_h,
            "dominantColor":dominant_hex,
            "palette":      palette_hex,
            "texts":        texts,
            "generatedHTML":gen_html,
            "imageDataUrl": img_data_url,
        })

    except Exception as e:
        import traceback
        return JSONResponse({"success":False,"error":str(e),"trace":traceback.format_exc()}, status_code=500)

# ── Start FastAPI in background thread ──
def run_server():
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="error")

print("✅ FastAPI Server code ready!")

# ── Cloudflare Tunnel ──
print("\\n⏳ [5/5] Cloudflare Tunnel তৈরি হচ্ছে...")
subprocess.run(["wget","-q","-nc",
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb"],
    capture_output=True)
subprocess.run(["dpkg","-i","cloudflared-linux-amd64.deb"], capture_output=True)
print("✅ Cloudflare ready!")

# ── Start everything ──
tunnel_url  = None
tunnel_proc = None

def start_tunnel():
    global tunnel_url, tunnel_proc
    tunnel_proc = subprocess.Popen(
        ["cloudflared","tunnel","--url","http://localhost:8000"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT
    )
    for line in tunnel_proc.stdout:
        line = line.decode("utf-8","ignore").strip()
        m = re.search(r"https://[a-zA-Z0-9\\-]+\\.trycloudflare\\.com", line)
        if m:
            tunnel_url = m.group(0)
            break

def watchdog():
    while True:
        time.sleep(30)
        if tunnel_proc and tunnel_proc.poll() is not None:
            threading.Thread(target=start_tunnel, daemon=True).start()

# Start FastAPI
threading.Thread(target=run_server, daemon=True).start()
time.sleep(3)

# Start tunnel
threading.Thread(target=start_tunnel, daemon=True).start()
threading.Thread(target=watchdog,    daemon=True).start()

# Wait for URL
t = 0
while tunnel_url is None and t < 90:
    time.sleep(2); t += 2
    print(f"  ⏳ URL পাচ্ছি... ({t}s)")

if tunnel_url is None:
    print("❌ Tunnel URL পাওয়া যায়নি। আবার run করুন।")
else:
    # ── FINAL OUTPUT ──
    display(HTML(f"""
    <div style="font-family:Inter,sans-serif;margin:10px 0">
      <div style="background:linear-gradient(135deg,#6c63ff,#a855f7);padding:16px 20px;border-radius:12px 12px 0 0;color:white">
        <h2 style="margin:0 0 4px;font-size:1.1rem">🔥 Backend READY!</h2>
        <p style="margin:0;font-size:.82rem;opacity:.85">Vercel frontend এ এই URL paste করুন</p>
      </div>
      <div style="background:#13132b;padding:16px 20px;border-radius:0 0 12px 12px;border:1px solid #2a2a4a">
        <p style="color:#94a3b8;font-size:.75rem;margin:0 0 6px;text-transform:uppercase;letter-spacing:.05em">Backend URL:</p>
        <code style="background:#090920;color:#a5f3fc;padding:10px 14px;border-radius:8px;font-size:.9rem;display:block;word-break:break-all;border:1px solid #1e3a5f">
          {tunnel_url}
        </code>
        <p style="color:#94a3b8;font-size:.75rem;margin:10px 0 4px">Test করুন:</p>
        <code style="background:#090920;color:#86efac;padding:8px 14px;border-radius:8px;font-size:.8rem;display:block;border:1px solid #14532d">
          {tunnel_url}/ping → {{"pong": true}}
        </code>
      </div>
    </div>
    """))

    print(f"\\n{'='*60}")
    print(f"✅ BACKEND URL: {tunnel_url}")
    print(f"✅ TEST:        {tunnel_url}/ping")
    print(f"{'='*60}")
    print(f"\\n📌 Vercel site এ এই URL paste করুন → Image upload করুন!")

    # Keep alive
    c = 0
    while True:
        time.sleep(60); c += 1
        print(f"💓 [{c}min] Backend Active | {tunnel_url}")
`;