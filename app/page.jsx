"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";


const STORAGE_KEY = "colabBackendUrl";

export default function Home() {
  // Step state: 1 = copy colab code, 2 = validate url, 3 = upload image
  const [step,       setStep]       = useState(1);
  const [copied,     setCopied]     = useState(false);
  const [backendUrl, setBackendUrl] = useState("");
  const [urlStatus,  setUrlStatus]  = useState("idle"); // idle|checking|ok|error
  const [file,       setFile]       = useState(null);
  const [preview,    setPreview]    = useState(null);
  const [dragging,   setDragging]   = useState(false);
  const [processing, setProcessing] = useState(false);
  const [procStep,   setProcStep]   = useState("");
  const [progress,   setProgress]   = useState(0);
  const [error,      setError]      = useState("");
  const inputRef = useRef(null);
  const router   = useRouter();

  // Restore saved URL
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      setBackendUrl(saved);
      setUrlStatus("ok");
      setStep(3);
    }
  }, []);

  // ── Copy Colab Code ──
  const copyColabCode = async () => {
    try {
      const res = await fetch("/colabCode.json");
      const data = await res.json();
      await navigator.clipboard.writeText(data.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setCopied(false);
      alert("Copy failed. Please try again.");
    }
  };

  // ── Test Colab URL ──
  const testUrl = async () => {
    const url = backendUrl.trim().replace(/\/$/, "");
    if (!url) return;
    setUrlStatus("checking");
    setError("");
    try {
      const r = await fetch(`${url}/ping`, {
        signal: AbortSignal.timeout(10000),
      });
      const d = await r.json();
      if (d.pong) {
        setUrlStatus("ok");
        localStorage.setItem(STORAGE_KEY, url);
        setBackendUrl(url);
        setStep(3);
      } else {
        setUrlStatus("error");
      }
    } catch {
      setUrlStatus("error");
    }
  };

  // ── File Handling ──
  const handleFile = (f) => {
    if (!f?.type.startsWith("image/")) {
      setError("শুধু image file দিন (JPG, PNG, WEBP)");
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      setError("File 20MB এর বেশি হবে না");
      return;
    }
    setError("");
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    handleFile(e.dataTransfer.files[0]);
  }, []);

  // ── Analyze Image ──
  const analyzeImage = async () => {
    if (!file || urlStatus !== "ok") return;
    setProcessing(true);
    setError("");
    setProgress(10);

    try {
      setProcStep("📸 Colab এ image পাঠানো হচ্ছে...");
      const formData = new FormData();
      formData.append("file", file);

      setProgress(25);
      setProcStep("👁️ llava Vision AI analyze করছে...");

      const response = await fetch(`${backendUrl}/analyze`, {
        method: "POST",
        body: formData,
      });

      setProgress(60);
      setProcStep("💻 hermes3:8b HTML/CSS generate করছে...");

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${response.status}`);
      }

      const data = await response.json();
      if (!data.success) throw new Error(data.error || "Unknown error");

      setProgress(90);
      setProcStep("🎨 Figma-style Editor তৈরি হচ্ছে...");

      sessionStorage.setItem("editorData", JSON.stringify({
        texts:         data.texts,
        generatedHTML: data.generatedHTML,
        filename:      data.filename,
        imageDataUrl:  data.imageDataUrl,
        dominantColor: data.dominantColor,
        palette:       data.palette,
        width:         data.width,
        height:        data.height,
      }));

      setProgress(100);
      router.push("/editor");
    } catch (err) {
      setError(`❌ ${err.message}`);
      setProcessing(false);
      setProgress(0);
    }
  };

  // ── Step Indicator ──
  const StepDot = ({ n, label }) => {
    const done    = step > n;
    const current = step === n;
    return (
      <div className="flex flex-col items-center gap-1">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all
          ${done    ? "bg-emerald-500 text-white"
          : current ? "bg-violet-600 text-white ring-4 ring-violet-500/30"
          : "bg-slate-800 text-slate-500"}`}>
          {done ? "✓" : n}
        </div>
        <span className={`text-[10px] font-semibold ${current ? "text-violet-400" : done ? "text-emerald-400" : "text-slate-600"}`}>
          {label}
        </span>
      </div>
    );
  };

  return (
    <main className="min-h-screen bg-[#0c0c1e] flex flex-col items-center p-5 pt-8">

      {/* Header */}
      <div className="text-center mb-6">
        <span className="inline-block px-3 py-1 bg-violet-500/20 border border-violet-500/40
          rounded-full text-violet-300 text-xs font-semibold mb-3">
          0% Filter · llava + hermes3:8b · Uncensored AI
        </span>
        <h1 className="text-4xl font-black text-white mb-2">
          🎨 AI Image{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-fuchsia-400">
            → Editable
          </span>
        </h1>
        <p className="text-slate-400 text-sm">
          যেকোনো Design Image → Figma-style Live Editor
        </p>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2 mb-6">
        <StepDot n={1} label="Colab Code" />
        <div className={`h-px w-12 ${step > 1 ? "bg-emerald-500" : "bg-slate-700"}`} />
        <StepDot n={2} label="URL Verify" />
        <div className={`h-px w-12 ${step > 2 ? "bg-emerald-500" : "bg-slate-700"}`} />
        <StepDot n={3} label="Upload" />
      </div>

      <div className="w-full max-w-xl flex flex-col gap-4">

        {/* ══ STEP 1: Copy Colab Code ══ */}
        <div className={`rounded-2xl border transition-all duration-300
          ${step === 1 ? "border-violet-500 bg-violet-500/5" : "border-slate-700/50 bg-slate-900/30"}`}>
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className={`font-bold text-sm flex items-center gap-2
                  ${step >= 1 ? "text-white" : "text-slate-500"}`}>
                  <span className="text-lg">📋</span> Step 1 — Colab Backend Code Copy করুন
                </h2>
                <p className="text-slate-500 text-xs mt-0.5">
                  Google Colab এ paste করে run করুন → URL পাবেন
                </p>
              </div>
              {step > 1 && (
                <span className="text-emerald-400 text-xs bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                  ✓ Done
                </span>
              )}
            </div>

            {/* Code Preview */}
            <div className="bg-[#090920] rounded-xl border border-[#1a1a40] overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-[#0f0f30] border-b border-[#1a1a40]">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/70" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                  <div className="w-3 h-3 rounded-full bg-green-500/70" />
                </div>
                <span className="text-[10px] text-slate-500 font-mono">AI_Colab_Backend.py</span>
                <button
                  onClick={copyColabCode}
                  className={`text-xs font-bold px-3 py-1 rounded-md transition-all
                    ${copied
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                      : "bg-violet-500/20 text-violet-300 border border-violet-500/40 hover:bg-violet-500/30"
                    }`}
                >
                  {copied ? "✅ Copied!" : "📋 Copy Code"}
                </button>
              </div>
              <pre className="p-3 text-xs text-slate-400 font-mono overflow-hidden h-28 relative">
                <code>{"# AI Colab Backend Code\n# FastAPI + Ollama (llava + hermes3:8b) + Cloudflare Tunnel\n# Click Copy Code button to get the full code..."}...</code>
                <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#090920]" />
              </pre>
            </div>

            {/* Instructions */}
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[
                { n:"1", t:"Code Copy করুন", i:"📋" },
                { n:"2", t:"Colab এ paste → Run", i:"▶️" },
                { n:"3", t:"URL পাবেন → Step 2", i:"🔗" },
              ].map(s => (
                <div key={s.n} className="bg-[#0d0d25] rounded-lg p-2 border border-[#1a1a40]">
                  <div className="text-lg mb-1">{s.i}</div>
                  <div className="text-[10px] text-slate-400">{s.t}</div>
                </div>
              ))}
            </div>

            {/* Colab Link */}
            <div className="mt-3 flex items-center justify-between">
              <a href="https://colab.research.google.com" target="_blank" rel="noreferrer"
                className="text-xs text-violet-400 hover:text-violet-300 underline underline-offset-2">
                → Google Colab খুলুন (T4 GPU)
              </a>
              {step === 1 && (
                <button
                  onClick={() => { copyColabCode(); setStep(2); }}
                  className="text-xs font-bold px-4 py-2 bg-gradient-to-r from-violet-600 to-fuchsia-600
                    text-white rounded-lg hover:opacity-90 transition-opacity"
                >
                  Copy &amp; Next →
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ══ STEP 2: Validate URL ══ */}
        <div className={`rounded-2xl border transition-all duration-300
          ${step === 2 ? "border-violet-500 bg-violet-500/5"
          : step > 2  ? "border-slate-700/50 bg-slate-900/30 opacity-80"
          : "border-slate-800/50 bg-slate-900/20 opacity-40 pointer-events-none"}`}>
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="font-bold text-sm text-white flex items-center gap-2">
                  <span className="text-lg">🔗</span> Step 2 — Colab URL Validate করুন
                </h2>
                <p className="text-slate-500 text-xs mt-0.5">
                  Colab এ run করার পরে যে URL পাবেন সেটা paste করুন
                </p>
              </div>
              {step > 2 && (
                <button onClick={() => { setStep(2); setUrlStatus("idle"); }}
                  className="text-xs text-slate-500 hover:text-slate-300">
                  ✎ Change
                </button>
              )}
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={backendUrl}
                onChange={(e) => { setBackendUrl(e.target.value); setUrlStatus("idle"); }}
                onKeyDown={(e) => e.key === "Enter" && testUrl()}
                placeholder="https://xxxx.trycloudflare.com"
                className="flex-1 px-3 py-2.5 bg-[#090920] border border-[#202050] rounded-xl
                  text-white text-xs font-mono placeholder:text-slate-600
                  focus:outline-none focus:border-violet-500 transition-colors"
              />
              <button
                onClick={testUrl}
                disabled={!backendUrl.trim() || urlStatus === "checking"}
                className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap
                  ${urlStatus === "checking"
                    ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/40 animate-pulse"
                    : "bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-30"
                  }`}
              >
                {urlStatus === "checking" ? "⏳ Testing..." : "✅ Validate"}
              </button>
            </div>

            {/* Status */}
            {urlStatus === "ok" && (
              <div className="mt-2 flex items-center gap-2 p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
                <span className="text-emerald-400 text-sm">✅</span>
                <span className="text-emerald-400 text-xs font-semibold">Connected! Colab backend চালু আছে।</span>
              </div>
            )}
            {urlStatus === "error" && (
              <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
                <p className="text-red-400 text-xs">❌ Connect হয়নি। Colab এ backend চালু আছে কি?</p>
                <p className="text-slate-500 text-[11px] mt-1">
                  Colab run করলে <code className="text-slate-400">https://xxxx.trycloudflare.com</code> URL পাবেন
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ══ STEP 3: Upload Image ══ */}
        <div className={`rounded-2xl border transition-all duration-300
          ${step === 3 ? "border-violet-500 bg-violet-500/5"
          : "border-slate-800/50 bg-slate-900/20 opacity-40 pointer-events-none"}`}>
          <div className="p-4">
            <h2 className="font-bold text-sm text-white flex items-center gap-2 mb-3">
              <span className="text-lg">📸</span> Step 3 — Image Upload করুন
              {urlStatus === "ok" && (
                <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/30 ml-auto">
                  Backend: Connected ✅
                </span>
              )}
            </h2>

            {/* Drop Zone */}
            {!preview ? (
              <div
                onDrop={onDrop}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onClick={() => inputRef.current?.click()}
                className={`rounded-xl border-2 border-dashed transition-all cursor-pointer py-10 text-center
                  ${dragging ? "border-fuchsia-400 bg-fuchsia-500/10" : "border-slate-700 hover:border-violet-500 hover:bg-slate-800/30"}`}
              >
                <input ref={inputRef} type="file" accept="image/*" className="hidden"
                  onChange={(e) => handleFile(e.target.files[0])} />
                <div className="text-4xl mb-2">📸</div>
                <p className="text-white text-sm font-semibold">Drag & Drop বা Click করুন</p>
                <p className="text-slate-500 text-xs mt-1">Poster · Banner · Certificate · Social Post</p>
                <p className="text-slate-700 text-xs mt-1">JPG, PNG, WEBP · Max 20MB</p>
              </div>
            ) : (
              <div className="flex gap-4 items-center p-3 bg-[#090920] rounded-xl border border-[#202050]">
                <img src={preview} className="w-28 h-auto rounded-lg object-cover border border-slate-700 shadow-lg" />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-semibold truncate">{file.name}</p>
                  <p className="text-slate-400 text-xs">{(file.size/1024).toFixed(0)} KB</p>
                  <button
                    onClick={() => { setFile(null); setPreview(null); }}
                    className="text-xs text-slate-600 hover:text-red-400 mt-1.5 transition-colors"
                  >
                    ✕ সরাও
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* ── Analyze Button ── */}
        {preview && urlStatus === "ok" && !processing && (
          <button
            onClick={analyzeImage}
            className="w-full py-4 rounded-xl font-black text-white text-base
              bg-gradient-to-r from-violet-600 via-fuchsia-600 to-purple-600
              hover:from-violet-500 hover:via-fuchsia-500 hover:to-purple-500
              active:scale-[0.99] transition-all shadow-xl shadow-violet-500/30"
          >
            🚀 AI দিয়ে Figma-style Convert করো
          </button>
        )}

        {/* ── Processing ── */}
        {processing && (
          <div className="p-5 bg-slate-900 rounded-2xl border border-slate-700">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-5 h-5 rounded-full border-2 border-violet-400 border-t-transparent animate-spin flex-shrink-0" />
              <div>
                <p className="text-white font-bold text-sm">Colab AI Processing...</p>
                <p className="text-violet-400 text-xs font-mono">{procStep}</p>
              </div>
            </div>
            <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-purple-500 rounded-full transition-all duration-700"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-slate-600 mt-1.5">
              <span>llava + hermes3:8b</span>
              <span>{progress}%</span>
            </div>
            <p className="text-slate-600 text-xs mt-2 text-center">30-90 সেকেন্ড লাগতে পারে...</p>
          </div>
        )}

        {/* Footer info */}
        {!processing && (
          <div className="flex items-center justify-center gap-3 text-[11px] text-slate-700 py-1">
            <span>0% Censored</span>
            <span>·</span>
            <span>Free T4 GPU</span>
            <span>·</span>
            <span>Colab + Vercel</span>
          </div>
        )}
      </div>
    </main>
  );
}
