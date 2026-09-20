"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export default function EditorPage() {
  const [texts,    setTexts]    = useState([]);
  const [genHTML,  setGenHTML]  = useState("");
  const [filename, setFilename] = useState("");
  const [imgSrc,   setImgSrc]   = useState("");
  const [showOrig, setShowOrig] = useState(false);
  const [curTexts, setCurTexts] = useState({});
  const frameRef = useRef(null);
  const router   = useRouter();

  // Load data from sessionStorage
  useEffect(() => {
    const raw = sessionStorage.getItem("editorData");
    if (!raw) { router.push("/"); return; }
    const d = JSON.parse(raw);
    setTexts(d.texts || []);
    setGenHTML(d.generatedHTML || "");
    setFilename(d.filename || "design");
    setImgSrc(`data:${d.mimeType};base64,${d.imageBase64}`);
    const init = {};
    (d.texts || []).forEach(t => { init[t.id] = t.text; });
    setCurTexts(init);
  }, []);

  // Render preview whenever texts or HTML changes
  useEffect(() => {
    if (!genHTML || !frameRef.current) return;
    let html = genHTML;
    texts.forEach(t => {
      const val = (curTexts[t.id] ?? t.text)
        .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
      html = html.replace(
        new RegExp(`(id=["']${t.id}["'][^>]*>)[^<]*`, "g"),
        (_, tag) => tag + val
      );
    });
    const doc = frameRef.current.contentDocument || frameRef.current.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    const timer = setTimeout(() => {
      try {
        const h = frameRef.current.contentDocument.body.scrollHeight;
        frameRef.current.style.height = Math.max(h, 300) + "px";
      } catch {}
    }, 800);
    return () => clearTimeout(timer);
  }, [curTexts, genHTML, texts]);

  const updateText = (id, val) => setCurTexts(p => ({ ...p, [id]: val }));

  const buildFinalHTML = () => {
    let html = genHTML;
    texts.forEach(t => {
      const val = (curTexts[t.id] ?? t.text)
        .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
      html = html.replace(
        new RegExp(`(id=["']${t.id}["'][^>]*>)[^<]*`, "g"),
        (_, tag) => tag + val
      );
    });
    return html;
  };

  const downloadHTML = () => {
    const blob = new Blob([buildFinalHTML()], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `edited_${filename}.html`;
    a.click();
  };

  const downloadPNG = () => {
    const fr = frameRef.current;
    const s = fr.contentDocument.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js";
    s.onload = () => {
      fr.contentWindow.html2canvas(fr.contentDocument.body, { scale: 2 }).then(canvas => {
        const a = document.createElement("a");
        a.download = `design_${filename}.png`;
        a.href = canvas.toDataURL("image/png");
        a.click();
      });
    };
    fr.contentDocument.head.appendChild(s);
  };

  if (!genHTML) {
    return (
      <div className="min-h-screen bg-[#0c0c1e] flex items-center justify-center">
        <div className="text-center text-white">
          <div className="text-4xl mb-3">⏳</div>
          <p>Loading editor...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#0c0c1e] flex flex-col overflow-hidden">

      {/* Top Bar */}
      <header className="flex items-center justify-between px-4 py-2.5 flex-shrink-0
        bg-gradient-to-r from-violet-700 to-purple-700">
        <div>
          <h1 className="text-white font-bold text-sm">🎨 AI Image Editor</h1>
          <p className="text-violet-200 text-xs">{filename} — {texts.length} editable texts</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowOrig(v => !v)}
            className="px-3 py-1.5 bg-white/15 hover:bg-white/25 text-white text-xs font-semibold rounded-lg transition-colors">
            📸 Original
          </button>
          <button onClick={downloadHTML}
            className="px-3 py-1.5 bg-white text-violet-700 text-xs font-bold rounded-lg hover:bg-violet-50 transition-colors">
            💾 HTML
          </button>
          <button onClick={downloadPNG}
            className="px-3 py-1.5 bg-emerald-400 text-emerald-900 text-xs font-bold rounded-lg hover:bg-emerald-300 transition-colors">
            🖼️ PNG
          </button>
          <button onClick={() => router.push("/")}
            className="px-3 py-1.5 bg-white/15 hover:bg-white/25 text-white text-xs font-semibold rounded-lg transition-colors">
            ← New
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* LEFT: Text Editor Sidebar */}
        <aside className="w-72 min-w-[240px] bg-[#13132b] border-r border-[#1e1e45] overflow-y-auto p-3 flex flex-col gap-3">

          <p className="text-[10px] font-bold text-violet-400 uppercase tracking-widest pt-1 border-b border-[#1e1e45] pb-2">
            ✏️ Text Elements
          </p>

          {texts.map((t) => (
            <div key={t.id} className="group">
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-semibold text-slate-500">
                  {t.id}
                  <span className="ml-1 text-cyan-500 font-normal">
                    ({Math.round(t.confidence * 100)}%)
                  </span>
                </label>
                <span className="text-[10px] text-slate-600">{t.role || "text"}</span>
              </div>
              <input
                type="text"
                value={curTexts[t.id] ?? t.text}
                onChange={(e) => updateText(t.id, e.target.value)}
                className="w-full px-2.5 py-1.5 bg-[#090920] border border-[#202050] rounded-md
                  text-white text-xs font-mono focus:outline-none focus:border-violet-500
                  focus:bg-[#0d0d30] transition-colors"
              />
            </div>
          ))}

          {texts.length === 0 && (
            <p className="text-slate-600 text-xs text-center py-4">কোনো text পাওয়া যায়নি</p>
          )}
        </aside>

        {/* RIGHT: Preview */}
        <main className="flex-1 bg-[#07071a] overflow-auto flex flex-col items-center p-4 gap-2">
          <span className="text-[10px] text-slate-700 uppercase tracking-widest">Live Preview</span>
          <iframe
            ref={frameRef}
            className="w-full max-w-4xl bg-white rounded-xl shadow-2xl border-0 min-h-[300px]"
            title="preview"
          />
        </main>
      </div>

      {/* Floating Original Image */}
      {showOrig && imgSrc && (
        <div className="fixed bottom-4 right-4 z-50 rounded-xl overflow-hidden shadow-2xl border-2 border-violet-500 max-w-xs">
          <div className="bg-violet-600 px-3 py-1 flex justify-between items-center">
            <span className="text-white text-xs font-semibold">📸 Original</span>
            <button onClick={() => setShowOrig(false)} className="text-white text-xs opacity-70 hover:opacity-100">✕</button>
          </div>
          <img src={imgSrc} alt="original" className="w-full block" />
        </div>
      )}
    </div>
  );
}
