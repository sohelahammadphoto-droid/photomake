"use client";

import { useState, useRef, useEffect } from "react";

const STORAGE_KEY_COLAB = "ai_image_editor_backend_url";
const STORAGE_KEY_GEMINI = "geminiApiKey";

// ── Google Gemini Multimodal Vision System Prompt ──
const SYSTEM_PROMPT = `You are a World-Class Document, Receipt, Deed, Form, and UI layout-to-pixel-perfect HTML/CSS compiler.
Your task is purely technical OCR transcription, font matching, and spatial layout reconstruction:
1. Detect and transcribe EVERY single text element visible in the image (regardless of language - Bengali, English, Arabic, numerals, symbols).
2. For each element, produce:
   - "id": unique string index ("0", "1", "2", ...)
   - "text": exact raw text string
   - "box": [x, y, width, height] integer coordinates relative to original canvas
   - "font_size": estimated font size in px
   - "font_weight": "normal", "medium", "600", or "bold"
   - "color": hex color code (e.g. "#1e293b", "#000000")
   - "align": "left", "center", or "right"
3. Measure the overall canvas width and height (e.g. 1000 x 1400).
4. Identify dominant background color and key palette colors.
5. Generate a standalone, pixel-perfect HTML/CSS document where each text item has class="figma-element" and id="el-{id}" positioned absolutely matching exact coordinates.
6. Return STRICTLY a valid JSON object without markdown fences, matching this schema:
{
  "texts": [
    { "id": "0", "text": "...", "box": [50, 40, 300, 30], "font_size": 24, "font_weight": "bold", "color": "#111827", "align": "left" }
  ],
  "canvas": { "width": 1000, "height": 1400 },
  "colors": { "dominant": "#ffffff", "palette": ["#000000", "#1e3a8a", "#dc2626"] },
  "html": "<!DOCTYPE html><html><head><meta charset='utf-8'><link href='https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;600;700&family=Inter:wght@400;600;700&display=swap' rel='stylesheet'><style>body{margin:0;font-family:'Hind Siliguri','Inter',sans-serif;position:relative;background:#ffffff;}.figma-element{position:absolute;box-sizing:border-box;white-space:pre-wrap;cursor:text;}</style></head><body>...</body></html>"
}`;

export default function Home() {
  // Engine & Keys
  const [engine, setEngine] = useState("gemini"); // "gemini" | "colab"
  const [geminiKey, setGeminiKey] = useState("");
  const [keyStatus, setKeyStatus] = useState("idle"); // "idle" | "validating" | "ok" | "error"
  const [keyError, setKeyError] = useState("");
  const [activeModel, setActiveModel] = useState("gemini-2.5-flash");

  const [colabUrl, setColabUrl] = useState("");
  const [urlStatus, setUrlStatus] = useState("idle"); // "idle" | "checking" | "ok" | "error"

  // Image & Processing
  const [file, setFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [imageDimensions, setImageDimensions] = useState({ width: 1000, height: 1400 });
  const [loading, setLoading] = useState(false);
  const [progressStage, setProgressStage] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);

  // Studio Results
  const [texts, setTexts] = useState([]);
  const [generatedHtml, setGeneratedHtml] = useState("");
  const [canvasInfo, setCanvasInfo] = useState({ width: 1000, height: 1400 });
  const [colors, setColors] = useState({ dominant: "#ffffff", palette: [] });

  // Interactive View Controls
  const [viewMode, setViewMode] = useState("side-by-side"); // "side-by-side" | "slider" | "overlay" | "code"
  const [sliderPos, setSliderPos] = useState(50);
  const [overlayOpacity, setOverlayOpacity] = useState(50);
  const [zoom, setZoom] = useState(100);
  const [showBoxes, setShowBoxes] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [searchLayer, setSearchLayer] = useState("");
  const [codeTab, setCodeTab] = useState("html"); // "html" | "json"
  const [toastMessage, setToastMessage] = useState("");

  const inputRef = useRef(null);
  const splitRef = useRef(null);
  const isDragging = useRef(false);

  // ── Show Toast Notification ──
  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(""), 3500);
  };

  // ── Restore saved keys and URL ──
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedKey = localStorage.getItem(STORAGE_KEY_GEMINI);
      if (savedKey) {
        setGeminiKey(savedKey);
        validateKeyWithGoogle(savedKey);
      }
      const savedUrl = localStorage.getItem(STORAGE_KEY_COLAB);
      if (savedUrl) {
        setColabUrl(savedUrl);
        pingColab(savedUrl);
      }
    }
  }, []);

  // ── Validate Gemini Key with Google ModelService ──
  const validateKeyWithGoogle = async (keyToTest) => {
    const k = (keyToTest || geminiKey).trim();
    if (!k) {
      setKeyStatus("error");
      setKeyError("API Key প্রদান করুন");
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
        const rawModels = data.models || [];

        // Exclude audio/tts/embedding models and keep image-capable models
        const visionModels = rawModels.filter((m) => {
          const methods = m.supportedGenerationMethods || [];
          if (!methods.includes("generateContent")) return false;
          const name = (m.name || "").toLowerCase();
          if (
            name.includes("tts") ||
            name.includes("audio") ||
            name.includes("embedding") ||
            name.includes("imagen") ||
            name.includes("aqa") ||
            name.includes("learnlm")
          ) {
            return false;
          }
          if (Array.isArray(m.inputModalities) && m.inputModalities.length > 0) {
            const mods = m.inputModalities.map((x) => String(x).toLowerCase());
            if (!mods.includes("image")) return false;
          }
          return true;
        }).map((m) => m.name.replace("models/", ""));

        if (visionModels.length > 0) {
          setKeyStatus("ok");
          setGeminiKey(k);
          localStorage.setItem(STORAGE_KEY_GEMINI, k);
          setKeyError("");
          // Set preferred active model
          const preferred = [
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-2.0-flash-001",
            "gemini-1.5-flash",
            "gemini-1.5-flash-latest",
          ];
          const matched = preferred.find((p) => visionModels.includes(p)) || visionModels[0];
          setActiveModel(matched);
          showToast(`Gemini Key Validated! Connected to ${matched} ✅`);
        } else {
          setKeyStatus("error");
          setKeyError("এই Key-তে কোনো Vision/Image সক্ষম মডেল পাওয়া যায়নি।");
          localStorage.removeItem(STORAGE_KEY_GEMINI);
        }
      } else {
        const errData = await res.json().catch(() => ({}));
        setKeyStatus("error");
        setKeyError(errData.error?.message || "ভুল API Key! অনুগ্রহ করে সঠিক Key দিন।");
        localStorage.removeItem(STORAGE_KEY_GEMINI);
      }
    } catch (e) {
      setKeyStatus("error");
      setKeyError("ভ্যালিডেশন ব্যর্থ হয়েছে। ইন্টারনেট সংযোগ চেক করুন।");
    }
  };

  // ── Ping Colab Backend ──
  const pingColab = async (urlToTest) => {
    const u = (urlToTest || colabUrl).trim().replace(/\/+$/, "");
    if (!u) return;
    setUrlStatus("checking");
    try {
      const res = await fetch(`${u}/health`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        setUrlStatus("ok");
        localStorage.setItem(STORAGE_KEY_COLAB, u);
      } else {
        setUrlStatus("error");
      }
    } catch {
      setUrlStatus("error");
    }
  };

  // ── Image Upload Handling ──
  const handleImageFile = (uploadedFile) => {
    if (!uploadedFile) return;
    if (!uploadedFile.type.startsWith("image/")) {
      setError("অনুগ্রহ করে একটি বৈধ ইমেজ ফাইল (PNG, JPG, WebP) নির্বাচন করুন।");
      return;
    }
    setFile(uploadedFile);
    setError(null);
    setSelectedId(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      setImagePreview(dataUrl);

      // Extract natural dimensions
      const img = new Image();
      img.onload = () => {
        setImageDimensions({ width: img.naturalWidth || 1000, height: img.naturalHeight || 1400 });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(uploadedFile);
  };

  // ── DIRECT CLIENT-SIDE GEMINI EXECUTION (ZERO 504 TIMEOUT) ──
  const runGeminiDirect = async (base64Data, mimeType, apiKey) => {
    setProgressStage("Resolving Google Vision Models...");

    // Get list of active vision models for this key
    let candidateModels = [
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-2.0-flash-001",
      "gemini-1.5-flash",
      "gemini-1.5-flash-latest",
      "gemini-1.5-flash-002",
      "gemini-1.5-pro",
    ];

    try {
      const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (listRes.ok) {
        const listData = await listRes.json();
        const available = (listData.models || [])
          .filter((m) => {
            const methods = m.supportedGenerationMethods || [];
            if (!methods.includes("generateContent")) return false;
            const name = (m.name || "").toLowerCase();
            if (name.includes("tts") || name.includes("audio") || name.includes("embedding") || name.includes("imagen") || name.includes("aqa")) return false;
            return true;
          })
          .map((m) => m.name.replace("models/", ""));

        const filtered = candidateModels.filter((p) => available.includes(p));
        const remaining = available.filter((a) => !filtered.includes(a));
        if (filtered.length > 0 || remaining.length > 0) {
          candidateModels = [...filtered, ...remaining];
        }
      }
    } catch (e) {
      console.warn("Could not pre-list models, using default candidate list:", e);
    }

    const payload = {
      contents: [
        {
          parts: [
            {
              text: `${SYSTEM_PROMPT}\n\nTask: Analyze this uploaded document/design image. Accurately transcribe all Bengali, English, and numeric text, find exact spatial coordinates, and output pure JSON.`,
            },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Data,
              },
            },
          ],
        },
      ],
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    };

    let lastError = null;

    for (const model of candidateModels) {
      try {
        setProgressStage(`Transcribing Layout with ${model} (0% Censorship)...`);
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const errBody = await response.json().catch(() => ({}));
          const msg = errBody.error?.message || `HTTP ${response.status}`;
          console.warn(`Model ${model} returned error: ${msg}`);
          lastError = new Error(msg);
          continue; // Try next candidate model
        }

        const resJson = await response.json();
        const candidate = resJson.candidates?.[0];
        if (!candidate || !candidate.content?.parts?.[0]?.text) {
          lastError = new Error("AI returned empty response or content was blocked.");
          continue;
        }

        const rawText = candidate.content.parts[0].text;
        let parsed;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          const match = rawText.match(/\{[\s\S]*\}/);
          if (match) parsed = JSON.parse(match[0]);
          else throw new Error("AI output was not valid JSON format.");
        }

        setActiveModel(model);
        return parsed;
      } catch (err) {
        console.warn(`Attempt with ${model} failed:`, err);
        lastError = err;
      }
    }

    throw lastError || new Error("All candidate models failed. Check your API key or network.");
  };

  // ── Run Analysis Action ──
  const startAnalyze = async () => {
    if (!file) {
      setError("অনুগ্রহ করে প্রথমে একটি ইমেজ আপলোড করুন।");
      return;
    }

    if (engine === "gemini" && keyStatus !== "ok") {
      setError("অনুগ্রহ করে প্রথমে আপনার Gemini API Key টি Validate করুন।");
      return;
    }

    if (engine === "colab" && urlStatus !== "ok") {
      setError("অনুগ্রহ করে আপনার Colab URL চেক করুন। Colab অবশ্যই রানিং থাকতে হবে।");
      return;
    }

    setLoading(true);
    setError(null);
    setElapsed(0);
    setProgressStage("Preparing image data...");

    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);

    try {
      let dataUrl = imagePreview;
      if (!dataUrl) {
        dataUrl = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = (e) => resolve(e.target.result);
          r.onerror = reject;
          r.readAsDataURL(file);
        });
      }

      let mimeType = "image/jpeg";
      let base64Data = dataUrl;
      if (dataUrl.includes("data:") && dataUrl.includes(";base64,")) {
        const parts = dataUrl.split(";base64,");
        mimeType = parts[0].replace("data:", "");
        base64Data = parts[1];
      }

      let result;

      if (engine === "gemini") {
        // Direct Client-to-Google call - 100% Free, NO VERCEL 504 TIMEOUT!
        result = await runGeminiDirect(base64Data, mimeType, geminiKey);
      } else {
        // Direct Browser-to-Colab Call
        setProgressStage("Sending to Colab T4 GPU...");
        const cleanUrl = colabUrl.trim().replace(/\/+$/, "");
        const colabRes = await fetch(`${cleanUrl}/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: dataUrl }),
        });
        if (!colabRes.ok) throw new Error(`Colab returned HTTP ${colabRes.status}`);
        result = await colabRes.json();
      }

      setProgressStage("Synthesizing Pixel-Perfect Figma Studio...");

      const parsedTexts = result.texts || [];
      const parsedCanvas = result.canvas || { width: imageDimensions.width || 1000, height: imageDimensions.height || 1400 };
      const parsedColors = result.colors || { dominant: "#ffffff", palette: [] };
      let parsedHtml = result.html || result.generatedHTML || "";

      // Ensure HTML exists
      if (!parsedHtml && parsedTexts.length > 0) {
        parsedHtml = buildHtmlFromTexts(parsedTexts, parsedCanvas, parsedColors);
      }

      setTexts(parsedTexts);
      setCanvasInfo(parsedCanvas);
      setColors(parsedColors);
      setGeneratedHtml(parsedHtml);

      if (parsedTexts.length > 0) {
        setSelectedId(parsedTexts[0].id);
      }

      showToast(`সফলভাবে কনভার্ট হয়েছে! ${parsedTexts.length}টি এডিটেবল টেক্সট লেয়ার তৈরি হয়েছে 🎉`);
    } catch (err) {
      console.error("Conversion Error:", err);
      setError(err.message || "কনভার্ট করার সময় কোনো সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।");
    } finally {
      clearInterval(timer);
      setLoading(false);
      setProgressStage("");
    }
  };

  // ── Helper: Reconstruct HTML from Texts ──
  const buildHtmlFromTexts = (textList, canvas, colorData) => {
    const elementsHtml = textList
      .map((t) => {
        const [x, y, w, h] = t.box || [0, 0, 100, 30];
        return `<div id="el-${t.id}" class="figma-element" style="left:${x}px;top:${y}px;width:${w}px;min-height:${h}px;font-size:${t.font_size || 14}px;font-weight:${t.font_weight || "normal"};color:${t.color || "#000000"};text-align:${t.align || "left"};">${escapeHtml(t.text)}</div>`;
      })
      .join("\n    ");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Editable Image Clone</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      font-family: 'Hind Siliguri', 'Inter', sans-serif;
      background: ${colorData?.dominant || "#ffffff"};
      width: ${canvas.width}px;
      height: ${canvas.height}px;
      position: relative;
      overflow: hidden;
    }
    .figma-element {
      position: absolute;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.35;
      user-select: text;
    }
  </style>
</head>
<body>
  <div id="canvas-root" style="position:relative;width:100%;height:100%;">
    ${elementsHtml}
  </div>
</body>
</html>`;
  };

  const escapeHtml = (str) => {
    return (str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  // ── Update Selected Text Field in Live State ──
  const updateSelectedText = (key, val) => {
    if (selectedId === null) return;
    setTexts((prev) =>
      prev.map((item) => {
        if (item.id === selectedId) {
          const updated = { ...item, [key]: val };
          return updated;
        }
        return item;
      })
    );

    // Rebuild HTML dynamically
    setTimeout(() => {
      setTexts((curr) => {
        setGeneratedHtml(buildHtmlFromTexts(curr, canvasInfo, colors));
        return curr;
      });
    }, 50);
  };

  // ── Delete Layer ──
  const deleteSelectedLayer = () => {
    if (selectedId === null) return;
    const remaining = texts.filter((t) => t.id !== selectedId);
    setTexts(remaining);
    setSelectedId(remaining.length > 0 ? remaining[0].id : null);
    setGeneratedHtml(buildHtmlFromTexts(remaining, canvasInfo, colors));
    showToast("লেয়ার মুছে ফেলা হয়েছে");
  };

  // ── Duplicate Layer ──
  const duplicateSelectedLayer = () => {
    if (selectedId === null) return;
    const target = texts.find((t) => t.id === selectedId);
    if (!target) return;
    const newId = String(Date.now());
    const [x, y, w, h] = target.box || [50, 50, 200, 30];
    const newElement = {
      ...target,
      id: newId,
      box: [x + 20, y + 20, w, h],
      text: `${target.text} (Copy)`,
    };
    const updated = [...texts, newElement];
    setTexts(updated);
    setSelectedId(newId);
    setGeneratedHtml(buildHtmlFromTexts(updated, canvasInfo, colors));
    showToast("লেয়ার ডুপ্লিকেট করা হয়েছে");
  };

  // ── Add New Text Layer ──
  const addNewTextLayer = () => {
    const newId = String(Date.now());
    const newElement = {
      id: newId,
      text: "নতুন লেখা যোগ করুন",
      box: [100, 100, 250, 40],
      font_size: 18,
      font_weight: "600",
      color: "#000000",
      align: "left",
    };
    const updated = [...texts, newElement];
    setTexts(updated);
    setSelectedId(newId);
    setGeneratedHtml(buildHtmlFromTexts(updated, canvasInfo, colors));
    showToast("নতুন টেক্সট লেয়ার যোগ করা হয়েছে");
  };

  // ── Export Tools ──
  const downloadHtmlFile = () => {
    if (!generatedHtml) return;
    const blob = new Blob([generatedHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `phototocode_export_${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("HTML ফাইল সফলভাবে ডাউনলোড হয়েছে! 📄");
  };

  const copyToClipboard = (content, label) => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    showToast(`${label} ক্লিপবোর্ডে কপি করা হয়েছে! 📋`);
  };

  // ── Split Slider Drag Mechanics ──
  const handleMouseDown = () => {
    isDragging.current = true;
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDragging.current || !splitRef.current) return;
      const rect = splitRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      setSliderPos(Math.round((x / rect.width) * 100));
    };
    const handleMouseUp = () => {
      isDragging.current = false;
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const selectedItem = texts.find((t) => t.id === selectedId);
  const filteredTexts = texts.filter((t) =>
    (t.text || "").toLowerCase().includes(searchLayer.toLowerCase())
  );

  return (
    <div className="flex flex-col min-h-screen bg-[#090a0f] text-slate-100 font-sans selection:bg-violet-500/30 selection:text-violet-200">
      {/* ── TOAST NOTIFICATION ── */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 bg-slate-900/90 text-white px-4 py-3 rounded-xl border border-violet-500/40 shadow-2xl backdrop-blur-xl animate-bounce">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
          <span className="text-xs font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* ── TOP NAVIGATION BAR ── */}
      <header className="sticky top-0 z-40 bg-[#0d0f18]/85 backdrop-blur-xl border-b border-[#1f2338] px-4 py-2.5 flex items-center justify-between gap-4">
        {/* Brand & Badge */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-violet-600 via-fuchsia-600 to-indigo-600 p-[1px] shadow-lg shadow-violet-600/30 flex items-center justify-center">
            <div className="w-full h-full bg-[#0d0f18] rounded-[11px] flex items-center justify-center font-black text-sm tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-fuchsia-400">
              AI
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-black tracking-tight text-white">PhotoToCode</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase bg-violet-500/20 text-violet-300 border border-violet-500/30 tracking-wider">
                Figma Studio v3 Pro
              </span>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              100% Uncensored · 0% Safety Filter · Client-Side Direct Execution
            </p>
          </div>
        </div>

        {/* View Mode Switcher (When Converted) */}
        {texts.length > 0 && (
          <div className="flex items-center bg-[#131624] p-1 rounded-xl border border-[#242842]">
            <button
              onClick={() => setViewMode("side-by-side")}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                viewMode === "side-by-side"
                  ? "bg-violet-600 text-white shadow-md shadow-violet-600/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span>🔲</span> 1:1 Side by Side
            </button>
            <button
              onClick={() => setViewMode("slider")}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                viewMode === "slider"
                  ? "bg-violet-600 text-white shadow-md shadow-violet-600/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span>↔️</span> Curtain Slider
            </button>
            <button
              onClick={() => setViewMode("overlay")}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                viewMode === "overlay"
                  ? "bg-violet-600 text-white shadow-md shadow-violet-600/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span>🔀</span> Diff Overlay
            </button>
            <button
              onClick={() => setViewMode("code")}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                viewMode === "code"
                  ? "bg-violet-600 text-white shadow-md shadow-violet-600/30"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              <span>💻</span> Code View
            </button>
          </div>
        )}

        {/* Right Tools: Zoom & Export */}
        <div className="flex items-center gap-2">
          {texts.length > 0 && (
            <>
              {/* Zoom Controls */}
              <div className="hidden md:flex items-center bg-[#131624] px-2 py-1 rounded-lg border border-[#242842] text-xs">
                <button
                  onClick={() => setZoom((z) => Math.max(25, z - 15))}
                  className="px-1.5 py-0.5 text-slate-400 hover:text-white"
                  title="Zoom Out"
                >
                  −
                </button>
                <span className="px-2 font-mono text-slate-200">{zoom}%</span>
                <button
                  onClick={() => setZoom((z) => Math.min(200, z + 15))}
                  className="px-1.5 py-0.5 text-slate-400 hover:text-white"
                  title="Zoom In"
                >
                  +
                </button>
                <button
                  onClick={() => setZoom(100)}
                  className="ml-1 px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-violet-300 font-semibold"
                >
                  Reset
                </button>
              </div>

              {/* Action Buttons */}
              <button
                onClick={downloadHtmlFile}
                className="px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-90 text-white font-bold text-xs rounded-lg shadow-md shadow-emerald-600/20 flex items-center gap-1.5 transition-all"
              >
                <span>💾</span> Download HTML
              </button>
              <button
                onClick={() => copyToClipboard(generatedHtml, "HTML")}
                className="px-3 py-1.5 bg-[#171a29] hover:bg-[#202438] border border-[#2a2f4c] text-slate-200 font-bold text-xs rounded-lg flex items-center gap-1.5 transition-all"
              >
                <span>📋</span> Copy Code
              </button>
              <button
                onClick={() => {
                  setTexts([]);
                  setGeneratedHtml("");
                  setFile(null);
                  setImagePreview(null);
                  setError(null);
                }}
                className="px-2.5 py-1.5 bg-[#1f1624] hover:bg-red-950/40 border border-red-500/30 text-red-300 font-bold text-xs rounded-lg transition-all"
                title="New Image"
              >
                🔄 New
              </button>
            </>
          )}

          {/* Engine Status Pill */}
          <div className="flex items-center gap-2 bg-[#121420] px-3 py-1.5 rounded-lg border border-[#23273e] text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                engine === "gemini"
                  ? keyStatus === "ok"
                    ? "bg-emerald-400 animate-pulse"
                    : "bg-amber-400"
                  : urlStatus === "ok"
                  ? "bg-emerald-400 animate-pulse"
                  : "bg-red-400"
              }`}
            />
            <span className="font-mono text-[11px] text-slate-300">
              {engine === "gemini" ? (keyStatus === "ok" ? `${activeModel} ✅` : "Key Needed") : urlStatus === "ok" ? "Colab T4 ✅" : "Colab Offline"}
            </span>
          </div>
        </div>
      </header>

      {/* ── TOP CONFIG & UPLOAD BAR (Always Accessible) ── */}
      <section className="bg-[#0e101b] border-b border-[#1b1e33] px-4 py-3">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* Card 1: Engine Switcher */}
          <div className="bg-[#141726] p-3 rounded-xl border border-[#242840] flex flex-col justify-between">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <span className="text-violet-400 font-mono">1.</span> AI Engine
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                0% Censorship · Safe
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => setEngine("gemini")}
                className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  engine === "gemini"
                    ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-md shadow-violet-600/30"
                    : "bg-[#1b1e33] text-slate-400 hover:text-white"
                }`}
              >
                <span>⚡</span> Google Gemini
              </button>
              <button
                onClick={() => setEngine("colab")}
                className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                  engine === "colab"
                    ? "bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-md shadow-amber-600/30"
                    : "bg-[#1b1e33] text-slate-400 hover:text-white"
                }`}
              >
                <span>⚡</span> Colab T4 GPU
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5">
              {engine === "gemini"
                ? "✓ 1,500 রিকোয়েস্ট/দিন সম্পূর্ণ ফ্রি · ব্রাউজার থেকে সরাসরি গুগল ফেচ (No Timeout)"
                : "✓ Colab ক্লাউডফ্লেয়ার টানেল · আনলিমিটেড ব্যাকএন্ড GPU"}
            </p>
          </div>

          {/* Card 2: API Key / Colab URL */}
          <div className="bg-[#141726] p-3 rounded-xl border border-[#242840] flex flex-col justify-between">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <span className="text-violet-400 font-mono">2.</span>{" "}
                {engine === "gemini" ? "Google AI Studio API Key" : "Colab Cloudflare URL"}
              </span>
              {engine === "gemini" && keyStatus === "ok" && (
                <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                  ✓ Validated
                </span>
              )}
              {engine === "colab" && urlStatus === "ok" && (
                <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
                  ✓ Connected
                </span>
              )}
            </div>

            <div className="flex gap-1.5 my-1">
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
                    onKeyDown={(e) => e.key === "Enter" && validateKeyWithGoogle()}
                    placeholder="AIzaSy... (Paste Free Gemini Key)"
                    className={`flex-1 px-2.5 py-1.5 bg-[#0b0d14] border rounded-lg text-white text-xs font-mono focus:outline-none transition-colors ${
                      keyStatus === "ok"
                        ? "border-emerald-500/60"
                        : keyStatus === "error"
                        ? "border-red-500/60"
                        : "border-[#2b304d] focus:border-violet-500"
                    }`}
                  />
                  <button
                    onClick={() => validateKeyWithGoogle()}
                    disabled={!geminiKey.trim() || keyStatus === "validating"}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                      keyStatus === "ok"
                        ? "bg-emerald-600/30 text-emerald-300 border border-emerald-500/40"
                        : keyStatus === "validating"
                        ? "bg-yellow-500/20 text-yellow-400 animate-pulse"
                        : "bg-violet-600 hover:bg-violet-500 text-white"
                    }`}
                  >
                    {keyStatus === "validating" ? "..." : keyStatus === "ok" ? "Validated ✓" : "Validate"}
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    value={colabUrl}
                    onChange={(e) => {
                      setColabUrl(e.target.value);
                      setUrlStatus("idle");
                    }}
                    onKeyDown={(e) => e.key === "Enter" && pingColab()}
                    placeholder="https://xxx.trycloudflare.com"
                    className="flex-1 px-2.5 py-1.5 bg-[#0b0d14] border border-[#2b304d] rounded-lg text-white text-xs font-mono focus:outline-none focus:border-amber-500"
                  />
                  <button
                    onClick={() => pingColab()}
                    disabled={!colabUrl.trim() || urlStatus === "checking"}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold transition-all whitespace-nowrap"
                  >
                    {urlStatus === "checking" ? "..." : urlStatus === "ok" ? "Connected ✓" : "Connect"}
                  </button>
                </>
              )}
            </div>

            {engine === "gemini" ? (
              <div className="flex items-center justify-between text-[10px]">
                <a
                  href="https://aistudio.google.com/app/apikey"
                  target="_blank"
                  rel="noreferrer"
                  className="text-violet-400 hover:underline font-semibold"
                >
                  🔑 ফ্রি API Key নিন (aistudio.google.com)
                </a>
                {keyError && <span className="text-red-400 font-medium">✕ {keyError}</span>}
              </div>
            ) : (
              <p className="text-[10px] text-slate-400">
                Colab রান করে পাওয়া Cloudflare URL টি দিন।
              </p>
            )}
          </div>

          {/* Card 3: Image Upload & Convert Action */}
          <div className="bg-[#141726] p-3 rounded-xl border border-[#242840] flex flex-col justify-between">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <span className="text-violet-400 font-mono">3.</span> Upload & Convert
              </span>
              {file && (
                <span className="text-[10px] text-slate-400 truncate max-w-[120px]">
                  {file.name}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 my-1">
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                onChange={(e) => handleImageFile(e.target.files[0])}
                className="hidden"
              />
              <button
                onClick={() => inputRef.current?.click()}
                className="flex-1 py-1.5 px-3 bg-[#1d2138] hover:bg-[#272d4c] border border-[#2f3559] text-slate-200 text-xs font-semibold rounded-lg transition-all flex items-center justify-center gap-1.5 truncate"
              >
                <span>📷</span> {file ? "Change Image" : "Select Image"}
              </button>
              <button
                onClick={startAnalyze}
                disabled={!file || loading || (engine === "gemini" ? keyStatus !== "ok" : urlStatus !== "ok")}
                className="flex-1 py-1.5 px-4 bg-gradient-to-r from-violet-600 via-fuchsia-600 to-indigo-600 hover:opacity-95 disabled:opacity-40 text-white font-bold text-xs rounded-lg shadow-md shadow-violet-600/30 transition-all flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                {loading ? `⏳ Processing (${elapsed}s)` : "🚀 Convert to Figma"}
              </button>
            </div>

            <p className="text-[10px] text-slate-400">
              Deed (দলিল), Invoice, Form, বা UI ডিজাইন দিন—নিখুঁত এডিটেবল হবে।
            </p>
          </div>
        </div>

        {/* Global Error Banner */}
        {error && (
          <div className="max-w-7xl mx-auto mt-2 bg-red-950/60 border border-red-500/50 text-red-200 px-3 py-2 rounded-xl text-xs flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="font-bold">✕ Error:</span> {error}
            </span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-white text-sm">
              ✕
            </button>
          </div>
        )}

        {/* Loading Progress Bar */}
        {loading && (
          <div className="max-w-7xl mx-auto mt-2.5 bg-[#121422] p-2.5 rounded-xl border border-violet-500/30 shadow-lg">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-semibold text-violet-300 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-violet-400 animate-ping" />
                {progressStage || "AI Processing image..."}
              </span>
              <span className="font-mono text-slate-400">{elapsed}s elapsed</span>
            </div>
            <div className="w-full bg-[#1e2238] h-1.5 rounded-full overflow-hidden">
              <div className="bg-gradient-to-r from-violet-500 via-fuchsia-500 to-teal-400 h-full w-full animate-shimmer" />
            </div>
          </div>
        )}
      </section>

      {/* ── MAIN WORKSPACE AREA ── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {texts.length === 0 ? (
          /* ── EMPTY / WELCOME LANDING STATE ── */
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
            <div className="max-w-xl p-8 rounded-3xl bg-gradient-to-b from-[#141728] to-[#0c0e18] border border-[#252945] shadow-2xl relative overflow-hidden">
              <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-gradient-to-tr from-violet-600 via-fuchsia-600 to-indigo-600 flex items-center justify-center text-4xl shadow-xl shadow-violet-600/30">
                🖼️
              </div>
              <h2 className="text-2xl font-black text-white mb-2 tracking-tight">
                যেকোনো ইমেজকে এডিটেবল Figma ক্লোন বানান
              </h2>
              <p className="text-sm text-slate-400 mb-6 leading-relaxed">
                জমিজমার দলিল, চালান, সরকারি ফর্ম, রশিদ বা পোস্টারের ছবি দিন। AI তাৎক্ষণিকভাবে
                বাংলা ও ইংরেজির প্রতিটি লেখা শনাক্ত করে ১:১ এডিটেবল HTML/CSS ক্যানভাস বানিয়ে দিবে।
              </p>

              <div
                onClick={() => inputRef.current?.click()}
                className="border-2 border-dashed border-violet-500/40 hover:border-violet-400 bg-violet-500/5 hover:bg-violet-500/10 p-6 rounded-2xl cursor-pointer transition-all mb-4 group"
              >
                <div className="text-3xl mb-2 group-hover:scale-110 transition-transform">📂</div>
                <p className="text-xs font-bold text-white mb-1">
                  এখানে ক্লিক করে ছবি নির্বাচন করুন (অথবা ড্র্যাগ করে আনুন)
                </p>
                <p className="text-[11px] text-slate-400">PNG, JPG, WebP, Scan কপি গ্রহণযোগ্য</p>
              </div>

              {imagePreview && (
                <div className="mt-4 p-3 bg-[#0d0f1a] rounded-xl border border-[#22263d] flex items-center gap-3 text-left">
                  <img src={imagePreview} alt="Upload" className="w-14 h-14 object-cover rounded-lg border border-slate-700" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-white truncate">{file?.name}</p>
                    <p className="text-[11px] text-slate-400">
                      {imageDimensions.width} × {imageDimensions.height} px
                    </p>
                  </div>
                  <button
                    onClick={startAnalyze}
                    disabled={loading || (engine === "gemini" ? keyStatus !== "ok" : urlStatus !== "ok")}
                    className="px-4 py-2 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-bold text-xs rounded-lg shadow-md hover:opacity-95"
                  >
                    Start Convert 🚀
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ── FIGMA STUDIO PRO WORKSPACE ── */
          <div className="flex-1 flex overflow-hidden">
            {/* ── LEFT PANEL: LAYERS & CANVAS SETTINGS ── */}
            <aside className="w-72 bg-[#0e101c] border-r border-[#1e2238] flex flex-col shrink-0">
              {/* Header */}
              <div className="p-3 border-b border-[#1e2238] flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-2">
                  <span>📑</span> Layers ({texts.length})
                </span>
                <button
                  onClick={addNewTextLayer}
                  className="px-2 py-1 bg-violet-600/30 hover:bg-violet-600/50 border border-violet-500/40 text-violet-200 text-[11px] font-bold rounded-md transition-all flex items-center gap-1"
                >
                  <span>+</span> Add Text
                </button>
              </div>

              {/* Layer Search */}
              <div className="p-2 border-b border-[#1e2238]">
                <input
                  type="text"
                  placeholder="সার্চ লেয়ার..."
                  value={searchLayer}
                  onChange={(e) => setSearchLayer(e.target.value)}
                  className="w-full px-2.5 py-1.5 bg-[#090a12] border border-[#242842] rounded-lg text-xs text-white focus:outline-none focus:border-violet-500"
                />
              </div>

              {/* Layers List */}
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {filteredTexts.map((item, idx) => {
                  const isSelected = item.id === selectedId;
                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`px-2.5 py-2 rounded-lg cursor-pointer transition-all flex items-center justify-between gap-2 border text-xs ${
                        isSelected
                          ? "bg-violet-600/20 border-violet-500/60 text-white shadow-sm"
                          : "bg-[#131626]/60 hover:bg-[#191d33] border-transparent text-slate-300"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-[10px] text-slate-500 shrink-0">
                          #{idx + 1}
                        </span>
                        <span className="truncate font-medium">{item.text || "(Empty)"}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono shrink-0">
                        {item.font_size}px
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Dominant Palette */}
              <div className="p-3 border-t border-[#1e2238] bg-[#090b14]">
                <div className="text-[11px] font-bold text-slate-400 mb-1.5">Color Palette</div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <div
                    className="w-6 h-6 rounded-md border border-white/20 shadow-sm"
                    style={{ backgroundColor: colors.dominant || "#ffffff" }}
                    title={`Dominant: ${colors.dominant}`}
                  />
                  {(colors.palette || []).map((c, i) => (
                    <div
                      key={i}
                      className="w-6 h-6 rounded-md border border-white/20 shadow-sm"
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>
              </div>
            </aside>

            {/* ── CENTER CANVAS VIEW ── */}
            <section className="flex-1 bg-[#090a10] canvas-grid flex flex-col overflow-hidden relative">
              {/* Secondary Sub-Bar */}
              <div className="bg-[#111320]/80 backdrop-blur-md px-4 py-1.5 border-b border-[#1d2138] flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <span className="text-slate-400 font-mono text-[11px]">
                    Canvas: {canvasInfo.width} × {canvasInfo.height} px
                  </span>
                  <label className="flex items-center gap-1.5 text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showBoxes}
                      onChange={(e) => setShowBoxes(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-violet-600 focus:ring-0"
                    />
                    <span>Highlight Elements</span>
                  </label>
                </div>

                {viewMode === "slider" && (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-[11px]">Wipe Curtain:</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={sliderPos}
                      onChange={(e) => setSliderPos(Number(e.target.value))}
                      className="w-32 accent-violet-500"
                    />
                    <span className="font-mono text-[11px] text-violet-300">{sliderPos}%</span>
                  </div>
                )}

                {viewMode === "overlay" && (
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400 text-[11px]">Overlay Opacity:</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={overlayOpacity}
                      onChange={(e) => setOverlayOpacity(Number(e.target.value))}
                      className="w-32 accent-violet-500"
                    />
                    <span className="font-mono text-[11px] text-violet-300">{overlayOpacity}%</span>
                  </div>
                )}
              </div>

              {/* View Container */}
              <div className="flex-1 overflow-auto p-6 flex items-start justify-center">
                {/* 1. SIDE-BY-SIDE MODE (1:1) */}
                {viewMode === "side-by-side" && (
                  <div
                    className="flex gap-6 items-start transition-transform origin-top"
                    style={{ transform: `scale(${zoom / 100})` }}
                  >
                    {/* Left: Original Image */}
                    <div className="flex flex-col items-center">
                      <div className="text-xs font-bold text-slate-400 mb-2 flex items-center gap-1.5">
                        <span>📷</span> Original Uploaded Image
                      </div>
                      <div
                        className="relative rounded-xl overflow-hidden border border-slate-700 shadow-2xl bg-black"
                        style={{ width: canvasInfo.width, height: canvasInfo.height }}
                      >
                        <img
                          src={imagePreview}
                          alt="Original"
                          className="w-full h-full object-contain pointer-events-none"
                        />
                        {/* Overlay Bounding Boxes */}
                        {showBoxes &&
                          texts.map((t) => {
                            const [x, y, w, h] = t.box || [0, 0, 50, 20];
                            const isSelected = t.id === selectedId;
                            return (
                              <div
                                key={t.id}
                                onClick={() => setSelectedId(t.id)}
                                className={`absolute cursor-pointer border transition-all ${
                                  isSelected
                                    ? "border-violet-400 bg-violet-500/30 z-20"
                                    : "border-emerald-400/40 hover:border-emerald-400 bg-emerald-500/10 z-10"
                                }`}
                                style={{ left: x, top: y, width: w, height: h }}
                                title={t.text}
                              />
                            );
                          })}
                      </div>
                    </div>

                    {/* Right: Editable HTML Render */}
                    <div className="flex flex-col items-center">
                      <div className="text-xs font-bold text-violet-400 mb-2 flex items-center gap-1.5">
                        <span>✨</span> Pixel-Perfect Editable Figma Clone
                      </div>
                      <div
                        className="relative rounded-xl overflow-hidden border border-violet-500/40 shadow-2xl"
                        style={{
                          width: canvasInfo.width,
                          height: canvasInfo.height,
                          backgroundColor: colors.dominant || "#ffffff",
                        }}
                      >
                        {texts.map((t) => {
                          const [x, y, w, h] = t.box || [0, 0, 100, 30];
                          const isSelected = t.id === selectedId;
                          return (
                            <div
                              key={t.id}
                              onClick={() => setSelectedId(t.id)}
                              className={`absolute cursor-text select-text transition-all leading-snug ${
                                isSelected
                                  ? "ring-2 ring-violet-500 ring-offset-1 ring-offset-black/50 z-20"
                                  : "hover:outline hover:outline-1 hover:outline-violet-400/60 z-10"
                              }`}
                              style={{
                                left: x,
                                top: y,
                                width: w,
                                minHeight: h,
                                fontSize: `${t.font_size || 14}px`,
                                fontWeight: t.font_weight || "normal",
                                color: t.color || "#000000",
                                textAlign: t.align || "left",
                                fontFamily: "'Hind Siliguri', 'Inter', sans-serif",
                                whiteSpace: "pre-wrap",
                              }}
                            >
                              {t.text}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. CURTAIN SLIDER MODE */}
                {viewMode === "slider" && (
                  <div
                    ref={splitRef}
                    className="relative select-none shadow-2xl rounded-xl overflow-hidden border border-slate-700 cursor-ew-resize transition-transform origin-top"
                    style={{
                      width: canvasInfo.width,
                      height: canvasInfo.height,
                      transform: `scale(${zoom / 100})`,
                    }}
                  >
                    {/* Bottom: Original Image */}
                    <img
                      src={imagePreview}
                      alt="Original"
                      className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                    />

                    {/* Top: Rendered Clone clipped by sliderPos */}
                    <div
                      className="absolute inset-0 overflow-hidden"
                      style={{
                        clipPath: `polygon(0 0, ${sliderPos}% 0, ${sliderPos}% 100%, 0 100%)`,
                        backgroundColor: colors.dominant || "#ffffff",
                      }}
                    >
                      {texts.map((t) => {
                        const [x, y, w, h] = t.box || [0, 0, 100, 30];
                        return (
                          <div
                            key={t.id}
                            className="absolute"
                            style={{
                              left: x,
                              top: y,
                              width: w,
                              minHeight: h,
                              fontSize: `${t.font_size || 14}px`,
                              fontWeight: t.font_weight || "normal",
                              color: t.color || "#000000",
                              textAlign: t.align || "left",
                              fontFamily: "'Hind Siliguri', 'Inter', sans-serif",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {t.text}
                          </div>
                        );
                      })}
                    </div>

                    {/* Draggable Divider Line */}
                    <div
                      onMouseDown={handleMouseDown}
                      className="absolute top-0 bottom-0 w-1 bg-white shadow-2xl z-30 cursor-ew-resize flex items-center justify-center"
                      style={{ left: `${sliderPos}%` }}
                    >
                      <div className="w-7 h-7 rounded-full bg-violet-600 text-white flex items-center justify-center text-xs shadow-lg border border-white">
                        ↔
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. DIFF OVERLAY MODE */}
                {viewMode === "overlay" && (
                  <div
                    className="relative select-none shadow-2xl rounded-xl overflow-hidden border border-slate-700 transition-transform origin-top"
                    style={{
                      width: canvasInfo.width,
                      height: canvasInfo.height,
                      transform: `scale(${zoom / 100})`,
                    }}
                  >
                    <img
                      src={imagePreview}
                      alt="Original"
                      className="absolute inset-0 w-full h-full object-cover"
                    />
                    <div
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        opacity: overlayOpacity / 100,
                        backgroundColor: colors.dominant || "#ffffff",
                      }}
                    >
                      {texts.map((t) => {
                        const [x, y, w, h] = t.box || [0, 0, 100, 30];
                        return (
                          <div
                            key={t.id}
                            className="absolute"
                            style={{
                              left: x,
                              top: y,
                              width: w,
                              minHeight: h,
                              fontSize: `${t.font_size || 14}px`,
                              fontWeight: t.font_weight || "normal",
                              color: t.color || "#000000",
                              textAlign: t.align || "left",
                              fontFamily: "'Hind Siliguri', 'Inter', sans-serif",
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {t.text}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 4. CODE VIEW */}
                {viewMode === "code" && (
                  <div className="w-full max-w-4xl h-full flex flex-col bg-[#0f111c] rounded-2xl border border-[#232742] overflow-hidden shadow-2xl">
                    <div className="bg-[#141726] px-4 py-2.5 border-b border-[#232742] flex items-center justify-between">
                      <div className="flex gap-2">
                        <button
                          onClick={() => setCodeTab("html")}
                          className={`px-3 py-1 text-xs font-bold rounded-lg ${
                            codeTab === "html" ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"
                          }`}
                        >
                          index.html
                        </button>
                        <button
                          onClick={() => setCodeTab("json")}
                          className={`px-3 py-1 text-xs font-bold rounded-lg ${
                            codeTab === "json" ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"
                          }`}
                        >
                          elements.json
                        </button>
                      </div>
                      <button
                        onClick={() =>
                          copyToClipboard(
                            codeTab === "html" ? generatedHtml : JSON.stringify(texts, null, 2),
                            codeTab.toUpperCase()
                          )
                        }
                        className="px-3 py-1 bg-violet-600/30 hover:bg-violet-600/50 border border-violet-500/40 text-violet-200 text-xs font-bold rounded-lg"
                      >
                        Copy {codeTab.toUpperCase()}
                      </button>
                    </div>
                    <div className="flex-1 p-4 overflow-auto">
                      <pre className="text-xs font-mono text-emerald-300 leading-relaxed whitespace-pre-wrap selection:bg-violet-600/40">
                        {codeTab === "html" ? generatedHtml : JSON.stringify(texts, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* ── RIGHT PANEL: FIGMA PROPERTY INSPECTOR ── */}
            <aside className="w-80 bg-[#0e101c] border-l border-[#1e2238] flex flex-col shrink-0">
              <div className="p-3 border-b border-[#1e2238] flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <span>🎨</span> Inspector
                </span>
                {selectedItem && (
                  <span className="text-[10px] font-mono bg-violet-500/20 text-violet-300 px-2 py-0.5 rounded border border-violet-500/30">
                    #el-{selectedItem.id}
                  </span>
                )}
              </div>

              {selectedItem ? (
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {/* Live Text Editing */}
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 block mb-1">
                      Text Content (সরাসরি এডিট করুন)
                    </label>
                    <textarea
                      rows={4}
                      value={selectedItem.text || ""}
                      onChange={(e) => updateSelectedText("text", e.target.value)}
                      className="w-full px-3 py-2 bg-[#090a12] border border-[#242842] rounded-xl text-xs text-white focus:outline-none focus:border-violet-500 font-sans leading-relaxed"
                    />
                  </div>

                  {/* Font Size & Weight */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] font-bold text-slate-400 block mb-1">
                        Font Size (px)
                      </label>
                      <input
                        type="number"
                        min="8"
                        max="120"
                        value={selectedItem.font_size || 14}
                        onChange={(e) => updateSelectedText("font_size", Number(e.target.value))}
                        className="w-full px-2.5 py-1.5 bg-[#090a12] border border-[#242842] rounded-lg text-xs text-white focus:outline-none focus:border-violet-500 font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-slate-400 block mb-1">
                        Weight
                      </label>
                      <select
                        value={selectedItem.font_weight || "normal"}
                        onChange={(e) => updateSelectedText("font_weight", e.target.value)}
                        className="w-full px-2 py-1.5 bg-[#090a12] border border-[#242842] rounded-lg text-xs text-white focus:outline-none focus:border-violet-500"
                      >
                        <option value="normal">Normal (400)</option>
                        <option value="500">Medium (500)</option>
                        <option value="600">SemiBold (600)</option>
                        <option value="bold">Bold (700)</option>
                      </select>
                    </div>
                  </div>

                  {/* Text Color */}
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 block mb-1">
                      Color (রং)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={selectedItem.color?.startsWith("#") ? selectedItem.color : "#000000"}
                        onChange={(e) => updateSelectedText("color", e.target.value)}
                        className="w-8 h-8 rounded-lg bg-transparent border border-slate-700 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={selectedItem.color || "#000000"}
                        onChange={(e) => updateSelectedText("color", e.target.value)}
                        className="flex-1 px-2.5 py-1.5 bg-[#090a12] border border-[#242842] rounded-lg text-xs text-white font-mono focus:outline-none focus:border-violet-500"
                      />
                    </div>
                  </div>

                  {/* Alignment */}
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 block mb-1">
                      Alignment
                    </label>
                    <div className="grid grid-cols-3 gap-1.5 bg-[#090a12] p-1 rounded-lg border border-[#242842]">
                      {["left", "center", "right"].map((align) => (
                        <button
                          key={align}
                          onClick={() => updateSelectedText("align", align)}
                          className={`py-1 text-xs font-semibold rounded capitalize ${
                            selectedItem.align === align
                              ? "bg-violet-600 text-white"
                              : "text-slate-400 hover:text-white"
                          }`}
                        >
                          {align}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Spatial Box (X, Y, W, H) */}
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 block mb-1">
                      Coordinates (X, Y, Width, Height)
                    </label>
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <div className="flex items-center gap-1.5 bg-[#090a12] px-2 py-1.5 rounded-lg border border-[#242842]">
                        <span className="text-slate-500">X:</span>
                        <input
                          type="number"
                          value={selectedItem.box?.[0] || 0}
                          onChange={(e) => {
                            const b = [...(selectedItem.box || [0, 0, 100, 30])];
                            b[0] = Number(e.target.value);
                            updateSelectedText("box", b);
                          }}
                          className="w-full bg-transparent text-white focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 bg-[#090a12] px-2 py-1.5 rounded-lg border border-[#242842]">
                        <span className="text-slate-500">Y:</span>
                        <input
                          type="number"
                          value={selectedItem.box?.[1] || 0}
                          onChange={(e) => {
                            const b = [...(selectedItem.box || [0, 0, 100, 30])];
                            b[1] = Number(e.target.value);
                            updateSelectedText("box", b);
                          }}
                          className="w-full bg-transparent text-white focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 bg-[#090a12] px-2 py-1.5 rounded-lg border border-[#242842]">
                        <span className="text-slate-500">W:</span>
                        <input
                          type="number"
                          value={selectedItem.box?.[2] || 100}
                          onChange={(e) => {
                            const b = [...(selectedItem.box || [0, 0, 100, 30])];
                            b[2] = Number(e.target.value);
                            updateSelectedText("box", b);
                          }}
                          className="w-full bg-transparent text-white focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-1.5 bg-[#090a12] px-2 py-1.5 rounded-lg border border-[#242842]">
                        <span className="text-slate-500">H:</span>
                        <input
                          type="number"
                          value={selectedItem.box?.[3] || 30}
                          onChange={(e) => {
                            const b = [...(selectedItem.box || [0, 0, 100, 30])];
                            b[3] = Number(e.target.value);
                            updateSelectedText("box", b);
                          }}
                          className="w-full bg-transparent text-white focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Actions: Duplicate & Delete */}
                  <div className="pt-2 border-t border-[#1e2238] flex gap-2">
                    <button
                      onClick={duplicateSelectedLayer}
                      className="flex-1 py-1.5 bg-[#171a2b] hover:bg-[#22263d] border border-[#2a2f4c] text-slate-200 rounded-lg text-xs font-semibold"
                    >
                      Duplicate
                    </button>
                    <button
                      onClick={deleteSelectedLayer}
                      className="flex-1 py-1.5 bg-red-950/40 hover:bg-red-900/50 border border-red-500/40 text-red-300 rounded-lg text-xs font-semibold"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-500 text-xs">
                  <span className="text-2xl mb-2">👆</span>
                  <span>যেকোনো টেক্সট লেয়ার সিলেক্ট করুন প্রপার্টি এডিট করার জন্য।</span>
                </div>
              )}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
