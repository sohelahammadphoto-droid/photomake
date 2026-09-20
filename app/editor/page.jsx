"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export default function FigmaEditorPage() {
  const [texts,        setTexts]        = useState([]);
  const [genHTML,      setGenHTML]      = useState("");
  const [filename,     setFilename]     = useState("design");
  const [imgSrc,       setImgSrc]       = useState("");
  const [canvasW,      setCanvasW]      = useState(1000);
  const [canvasH,      setCanvasH]      = useState(1400);
  const [dominantColor,setDominantColor]= useState("#ffffff");
  const [palette,      setPalette]      = useState([]);
  const [curTexts,     setCurTexts]     = useState({});
  const [selectedId,   setSelectedId]   = useState(null);
  const [searchQuery,  setSearchQuery]  = useState("");

  // View modes: 'side-by-side' | 'split-slider' | 'overlay' | 'clone-only' | 'code'
  const [viewMode,     setViewMode]     = useState("side-by-side");
  const [sliderPos,    setSliderPos]    = useState(50); // for split-slider (%)
  const [overlayOpacity,setOverlayOpacity] = useState(50); // for overlay diff (%)
  const [zoom,         setZoom]         = useState(100); // (%)
  const [activeTab,    setActiveTab]    = useState("layers"); // 'layers' | 'palette'
  const [isCopied,     setIsCopied]     = useState(false);

  const frameRef    = useRef(null);
  const splitRef    = useRef(null);
  const isDragging  = useRef(false);
  const router      = useRouter();

  // ── 1. Load Session Data ──
  useEffect(() => {
    const raw = sessionStorage.getItem("editorData");
    if (!raw) {
      router.push("/");
      return;
    }
    try {
      const d = JSON.parse(raw);
      setTexts(d.texts || []);
      setGenHTML(d.generatedHTML || "");
      setFilename(d.filename || "design");
      setImgSrc(d.imageDataUrl || (d.imageBase64 ? `data:${d.mimeType || "image/png"};base64,${d.imageBase64}` : ""));
      setCanvasW(d.width || 1000);
      setCanvasH(d.height || 1400);
      setDominantColor(d.dominantColor || "#ffffff");
      setPalette(d.palette || []);

      const initialTexts = {};
      (d.texts || []).forEach(t => { initialTexts[t.id] = t.text; });
      setCurTexts(initialTexts);
      if (d.texts && d.texts.length > 0) {
        setSelectedId(d.texts[0].id);
      }
    } catch (err) {
      console.error("Failed to parse editorData:", err);
      router.push("/");
    }
  }, [router]);

  // ── 2. Build live dynamic HTML with current edited texts ──
  const buildCurrentHTML = () => {
    if (!genHTML) return "";
    let html = genHTML;
    texts.forEach(t => {
      const val = (curTexts[t.id] ?? t.text)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      html = html.replace(
        new RegExp(`(id=["']${t.id}["'][^>]*>)[^<]*`, "g"),
        (_, tag) => tag + val
      );
    });
    return html;
  };

  // ── 3. Update Iframe Content & Listen for click selections ──
  useEffect(() => {
    if (!genHTML || !frameRef.current) return;
    const doc = frameRef.current.contentDocument || frameRef.current.contentWindow.document;
    doc.open();
    doc.write(buildCurrentHTML());
    doc.close();

    // Attach click listeners to editable elements inside iframe
    const handleFrameClick = () => {
      try {
        texts.forEach(t => {
          const el = doc.getElementById(t.id);
          if (el) {
            el.style.outline = selectedId === t.id ? "2px solid #0ea5e9" : "none";
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
  }, [curTexts, genHTML, texts, selectedId]);

  // ── 4. Split Slider Dragging Handler ──
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

  // ── 5. Downloads & Exports ──
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

  if (!genHTML) {
    return (
      <div className="min-h-screen bg-[#1e1e1e] flex items-center justify-center text-white font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-violet-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-slate-300">Figma Studio Workspace লোড হচ্ছে...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-[#1e1e1e] text-[#e0e0e0] flex flex-col overflow-hidden select-none font-sans">

      {/* ═════════════════════════════════════════════════════════════════════════ */}
      {/* 1. FIGMA TOP NAVIGATION & TOOLBAR                                        */}
      {/* ═════════════════════════════════════════════════════════════════════════ */}
      <header className="h-12 bg-[#2c2c2c] border-b border-[#383838] px-4 flex items-center justify-between flex-shrink-0 z-30">
        
        {/* Left: Figma Logo & Document Title */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/")}
            title="Return to Home"
            className="w-8 h-8 rounded-lg bg-[#383838] hover:bg-[#444] flex items-center justify-center text-white transition-colors"
          >
            ←
          </button>
          
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50" />
            <span className="font-semibold text-xs text-white tracking-wide max-w-[200px] truncate">
              {filename}
            </span>
            <span className="text-[10px] bg-[#383838] text-slate-300 px-2 py-0.5 rounded font-mono">
              {canvasW} × {canvasH} px
            </span>
          </div>
        </div>

        {/* Center: Figma View Mode Toggles */}
        <div className="flex items-center bg-[#1e1e1e] p-1 rounded-lg border border-[#383838] gap-1">
          <button
            onClick={() => setViewMode("side-by-side")}
            className={`px-3 py-1 text-xs rounded-md font-medium flex items-center gap-1.5 transition-all
              ${viewMode === "side-by-side" ? "bg-[#383838] text-white shadow-sm font-semibold" : "text-slate-400 hover:text-white"}`}
            title="Side by Side (Original vs HTML Clone)"
          >
            <span>◫</span> Side by Side
          </button>

          <button
            onClick={() => setViewMode("split-slider")}
            className={`px-3 py-1 text-xs rounded-md font-medium flex items-center gap-1.5 transition-all
              ${viewMode === "split-slider" ? "bg-[#383838] text-white shadow-sm font-semibold" : "text-slate-400 hover:text-white"}`}
            title="Curtain Slider Split Comparison"
          >
            <span>↔</span> Split Slider
          </button>

          <button
            onClick={() => setViewMode("overlay")}
            className={`px-3 py-1 text-xs rounded-md font-medium flex items-center gap-1.5 transition-all
              ${viewMode === "overlay" ? "bg-[#383838] text-white shadow-sm font-semibold" : "text-slate-400 hover:text-white"}`}
            title="Overlay Diff Blending"
          >
            <span>⧉</span> Overlay Diff
          </button>

          <button
            onClick={() => setViewMode("clone-only")}
            className={`px-3 py-1 text-xs rounded-md font-medium flex items-center gap-1.5 transition-all
              ${viewMode === "clone-only" ? "bg-[#383838] text-white shadow-sm font-semibold" : "text-slate-400 hover:text-white"}`}
            title="Full HTML Clone Preview"
          >
            <span>🖥️</span> HTML Only
          </button>
        </div>

        {/* Right: Zoom & Export Actions */}
        <div className="flex items-center gap-2">
          
          {/* Zoom controls */}
          <div className="flex items-center bg-[#1e1e1e] border border-[#383838] rounded-lg px-2 py-0.5 text-xs">
            <button onClick={() => setZoom(z => Math.max(30, z - 10))} className="px-1.5 text-slate-400 hover:text-white font-bold">-</button>
            <span className="font-mono text-slate-300 w-12 text-center">{zoom}%</span>
            <button onClick={() => setZoom(z => Math.min(200, z + 10))} className="px-1.5 text-slate-400 hover:text-white font-bold">+</button>
            <button onClick={() => setZoom(100)} className="ml-1 text-[10px] text-slate-400 hover:text-slate-200">100%</button>
          </div>

          <button
            onClick={copyCodeToClipboard}
            className="px-3 py-1.5 bg-[#383838] hover:bg-[#444] text-xs font-semibold rounded-lg text-slate-200 flex items-center gap-1 transition-colors"
          >
            {isCopied ? "✅ Copied!" : "📋 Copy Code"}
          </button>

          <button
            onClick={downloadHTML}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-xs font-semibold rounded-lg text-white transition-colors"
          >
            💾 Export HTML
          </button>

          <button
            onClick={downloadPNG}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold rounded-lg text-white transition-colors"
          >
            🖼️ Export PNG
          </button>
        </div>
      </header>

      {/* ═════════════════════════════════════════════════════════════════════════ */}
      {/* 2. THREE-PANE FIGMA WORKSPACE                                            */}
      {/* ═════════════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* ── LEFT PANEL: LAYERS & ASSETS ── */}
        <aside className="w-72 bg-[#252525] border-r border-[#383838] flex flex-col z-20 flex-shrink-0">
          
          {/* Tabs */}
          <div className="flex border-b border-[#383838] text-xs font-medium">
            <button
              onClick={() => setActiveTab("layers")}
              className={`flex-1 py-2.5 text-center border-b-2 transition-colors
                ${activeTab === "layers" ? "border-blue-500 text-white font-semibold" : "border-transparent text-slate-400 hover:text-slate-200"}`}
            >
              Layers ({texts.length})
            </button>
            <button
              onClick={() => setActiveTab("palette")}
              className={`flex-1 py-2.5 text-center border-b-2 transition-colors
                ${activeTab === "palette" ? "border-blue-500 text-white font-semibold" : "border-transparent text-slate-400 hover:text-slate-200"}`}
            >
              Colors ({palette.length + 1})
            </button>
          </div>

          {/* Tab 1: Layers Content */}
          {activeTab === "layers" && (
            <div className="flex-1 flex flex-col overflow-hidden">
              
              {/* Search Bar */}
              <div className="p-2 border-b border-[#333]">
                <input
                  type="text"
                  placeholder="Search layers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#1c1c1c] border border-[#383838] rounded px-2.5 py-1 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Layer Tree */}
              <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                {filteredTexts.map((t) => {
                  const isSelected = selectedId === t.id;
                  const currentVal = curTexts[t.id] ?? t.text;
                  return (
                    <div
                      key={t.id}
                      onClick={() => setSelectedId(t.id)}
                      className={`px-2.5 py-2 rounded-md text-xs cursor-pointer flex items-center justify-between transition-colors
                        ${isSelected ? "bg-[#0c8ce9]/20 text-white border border-[#0c8ce9]/50" : "hover:bg-[#2f2f2f] text-slate-300"}`}
                    >
                      <div className="flex items-center gap-2 overflow-hidden">
                        <span className="text-[10px] text-slate-500 font-mono">T</span>
                        <span className="truncate max-w-[140px] font-medium" title={currentVal}>
                          {currentVal}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono ml-2">
                        {t.font_size}px
                      </span>
                    </div>
                  );
                })}

                {filteredTexts.length === 0 && (
                  <p className="text-center text-xs text-slate-500 py-6">No layers match query</p>
                )}
              </div>
            </div>
          )}

          {/* Tab 2: Color Palette Content */}
          {activeTab === "palette" && (
            <div className="p-3 overflow-y-auto space-y-4">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Dominant Color</span>
                <div className="flex items-center gap-3 mt-1.5 p-2 bg-[#1c1c1c] rounded-lg border border-[#383838]">
                  <div className="w-8 h-8 rounded border border-white/20 shadow-inner" style={{ backgroundColor: dominantColor }} />
                  <div>
                    <p className="text-xs font-mono font-semibold text-white">{dominantColor}</p>
                    <p className="text-[10px] text-slate-500">Background Primary</p>
                  </div>
                </div>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Detected Palette</span>
                <div className="grid grid-cols-2 gap-2 mt-1.5">
                  {palette.map((c, i) => (
                    <div
                      key={i}
                      onClick={() => navigator.clipboard.writeText(c)}
                      className="flex items-center gap-2 p-1.5 bg-[#1c1c1c] rounded border border-[#383838] hover:border-blue-500 cursor-pointer"
                      title="Click to copy Hex"
                    >
                      <div className="w-5 h-5 rounded border border-white/10" style={{ backgroundColor: c }} />
                      <span className="text-[11px] font-mono text-slate-300">{c}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* ── CENTER: FIGMA CANVAS WORKSPACE ── */}
        <main className="flex-1 bg-[#141414] overflow-auto flex flex-col items-center justify-start p-6 relative">
          
          {/* Scale Container */}
          <div
            className="transition-transform duration-150 origin-top flex flex-col items-center"
            style={{ transform: `scale(${zoom / 100})` }}
          >

            {/* ── MODE 1: SIDE-BY-SIDE DUAL FIGMA CANVAS ── */}
            {viewMode === "side-by-side" && (
              <div className="flex gap-8 items-start">
                
                {/* Frame 1: Original Image */}
                <div className="flex flex-col items-center">
                  <div className="flex items-center justify-between w-full px-1 mb-2 text-xs font-semibold text-slate-400">
                    <span>📸 ORIGINAL REFERENCE DESIGN</span>
                    <span className="text-[10px] bg-[#2a2a2a] px-2 py-0.5 rounded text-slate-400 font-mono">
                      {canvasW} × {canvasH}
                    </span>
                  </div>
                  <div
                    className="rounded-lg overflow-hidden border-2 border-[#383838] shadow-2xl bg-black"
                    style={{ width: `${canvasW * 0.55}px`, height: `${canvasH * 0.55}px` }}
                  >
                    <img src={imgSrc} alt="Original Reference" className="w-full h-full object-contain" />
                  </div>
                </div>

                {/* Frame 2: Editable Live HTML Clone */}
                <div className="flex flex-col items-center">
                  <div className="flex items-center justify-between w-full px-1 mb-2 text-xs font-semibold text-blue-400">
                    <span>✨ PIXEL-PERFECT EDITABLE HTML CLONE</span>
                    <span className="text-[10px] bg-blue-900/50 text-blue-300 border border-blue-500/40 px-2 py-0.5 rounded font-mono">
                      LIVE DOM
                    </span>
                  </div>
                  <div
                    className="rounded-lg overflow-hidden border-2 border-blue-500/80 shadow-2xl bg-white relative"
                    style={{ width: `${canvasW * 0.55}px`, height: `${canvasH * 0.55}px` }}
                  >
                    <iframe
                      ref={frameRef}
                      title="Live HTML Clone"
                      className="w-full h-full border-0"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ── MODE 2: SPLIT DIFF SLIDER (CURTAIN COMPARISON) ── */}
            {viewMode === "split-slider" && (
              <div className="flex flex-col items-center">
                <div className="mb-2 text-xs text-slate-400 flex items-center gap-2">
                  <span>Drag the vertical line to inspect pixel-by-pixel alignment</span>
                  <span className="bg-[#2a2a2a] px-2 py-0.5 rounded text-blue-400 font-mono text-[10px]">
                    Split: {sliderPos}%
                  </span>
                </div>
                
                <div
                  ref={splitRef}
                  className="relative overflow-hidden rounded-lg border-2 border-[#444] shadow-2xl cursor-ew-resize select-none"
                  style={{ width: `${canvasW * 0.65}px`, height: `${canvasH * 0.65}px` }}
                  onMouseDown={handleMouseDown}
                >
                  {/* Underneath: Editable HTML Clone */}
                  <div className="absolute inset-0 bg-white">
                    <iframe ref={frameRef} title="Live Clone" className="w-full h-full border-0 pointer-events-none" />
                  </div>

                  {/* Overlaid: Original Image Clipped */}
                  <div
                    className="absolute inset-0 overflow-hidden bg-black border-r-2 border-blue-400"
                    style={{ width: `${sliderPos}%` }}
                  >
                    <img
                      src={imgSrc}
                      alt="Original"
                      className="object-contain max-w-none"
                      style={{ width: `${canvasW * 0.65}px`, height: `${canvasH * 0.65}px` }}
                    />
                  </div>

                  {/* Drag Handle */}
                  <div
                    className="absolute top-0 bottom-0 w-1 bg-blue-500 shadow-lg pointer-events-none"
                    style={{ left: `${sliderPos}%` }}
                  >
                    <div className="absolute top-1/2 -translate-y-1/2 -left-3.5 w-8 h-8 rounded-full bg-blue-600 text-white text-[11px] font-bold flex items-center justify-center shadow-md border border-white">
                      ⇄
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── MODE 3: OVERLAY BLEND (X-RAY INSPECTOR) ── */}
            {viewMode === "overlay" && (
              <div className="flex flex-col items-center">
                <div className="mb-3 flex items-center gap-3 text-xs text-slate-300">
                  <span>Original (Base)</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={overlayOpacity}
                    onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                    className="w-48 accent-blue-500 cursor-pointer"
                  />
                  <span>HTML Clone Overlay: <b>{overlayOpacity}%</b></span>
                </div>

                <div
                  className="relative rounded-lg overflow-hidden border-2 border-blue-500 shadow-2xl"
                  style={{ width: `${canvasW * 0.65}px`, height: `${canvasH * 0.65}px` }}
                >
                  <img src={imgSrc} alt="Original Base" className="w-full h-full object-contain absolute inset-0" />
                  <div className="absolute inset-0" style={{ opacity: overlayOpacity / 100 }}>
                    <iframe ref={frameRef} title="Overlay Clone" className="w-full h-full border-0 pointer-events-none" />
                  </div>
                </div>
              </div>
            )}

            {/* ── MODE 4: FULL CLONE ONLY ── */}
            {viewMode === "clone-only" && (
              <div className="flex flex-col items-center">
                <div
                  className="rounded-lg overflow-hidden border-2 border-blue-500 shadow-2xl bg-white"
                  style={{ width: `${canvasW * 0.75}px`, height: `${canvasH * 0.75}px` }}
                >
                  <iframe ref={frameRef} title="Full Clone" className="w-full h-full border-0" />
                </div>
              </div>
            )}
          </div>
        </main>

        {/* ── RIGHT PANEL: FIGMA DESIGN INSPECTOR ── */}
        <aside className="w-80 bg-[#252525] border-l border-[#383838] flex flex-col z-20 flex-shrink-0 p-3.5 overflow-y-auto space-y-4">
          
          <div className="flex items-center justify-between pb-2 border-b border-[#383838]">
            <span className="text-xs font-bold text-white uppercase tracking-wider">Design Inspector</span>
            <span className="text-[10px] font-mono text-blue-400 bg-blue-900/30 px-2 py-0.5 rounded border border-blue-500/30">
              {selectedItem ? selectedItem.id : "Canvas"}
            </span>
          </div>

          {selectedItem ? (
            <div className="space-y-4">
              
              {/* Text Edit Box */}
              <div>
                <label className="text-[11px] font-semibold text-slate-300 block mb-1">
                  Text Content (Live Update)
                </label>
                <textarea
                  rows={3}
                  value={curTexts[selectedItem.id] ?? selectedItem.text}
                  onChange={(e) => updateText(selectedItem.id, e.target.value)}
                  className="w-full bg-[#1a1a1a] border border-[#383838] focus:border-blue-500 rounded-lg p-2 text-xs text-white font-medium focus:outline-none transition-colors"
                />
              </div>

              {/* Coordinates & Dimensions */}
              <div>
                <label className="text-[11px] font-semibold text-slate-400 block mb-1.5 uppercase tracking-wider text-[10px]">
                  Position &amp; Layout
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-[#1c1c1c] p-2 rounded border border-[#333] flex justify-between items-center">
                    <span className="text-slate-500 font-mono">X</span>
                    <span className="font-mono text-white">{selectedItem.left}%</span>
                  </div>
                  <div className="bg-[#1c1c1c] p-2 rounded border border-[#333] flex justify-between items-center">
                    <span className="text-slate-500 font-mono">Y</span>
                    <span className="font-mono text-white">{selectedItem.top}%</span>
                  </div>
                  <div className="bg-[#1c1c1c] p-2 rounded border border-[#333] flex justify-between items-center">
                    <span className="text-slate-500 font-mono">W</span>
                    <span className="font-mono text-white">{selectedItem.width}%</span>
                  </div>
                  <div className="bg-[#1c1c1c] p-2 rounded border border-[#333] flex justify-between items-center">
                    <span className="text-slate-500 font-mono">H</span>
                    <span className="font-mono text-white">{selectedItem.height}%</span>
                  </div>
                </div>
              </div>

              {/* Typography */}
              <div>
                <label className="text-[11px] font-semibold text-slate-400 block mb-1.5 uppercase tracking-wider text-[10px]">
                  Typography
                </label>
                <div className="space-y-2">
                  <div className="bg-[#1c1c1c] p-2 rounded border border-[#333] flex justify-between items-center text-xs">
                    <span className="text-slate-400">Font Size</span>
                    <span className="font-mono font-semibold text-white">{selectedItem.font_size} px</span>
                  </div>
                  <div className="bg-[#1c1c1c] p-2 rounded border border-[#333] flex justify-between items-center text-xs">
                    <span className="text-slate-400">Color</span>
                    <div className="flex items-center gap-1.5">
                      <div className="w-3.5 h-3.5 rounded border border-white/20" style={{ backgroundColor: selectedItem.color }} />
                      <span className="font-mono font-semibold text-white">{selectedItem.color}</span>
                    </div>
                  </div>
                  <div className="bg-[#1c1c1c] p-2 rounded border border-[#333] flex justify-between items-center text-xs">
                    <span className="text-slate-400">Confidence</span>
                    <span className="text-emerald-400 font-mono">{Math.round((selectedItem.confidence || 0.95) * 100)}%</span>
                  </div>
                </div>
              </div>

              {/* Reset element to original text */}
              <button
                onClick={() => updateText(selectedItem.id, selectedItem.text)}
                className="w-full py-1.5 text-xs text-slate-400 hover:text-white bg-[#1c1c1c] hover:bg-[#2e2e2e] rounded border border-[#333] transition-colors"
              >
                ↺ Reset to Original Text
              </button>

            </div>
          ) : (
            <div className="text-center py-12 text-slate-500 text-xs">
              <p className="text-3xl mb-2">👆</p>
              <p>Select any element from the Left Layers list or click directly on the canvas to inspect &amp; edit.</p>
            </div>
          )}

          {/* Canvas Specs */}
          <div className="pt-4 border-t border-[#383838] space-y-2">
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Canvas Specs</span>
            <div className="text-xs text-slate-400 space-y-1">
              <div className="flex justify-between">
                <span>Total Elements:</span>
                <span className="text-white font-mono">{texts.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Aspect Ratio:</span>
                <span className="text-white font-mono">{((canvasH / canvasW) * 100).toFixed(1)}%</span>
              </div>
            </div>
          </div>
        </aside>

      </div>
    </div>
  );
}
