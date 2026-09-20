"use client";
import { useState, useRef, useCallback, useEffect } from "react";

const STORAGE_KEY = "colabBackendUrl";

export default function Home() {
  // ── Engine & Connection State ──
  const [engine,     setEngine]     = useState("gemini"); // 'gemini' | 'colab'
  const [geminiKey,  setGeminiKey]  = useState("");
  const [keyStatus,  setKeyStatus]  = useState("idle"); // idle | validating | ok | error
  const [keyError,   setKeyError]   = useState("");
  const [backendUrl, setBackendUrl] = useState("");
  const [urlStatus,  setUrlStatus]  = useState("idle"); // idle | checking | ok | error
  const [file,       setFile]       = useState(null);
  const [preview,    setPreview]    = useState(null);
  const [dragging,   setDragging]   = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");
  const [copiedCode, setCopiedCode] = useState(false);

  // ── Live Progress Stream Logs ──
  const [logs,       setLogs]       = useState([]);
  const [elapsed,    setElapsed]    = useState(0);

  // ── Result & Figma Studio State ──
  const [studioReady, setStudioReady] = useState(false);
  const [texts,       setTexts]       = useState([]);
  const [genHTML,     setGenHTML]     = useState("");
  const [filename,    setFilename]    = useState("design");
  const [imgSrc,      setImgSrc]      = useState("");
  const [canvasW,     setCanvasW]     = useState(1000);
  const [canvasH,     setCanvasH]     = useState(1400);
  const [dominantColor,setDominantColor] = useState("#ffffff");
  const [palette,     setPalette]     = useState([]);
  const [curTexts,    setCurTexts]    = useState({});
  const [selectedId,  setSelectedId]  = useState(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Figma Canvas View Modes: 'side-by-side' | 'split-slider' | 'overlay' | 'clone-only'
  const [viewMode,    setViewMode]    = useState("side-by-side");
  const [sliderPos,   setSliderPos]   = useState(50);
  const [overlayOpacity, setOverlayOpacity] = useState(50);
  const [zoom,        setZoom]        = useState(100);
  const [isCopied,    setIsCopied]    = useState(false);

  const inputRef    = useRef(null);
  const frameRef    = useRef(null);
  const splitRef    = useRef(null);
  const isDragging  = useRef(false);

  // ── Validate Gemini API Key with Google ──
  const validateGeminiKey = async (keyToTest) => {
    const k = (keyToTest || geminiKey).trim();
    if (!k) {
      setKeyError("API Key দিন");
      setKeyStatus("error");
      localStorage.removeItem("geminiApiKey");
      return;
    }
    setKeyStatus("validating");
    setKeyError("");
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${k}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.models && data.models.length > 0) {
          setKeyStatus("ok");
          setGeminiKey(k);
          localStorage.setItem("geminiApiKey", k);
          setKeyError("");
        } else {
          setKeyStatus("error");
          setKeyError("এই Key-তে কোনো মডেল পাওয়া যায়নি।");
          localStorage.removeItem("geminiApiKey");
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setKeyStatus("error");
        setKeyError(errData.error?.message || "ভুল API Key! অনুগ্রহ করে সঠিক Key দিন।");
        localStorage.removeItem("geminiApiKey");
      }
    } catch (e) {
      setKeyStatus("error");
      setKeyError("ভ্যালিডেশন ব্যর্থ হয়েছে। ইন্টারনেট সংযোগ চেক করুন।");
    }
  };

  // Restore saved Backend URL & Gemini Key
  useEffect(() => {
    const savedKey = localStorage.getItem("geminiApiKey");
    if (savedKey) {
      setGeminiKey(savedKey);
      validateGeminiKey(savedKey);
    }

    const savedUrl = localStorage.getItem(STORAGE_KEY);
    if (savedUrl) {
      setBackendUrl(savedUrl);
      testConnection(savedUrl);
    }
  }, []);


  // ── Copy Colab Code from JSON ──
  const copyColabCode = async () => {
    try {
      const res = await fetch("/colabCode.json");
      const data = await res.json();
      await navigator.clipboard.writeText(data.code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 3000);
    } catch {
      alert("Colab code copy failed. Please refresh and try again.");
    }
  };

  // ── Test Backend Ping ──
  const testConnection = async (url) => {
    const cleanUrl = (url || backendUrl).trim().replace(/\/$/, "");
    if (!cleanUrl) return;
    setUrlStatus("checking");
    setError("");
    try {
      const r = await fetch(`${cleanUrl}/ping`, {
        signal: AbortSignal.timeout(10000),
      });
      const d = await r.json();
      if (d.pong) {
        setUrlStatus("ok");
        localStorage.setItem(STORAGE_KEY, cleanUrl);
        setBackendUrl(cleanUrl);
      } else {
        setUrlStatus("error");
      }
    } catch {
      setUrlStatus("error");
    }
  };

  // ── File Drop & Select ──
  const handleFile = (f) => {
    if (!f?.type.startsWith("image/")) {
      setError("শুধু ইমেজ ফাইল দিন (JPG, PNG, WEBP)");
      return;
    }
    if (f.size > 25 * 1024 * 1024) {
      setError("ফাইল ২৫MB এর নিচে হতে হবে");
      return;
    }
    setError("");
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setStudioReady(false);
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }, []);

  // ── Timer for Live Progress ──
  useEffect(() => {
    let timer;
    if (loading) {
      setElapsed(0);
      timer = setInterval(() => setElapsed(s => s + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [loading]);

  const addLog = (msg, icon = "⚡") => {
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), msg, icon }]);
  };

  // ── ANALYZE IMAGE (DIRECT BROWSER-TO-COLAB FETCH) ──
  const startAnalyze = async () => {
    if (!file) return;
    if (engine === "gemini" && keyStatus !== "ok") {
      setError("অনুগ্রহ করে প্রথমে আপনার Gemini API Key টি Validate করুন।");
      return;
    }
    if (engine === "colab" && urlStatus !== "ok") {
      setError("Colab ব্যাকএন্ড কানেক্টেড নয়। Colab URL ভ্যালিডেট করুন।");
      return;
    }

    setLoading(true);
    setError("");
    setLogs([]);
    setStudioReady(false);

    try {
      addLog("ইমেজ Base64 এনকোড করা হচ্ছে...", "📸");
      const toBase64 = (f) => new Promise((res, rej) => {
        const r = new FileReader();
        r.readAsDataURL(f);
        r.onload = () => res(r.result);
        r.onerror = (e) => rej(e);
      });

      const base64Data = await toBase64(file);
      let response;

      if (engine === "gemini") {
        addLog("Google Gemini 1.5 Flash Vision API এ পাঠানো হচ্ছে...", "⚡");
        addLog("সেফটি ফিল্টার সম্পূর্ণ বন্ধ (BLOCK_NONE) সক্রিয়...", "🛡️");
        const step1 = setTimeout(() => addLog("OCR, টেক্সট বাউন্ডিং বক্স ও ডকুমেন্ট স্ট্রাকচার ডিকোড হচ্ছে...", "🔍"), 1500);
        const step2 = setTimeout(() => addLog("পিক্সেল-একুরেট রেসপন্সিভ HTML/CSS তৈরি হচ্ছে...", "💻"), 2800);

        response = await fetch("/api/gemini", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: base64Data,
            apiKey: geminiKey.trim(),
          }),
        });

        clearTimeout(step1);
        clearTimeout(step2);
      } else {
        addLog("Colab GPU ব্যাকএন্ডে ইমেজ পাঠানো হচ্ছে...", "🚀");
        const step1 = setTimeout(() => addLog("কালার প্যালেট ও ডমিন্যান্ট ব্যাকগ্রাউন্ড নির্ণয় হচ্ছে...", "🎨"), 3000);
        const step2 = setTimeout(() => addLog("EasyOCR টেক্সট ও পিক্সেল বাউন্ডিং বক্স খুঁজছে...", "🔍"), 8000);
        const step3 = setTimeout(() => addLog("Vision AI ভিজ্যুয়াল লেআউট বিশ্লেষণ করছে...", "👁️"), 15000);
        const step4 = setTimeout(() => addLog("পিক্সেল-একুরেট রেসপন্সিভ HTML/CSS জেনারেট হচ্ছে...", "💻"), 25000);

        response = await fetch(`${backendUrl}/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            image: base64Data,
            filename: file.name
          }),
        });

        clearTimeout(step1);
        clearTimeout(step2);
        clearTimeout(step3);
        clearTimeout(step4);
      }

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Server returned HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!data.success && data.status !== "success") {
        throw new Error(data.error || "Processing failed");
      }

      addLog(`সফল! ${data.texts?.length || 0} টি টেক্সট এলিমেন্ট পাওয়া গেছে।`, "✅");
      addLog("Figma Studio Workspace রেন্ডার হচ্ছে...", "🎉");

      // Initialize Studio Data
      setTexts(data.texts || []);
      setGenHTML(data.generatedHTML || data.generated_html || data.html || "");
      setFilename(data.filename || file.name);
      setImgSrc(data.imageDataUrl || base64Data);
      setCanvasW(data.width || data.canvas?.width || 1000);
      setCanvasH(data.height || data.canvas?.height || 1400);
      setDominantColor(data.dominantColor || data.colors?.dominant || "#ffffff");
      setPalette(data.palette || data.colors?.palette || []);

      const initialTexts = {};
      (data.texts || []).forEach(t => { initialTexts[t.id] = t.text; });
      setCurTexts(initialTexts);
      if (data.texts && data.texts.length > 0) {
        setSelectedId(data.texts[0].id);
      }

      setStudioReady(true);
      setLoading(false);

    } catch (err) {
      console.error(err);
      let msg = err.message || "";
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        msg = "কানেকশন এরর: সার্ভারে কানেক্ট হতে পারছে না। আপনার ইন্টারনেট বা Colab রানিং আছে কিনা চেক করুন।";
      }
      addLog(`ত্রুটি: ${msg}`, "❌");
      setError(msg);
      setLoading(false);
    }
  };

  // ── Build Current Dynamic HTML ──
  const buildCurrentHTML = () => {
    if (!genHTML) return "";
    let html = genHTML;
    texts.forEach(t => {
      const val = (curTexts[t.id] ?? t.text)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      html = html.replace(
        new RegExp(`(id=["'](?:el-)?${t.id}["'][^>]*>)[^<]*`, "g"),
        (_, tag) => tag + val
      );
    });
    return html;
  };

  // ── Update Iframe on Edit ──
  useEffect(() => {
    if (!studioReady || !genHTML || !frameRef.current) return;
    const doc = frameRef.current.contentDocument || frameRef.current.contentWindow.document;
    doc.open();
    doc.write(buildCurrentHTML());
    doc.close();

    const handleFrameClick = () => {
      try {
        texts.forEach(t => {
          const el = doc.getElementById(t.id) || doc.getElementById("el-" + t.id);
          if (el) {
            el.style.outline = selectedId === t.id ? "2px solid #8b5cf6" : "none";
            el.onclick = (e) => {
              e.stopPropagation();
              setSelectedId(t.id);
            };
          }
        });
      } catch {}
    };

    const timer = setTimeout(handleFrameClick, 300);
    return () => clearTimeout(timer);
  }, [curTexts, genHTML, texts, selectedId, studioReady]);

  // ── Split Slider Handlers ──
  const handleMouseDown = () => { isDragging.current = true; };
  const handleMouseUp   = () => { isDragging.current = false; };
  const handleMouseMove = (e) => {
    if (!isDragging.current || !splitRef.current) return;
    const rect = splitRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    setSliderPos(Math.round((x / rect.width) * 100));
  };

  useEffect(() => {
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  const updateText = (id, val) => {
    setCurTexts(prev => ({ ...prev, [id]: val }));
  };

  // ── Exports ──
  const downloadHTML = () => {
    const blob = new Blob([buildCurrentHTML()], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pixel_clone_${filename}.html`;
    a.click();
  };

  const copyCodeToClipboard = () => {
    navigator.clipboard.writeText(buildCurrentHTML());
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2500);
  };

  const downloadPNG = () => {
    const fr = frameRef.current;
    if (!fr) return;
    const s = fr.contentDocument.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    s.onload = () => {
      fr.contentWindow.html2canvas(fr.contentDocument.body, { scale: 2 }).then(canvas => {
        const a = document.createElement("a");
        a.download = `pixel_clone_${filename}.png`;
        a.href = canvas.toDataURL("image/png");
        a.click();
      });
    };
    fr.contentDocument.head.appendChild(s);
  };

  const selectedItem = texts.find(t => t.id === selectedId);
  const filteredTexts = texts.filter(t =>
    (curTexts[t.id] ?? t.text).toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <main className="min-h-screen bg-[#0d0e15] text-[#e0e0e0] font-sans flex flex-col">

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 1. TOP HEADER (BRAND & STATUS)                                          */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <header className="h-14 bg-[#141622] border-b border-[#222538] px-5 flex items-center justify-between flex-shrink-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-violet-600 to-fuchsia-600 flex items-center justify-center font-black text-white text-sm shadow-md shadow-violet-500/30">
            AI
          </div>
          <div>
            <h1 className="font-bold text-sm text-white flex items-center gap-2">
              PhotoToCode <span className="text-[10px] bg-violet-900/60 text-violet-300 border border-violet-500/30 px-2 py-0.5 rounded font-mono">Figma Studio v2</span>
            </h1>
            <p className="text-[11px] text-slate-400">100% Uncensored · Pixel-by-Pixel Clone · Free T4 GPU</p>
          </div>
        </div>

        {/* Backend Status Pill */}
        <div className="flex items-center gap-2 text-xs">
          {engine === "gemini" ? (
            <>
              <span className={`w-2.5 h-2.5 rounded-full ${keyStatus === "ok" ? "bg-emerald-500 animate-pulse" : keyStatus === "error" ? "bg-red-500" : "bg-amber-400"}`} />
              <span className="font-mono text-slate-300">
                {keyStatus === "ok" ? "Gemini 1.5 Flash: Validated & Ready ✅" : "Gemini API Key Validate করুন 🔑"}
              </span>
            </>
          ) : (
            <>
              <span className={`w-2.5 h-2.5 rounded-full ${urlStatus === "ok" ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
              <span className="font-mono text-slate-300">
                {urlStatus === "ok" ? "Colab Backend: Connected ✅" : "Colab Disconnected ❌"}
              </span>
            </>
          )}
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 2. SETUP & UPLOAD BAR (DUAL ENGINE: GEMINI 1.5 & COLAB)                 */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-[#11131c] border-b border-[#1f2233] p-4">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-4">
          
          {/* Box 1: Engine Switcher */}
          <div className="bg-[#171926] p-3.5 rounded-xl border border-[#25293d] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <span>1.</span> AI Engine
                </span>
                <span className="text-[10px] bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 px-1.5 py-0.5 rounded font-mono">
                  BLOCK_NONE 0% Filter
                </span>
              </div>

              {/* Engine Tabs */}
              <div className="grid grid-cols-2 gap-1 bg-[#0f111a] p-1 rounded-lg border border-[#23273a] mb-2">
                <button
                  onClick={() => setEngine("gemini")}
                  className={`py-1.5 text-[11px] rounded-md font-bold transition-all ${engine === "gemini" ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow" : "text-slate-400 hover:text-slate-200"}`}
                >
                  ✨ Google Gemini
                </button>
                <button
                  onClick={() => setEngine("colab")}
                  className={`py-1.5 text-[11px] rounded-md font-bold transition-all ${engine === "colab" ? "bg-violet-600 text-white shadow" : "text-slate-400 hover:text-slate-200"}`}
                >
                  ⚡ Google Colab
                </button>
              </div>
            </div>

            {engine === "gemini" ? (
              <div className="flex items-center justify-between mt-1 text-[11px]">
                <span className="text-slate-400">প্রতিদিন ১,৫০০টি ইমেজ সম্পূর্ণ ফ্রি</span>
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-amber-400 hover:text-amber-300 underline font-semibold flex items-center gap-1"
                >
                  ফ্রি Key নিন ↗
                </a>
              </div>
            ) : (
              <div className="flex gap-1.5 mt-1">
                <button
                  onClick={copyColabCode}
                  className="flex-1 py-1.5 bg-[#222538] hover:bg-[#2c3049] text-[11px] font-bold text-violet-300 rounded-lg border border-violet-500/20 transition-all"
                >
                  {copiedCode ? "✅ Copied!" : "📋 Copy Colab Code"}
                </button>
                <a
                  href="https://colab.research.google.com"
                  target="_blank"
                  rel="noreferrer"
                  className="px-2.5 py-1.5 bg-[#1b1e2c] hover:bg-[#23273a] text-[11px] text-violet-400 rounded-lg border border-violet-500/20 flex items-center"
                >
                  Open Colab ↗
                </a>
              </div>
            )}
          </div>

          {/* Box 2: Key or URL Input */}
          <div className="bg-[#171926] p-3.5 rounded-xl border border-[#25293d] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <span>2.</span> {engine === "gemini" ? "Google AI Studio API Key" : "Colab Cloudflare URL"}
                </span>
                {engine === "gemini" && keyStatus === "ok" && (
                  <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                    ✓ Validated
                  </span>
                )}
                {engine === "colab" && urlStatus === "ok" && (
                  <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                    ✓ Connected
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                {engine === "gemini"
                  ? "Key পেস্ট করে 'Validate' চাপুন (ভ্যালিড হলে সেভ হবে)"
                  : "Colab থেকে পাওয়া পাবলিক URL টি দিন"}
              </p>
            </div>

            <div className="flex gap-1.5 mt-2.5">
              {engine === "gemini" ? (
                <>
                  <input
                    type="password"
                    value={geminiKey}
                    onChange={(e) => {
                      setGeminiKey(e.target.value);
                      setKeyStatus("idle");
                      setKeyError("");
                    }}
                    onKeyDown={(e) => e.key === "Enter" && validateGeminiKey()}
                    placeholder="AIzaSy... (Paste Gemini Key)"
                    className={`flex-1 px-2.5 py-1.5 bg-[#0b0c12] border rounded-lg text-white text-xs font-mono focus:outline-none transition-colors
                      ${keyStatus === "ok" ? "border-emerald-500/60" : keyStatus === "error" ? "border-red-500/60" : "border-[#2c3049] focus:border-violet-500"}`}
                  />
                  <button
                    onClick={() => validateGeminiKey()}
                    disabled={!geminiKey.trim() || keyStatus === "validating"}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap
                      ${keyStatus === "ok"
                        ? "bg-emerald-600/30 text-emerald-300 border border-emerald-500/40"
                        : keyStatus === "validating"
                        ? "bg-yellow-500/20 text-yellow-400 animate-pulse"
                        : "bg-violet-600 hover:bg-violet-500 text-white"}`}
                  >
                    {keyStatus === "validating" ? "..." : keyStatus === "ok" ? "Validated ✓" : "Validate"}
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    value={backendUrl}
                    onChange={(e) => { setBackendUrl(e.target.value); setUrlStatus("idle"); }}
                    onKeyDown={(e) => e.key === "Enter" && testConnection()}
                    placeholder="https://xxxx.trycloudflare.com"
                    className="flex-1 px-2.5 py-1.5 bg-[#0b0c12] border border-[#2c3049] rounded-lg text-white text-xs font-mono focus:outline-none focus:border-violet-500"
                  />
                  <button
                    onClick={() => testConnection()}
                    disabled={!backendUrl || urlStatus === "checking"}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all
                      ${urlStatus === "checking" ? "bg-yellow-500/20 text-yellow-400 animate-pulse" : "bg-violet-600 hover:bg-violet-500 text-white"}`}
                  >
                    {urlStatus === "checking" ? "..." : "Validate"}
                  </button>
                </>
              )}
            </div>

            {engine === "gemini" && keyError && (
              <p className="text-[10px] text-red-400 mt-1.5 font-medium">✕ {keyError}</p>
            )}
          </div>

          {/* Box 3: Image Upload & Action */}
          <div className="bg-[#171926] p-3.5 rounded-xl border border-[#25293d] flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <span>3.</span> Upload &amp; Convert
              </span>
              {file && <span className="text-[10px] text-emerald-400 truncate max-w-[120px]">{file.name}</span>}
            </div>

            <div className="flex gap-2 mt-2.5">
              <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFile(e.target.files[0])} />
              <button
                onClick={() => inputRef.current?.click()}
                className="flex-1 py-2 bg-[#222538] hover:bg-[#2c3049] text-xs font-semibold text-slate-300 rounded-lg border border-[#333852] transition-colors"
              >
                {file ? "📸 Change Image" : "📸 Select Image"}
              </button>
              
              <button
                onClick={startAnalyze}
                disabled={!file || loading || (engine === "gemini" ? keyStatus !== "ok" : urlStatus !== "ok")}
                className="px-4 py-2 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-purple-600 hover:opacity-95 disabled:opacity-40 text-white font-bold text-xs rounded-lg shadow-md shadow-violet-500/20 transition-all whitespace-nowrap"
              >
                {loading ? `⏳ Processing (${elapsed}s)` : "🚀 Convert to Figma"}
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 3. LIVE CONSOLE / REAL-TIME PROCESS MONITOR                             */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {loading && (
        <div className="bg-[#090a10] border-b border-[#1f2233] p-4 transition-all">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  Live AI Processing Terminal ({elapsed}s)
                </span>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {backendUrl.includes(".hf.space") ? "HuggingFace Space" : "llava + hermes3:8b"}
              </span>
            </div>

            <div className="bg-[#050608] rounded-lg p-3 border border-[#1b1e2c] font-mono text-xs space-y-1.5 max-h-32 overflow-y-auto">
              {logs.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-slate-600 text-[10px]">{l.time}</span>
                  <span>{l.icon}</span>
                  <span className="text-slate-300">{l.msg}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-red-950/40 border-b border-red-500/40 p-3 text-center">
          <p className="text-xs text-red-400 font-medium">❌ {error}</p>
        </div>
      )}


      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {/* 4. FIGMA STUDIO WORKSPACE (SIDE-BY-SIDE + SLIDER + DIFF)                 */}
      {/* ═══════════════════════════════════════════════════════════════════════ */}
      {studioReady ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          
          {/* Figma Studio Toolbar */}
          <div className="h-11 bg-[#181a27] border-b border-[#262a3f] px-4 flex items-center justify-between flex-shrink-0">
            
            {/* View Mode Switches */}
            <div className="flex items-center bg-[#0e1018] p-1 rounded-lg border border-[#262a3f] gap-1">
              <button
                onClick={() => setViewMode("side-by-side")}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${viewMode === "side-by-side" ? "bg-[#252a3f] text-white font-bold" : "text-slate-400 hover:text-white"}`}
              >
                ◫ Side by Side (1:1)
              </button>
              <button
                onClick={() => setViewMode("split-slider")}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${viewMode === "split-slider" ? "bg-[#252a3f] text-white font-bold" : "text-slate-400 hover:text-white"}`}
              >
                ↔ Split Slider
              </button>
              <button
                onClick={() => setViewMode("overlay")}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${viewMode === "overlay" ? "bg-[#252a3f] text-white font-bold" : "text-slate-400 hover:text-white"}`}
              >
                ⧉ Overlay Diff
              </button>
              <button
                onClick={() => setViewMode("clone-only")}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${viewMode === "clone-only" ? "bg-[#252a3f] text-white font-bold" : "text-slate-400 hover:text-white"}`}
              >
                🖥️ HTML Only
              </button>
            </div>

            {/* Center: Canvas info */}
            <span className="text-xs text-slate-400 font-mono hidden md:inline">
              Canvas: {canvasW} × {canvasH} px · {texts.length} Layers
            </span>

            {/* Right: Zoom & Export Actions */}
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-[#0e1018] border border-[#262a3f] rounded-lg px-2 py-0.5 text-xs">
                <button onClick={() => setZoom(z => Math.max(30, z - 10))} className="px-1 text-slate-400 hover:text-white font-bold">-</button>
                <span className="font-mono text-slate-300 w-10 text-center">{zoom}%</span>
                <button onClick={() => setZoom(z => Math.min(200, z + 10))} className="px-1 text-slate-400 hover:text-white font-bold">+</button>
                <button onClick={() => setZoom(100)} className="ml-1 text-[10px] text-slate-400 hover:text-slate-200">100%</button>
              </div>

              <button onClick={copyCodeToClipboard} className="px-2.5 py-1 bg-[#222538] hover:bg-[#2c3049] text-xs font-semibold rounded text-slate-200">
                {isCopied ? "✅ Copied!" : "📋 Copy Code"}
              </button>
              <button onClick={downloadHTML} className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-xs font-bold rounded text-white">
                💾 HTML
              </button>
              <button onClick={downloadPNG} className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-xs font-bold rounded text-white">
                🖼️ PNG
              </button>
            </div>
          </div>

          {/* Figma 3-Pane Body */}
          <div className="flex-1 flex overflow-hidden">
            
            {/* ── LEFT PANE: LAYERS TREE ── */}
            <aside className="w-64 bg-[#141622] border-r border-[#222538] flex flex-col flex-shrink-0">
              <div className="p-2 border-b border-[#222538]">
                <input
                  type="text"
                  placeholder="Filter layers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#0c0d15] border border-[#262a3f] rounded px-2.5 py-1 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500"
                />
              </div>

              <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                {filteredTexts.map((t) => {
                  const isSelected = selectedId === t.id;
                  const currentVal = curTexts[t.id] ?? t.text;
                  return (
                    <div
                      key={t.id}
                      onClick={() => setSelectedId(t.id)}
                      className={`px-2.5 py-1.5 rounded text-xs cursor-pointer flex items-center justify-between transition-colors
                        ${isSelected ? "bg-violet-600/30 text-white border border-violet-500/50 font-semibold" : "hover:bg-[#1c1e2e] text-slate-300"}`}
                    >
                      <div className="flex items-center gap-1.5 overflow-hidden">
                        <span className="text-[10px] text-slate-500 font-mono">T</span>
                        <span className="truncate max-w-[130px]" title={currentVal}>{currentVal}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">{t.font_size}px</span>
                    </div>
                  );
                })}
              </div>
            </aside>

            {/* ── CENTER CANVAS: FIGMA 1:1 WORKSPACE ── */}
            <div className="flex-1 bg-[#0a0b10] overflow-auto flex flex-col items-center justify-start p-6 relative">
              <div
                className="transition-transform duration-100 origin-top flex flex-col items-center"
                style={{ transform: `scale(${zoom / 100})` }}
              >
                {/* 1. SIDE BY SIDE */}
                {viewMode === "side-by-side" && (
                  <div className="flex gap-8 items-start">
                    {/* Original Frame */}
                    <div className="flex flex-col items-center">
                      <div className="flex items-center justify-between w-full px-1 mb-2 text-xs font-semibold text-slate-400">
                        <span>📸 ORIGINAL REFERENCE</span>
                        <span className="text-[10px] bg-[#1a1c29] px-2 py-0.5 rounded text-slate-400 font-mono">{canvasW} × {canvasH}</span>
                      </div>
                      <div
                        className="rounded-lg overflow-hidden border-2 border-[#262a3f] shadow-2xl bg-black"
                        style={{ width: `${canvasW * 0.55}px`, height: `${canvasH * 0.55}px` }}
                      >
                        <img src={imgSrc} alt="Original Reference" className="w-full h-full object-contain" />
                      </div>
                    </div>

                    {/* Live HTML Clone Frame */}
                    <div className="flex flex-col items-center">
                      <div className="flex items-center justify-between w-full px-1 mb-2 text-xs font-semibold text-violet-400">
                        <span>✨ PIXEL-PERFECT HTML CLONE</span>
                        <span className="text-[10px] bg-violet-900/40 text-violet-300 border border-violet-500/30 px-2 py-0.5 rounded font-mono">LIVE DOM</span>
                      </div>
                      <div
                        className="rounded-lg overflow-hidden border-2 border-violet-500/80 shadow-2xl bg-white relative"
                        style={{ width: `${canvasW * 0.55}px`, height: `${canvasH * 0.55}px` }}
                      >
                        <iframe ref={frameRef} title="Live Clone" className="w-full h-full border-0" />
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. SPLIT SLIDER */}
                {viewMode === "split-slider" && (
                  <div className="flex flex-col items-center">
                    <span className="mb-2 text-xs text-slate-400">Drag handle left/right to compare pixel-for-pixel alignment ({sliderPos}%)</span>
                    <div
                      ref={splitRef}
                      className="relative overflow-hidden rounded-lg border-2 border-[#333852] shadow-2xl cursor-ew-resize select-none"
                      style={{ width: `${canvasW * 0.65}px`, height: `${canvasH * 0.65}px` }}
                      onMouseDown={handleMouseDown}
                    >
                      <div className="absolute inset-0 bg-white">
                        <iframe ref={frameRef} title="Live Clone" className="w-full h-full border-0 pointer-events-none" />
                      </div>
                      <div className="absolute inset-0 overflow-hidden bg-black border-r-2 border-violet-400" style={{ width: `${sliderPos}%` }}>
                        <img src={imgSrc} alt="Original" className="object-contain max-w-none" style={{ width: `${canvasW * 0.65}px`, height: `${canvasH * 0.65}px` }} />
                      </div>
                      <div className="absolute top-0 bottom-0 w-1 bg-violet-500 shadow-lg pointer-events-none" style={{ left: `${sliderPos}%` }}>
                        <div className="absolute top-1/2 -translate-y-1/2 -left-3.5 w-8 h-8 rounded-full bg-violet-600 text-white text-[11px] font-bold flex items-center justify-center shadow-md border border-white">
                          ⇄
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. OVERLAY DIFF */}
                {viewMode === "overlay" && (
                  <div className="flex flex-col items-center">
                    <div className="mb-3 flex items-center gap-3 text-xs text-slate-300">
                      <span>Original</span>
                      <input type="range" min="0" max="100" value={overlayOpacity} onChange={(e) => setOverlayOpacity(Number(e.target.value))} className="w-48 accent-violet-500 cursor-pointer" />
                      <span>HTML Clone Overlay: <b>{overlayOpacity}%</b></span>
                    </div>
                    <div className="relative rounded-lg overflow-hidden border-2 border-violet-500 shadow-2xl" style={{ width: `${canvasW * 0.65}px`, height: `${canvasH * 0.65}px` }}>
                      <img src={imgSrc} alt="Original" className="w-full h-full object-contain absolute inset-0" />
                      <div className="absolute inset-0" style={{ opacity: overlayOpacity / 100 }}>
                        <iframe ref={frameRef} title="Overlay Clone" className="w-full h-full border-0 pointer-events-none" />
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. CLONE ONLY */}
                {viewMode === "clone-only" && (
                  <div className="rounded-lg overflow-hidden border-2 border-violet-500 shadow-2xl bg-white" style={{ width: `${canvasW * 0.75}px`, height: `${canvasH * 0.75}px` }}>
                    <iframe ref={frameRef} title="Full Clone" className="w-full h-full border-0" />
                  </div>
                )}
              </div>
            </div>

            {/* ── RIGHT PANE: FIGMA DESIGN INSPECTOR ── */}
            <aside className="w-72 bg-[#141622] border-l border-[#222538] flex flex-col flex-shrink-0 p-3.5 overflow-y-auto space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-[#222538]">
                <span className="text-xs font-bold text-white uppercase tracking-wider">Design Inspector</span>
                <span className="text-[10px] font-mono text-violet-400 bg-violet-900/30 px-2 py-0.5 rounded border border-violet-500/30">
                  {selectedItem ? selectedItem.id : "Canvas"}
                </span>
              </div>

              {selectedItem ? (
                <div className="space-y-3.5">
                  <div>
                    <label className="text-[11px] font-semibold text-slate-300 block mb-1">Text Content (Live Update)</label>
                    <textarea
                      rows={3}
                      value={curTexts[selectedItem.id] ?? selectedItem.text}
                      onChange={(e) => updateText(selectedItem.id, e.target.value)}
                      className="w-full bg-[#0c0d15] border border-[#2c3049] focus:border-violet-500 rounded-lg p-2 text-xs text-white font-medium focus:outline-none"
                    />
                  </div>

                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Position &amp; Size</span>
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <div className="bg-[#0c0d15] p-2 rounded border border-[#222538] flex justify-between">
                        <span className="text-slate-500">X</span>
                        <span className="text-white">{selectedItem.left}%</span>
                      </div>
                      <div className="bg-[#0c0d15] p-2 rounded border border-[#222538] flex justify-between">
                        <span className="text-slate-500">Y</span>
                        <span className="text-white">{selectedItem.top}%</span>
                      </div>
                      <div className="bg-[#0c0d15] p-2 rounded border border-[#222538] flex justify-between">
                        <span className="text-slate-500">W</span>
                        <span className="text-white">{selectedItem.width}%</span>
                      </div>
                      <div className="bg-[#0c0d15] p-2 rounded border border-[#222538] flex justify-between">
                        <span className="text-slate-500">H</span>
                        <span className="text-white">{selectedItem.height}%</span>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="bg-[#0c0d15] p-2 rounded border border-[#222538] flex justify-between items-center text-xs">
                      <span className="text-slate-400">Font Size</span>
                      <span className="font-mono font-semibold text-white">{selectedItem.font_size} px</span>
                    </div>
                    <div className="bg-[#0c0d15] p-2 rounded border border-[#222538] flex justify-between items-center text-xs">
                      <span className="text-slate-400">Color</span>
                      <div className="flex items-center gap-1.5">
                        <div className="w-3.5 h-3.5 rounded border border-white/20" style={{ backgroundColor: selectedItem.color }} />
                        <span className="font-mono font-semibold text-white">{selectedItem.color}</span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => updateText(selectedItem.id, selectedItem.text)}
                    className="w-full py-1.5 text-xs text-slate-400 hover:text-white bg-[#0c0d15] hover:bg-[#1a1c2b] rounded border border-[#222538] transition-colors"
                  >
                    ↺ Reset Text
                  </button>
                </div>
              ) : (
                <div className="text-center py-10 text-slate-500 text-xs">
                  <p className="text-2xl mb-1">👆</p>
                  <p>Select any layer from the left to edit and inspect properties.</p>
                </div>
              )}
            </aside>
          </div>
        </div>
      ) : (
        /* Empty State Placeholder */
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#171926] border border-[#262a3f] flex items-center justify-center text-3xl mb-4 shadow-xl">
            🖼️
          </div>
          <h2 className="text-lg font-bold text-white mb-1">কোনো ইমেজ লোড করা নেই</h2>
          <p className="text-xs text-slate-400 max-w-sm mb-4">
            উপরে Step 3 থেকে যেকোনো ডিজাইন বা ডকুমেন্ট ইমেজ আপলোড করে &ldquo;Convert to Figma&rdquo; বাটন চাপুন।
          </p>
        </div>
      )}

    </main>
  );
}
