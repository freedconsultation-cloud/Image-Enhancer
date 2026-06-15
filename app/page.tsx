"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// ─── Enhancement pipeline ────────────────────────────────────────────────────

function clipPercentile(values: number[], lo = 0.01, hi = 0.99): [number, number] {
  const sorted = [...values].sort((a, b) => a - b);
  return [sorted[Math.floor(sorted.length * lo)], sorted[Math.floor(sorted.length * hi)]];
}

function autoLevels(data: Uint8ClampedArray) {
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
  }
  const [rlo, rhi] = clipPercentile(rs);
  const [glo, ghi] = clipPercentile(gs);
  const [blo, bhi] = clipPercentile(bs);

  for (let i = 0; i < data.length; i += 4) {
    data[i]     = Math.min(255, Math.max(0, ((data[i]     - rlo) / (rhi - rlo || 1)) * 255));
    data[i + 1] = Math.min(255, Math.max(0, ((data[i + 1] - glo) / (ghi - glo || 1)) * 255));
    data[i + 2] = Math.min(255, Math.max(0, ((data[i + 2] - blo) / (bhi - blo || 1)) * 255));
  }
}

function sCurve(v: number): number {
  const t = v / 255;
  // Mild S-curve: darkens shadows, brightens highlights
  const out = t < 0.5
    ? 2 * t * t
    : 1 - Math.pow(-2 * t + 2, 2) / 2;
  return Math.min(255, Math.max(0, out * 255));
}

function applyContrast(data: Uint8ClampedArray) {
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = sCurve(data[i]);
    data[i + 1] = sCurve(data[i + 1]);
    data[i + 2] = sCurve(data[i + 2]);
  }
}

function boostVibrance(data: Uint8ClampedArray, amount = 0.35) {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const boost = amount * (1 - sat); // boost more when less saturated
    const avg = (r + g + b) / 3;
    data[i]     = Math.min(255, Math.max(0, (r + (r - avg) * boost) * 255));
    data[i + 1] = Math.min(255, Math.max(0, (g + (g - avg) * boost) * 255));
    data[i + 2] = Math.min(255, Math.max(0, (b + (b - avg) * boost) * 255));
  }
}

function convolve(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  kernel: number[]
): Uint8ClampedArray {
  const k = Math.round(Math.sqrt(kernel.length));
  const half = Math.floor(k / 2);
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = 0; ky < k; ky++) {
        for (let kx = 0; kx < k; kx++) {
          const px = Math.min(width - 1, Math.max(0, x + kx - half));
          const py = Math.min(height - 1, Math.max(0, y + ky - half));
          const idx = (py * width + px) * 4;
          const w = kernel[ky * k + kx];
          r += data[idx] * w;
          g += data[idx + 1] * w;
          b += data[idx + 2] * w;
        }
      }
      const idx = (y * width + x) * 4;
      out[idx]     = Math.min(255, Math.max(0, r));
      out[idx + 1] = Math.min(255, Math.max(0, g));
      out[idx + 2] = Math.min(255, Math.max(0, b));
      out[idx + 3] = data[idx + 3];
    }
  }
  return out;
}

function sharpen(data: Uint8ClampedArray, width: number, height: number, amount = 0.5): Uint8ClampedArray {
  // Gaussian blur then unsharp mask: out = orig + amount * (orig - blur)
  const gaussKernel = [
    1 / 16, 2 / 16, 1 / 16,
    2 / 16, 4 / 16, 2 / 16,
    1 / 16, 2 / 16, 1 / 16,
  ];
  const blurred = convolve(data, width, height, gaussKernel);
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      out[i + c] = Math.min(255, Math.max(0, data[i + c] + amount * (data[i + c] - blurred[i + c])));
    }
    out[i + 3] = data[i + 3];
  }
  return out;
}

function enhance(imageEl: HTMLImageElement): string {
  const MAX = 2400;
  let { naturalWidth: w, naturalHeight: h } = imageEl;
  if (w > MAX || h > MAX) {
    const scale = MAX / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(imageEl, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  autoLevels(imgData.data);
  applyContrast(imgData.data);
  boostVibrance(imgData.data);
  const sharpened = sharpen(imgData.data, w, h, 0.6);
  for (let i = 0; i < sharpened.length; i++) imgData.data[i] = sharpened[i];
  ctx.putImageData(imgData, 0, 0);

  return canvas.toDataURL("image/png");
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function Home() {
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [enhancedUrl, setEnhancedUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [fileName, setFileName] = useState("enhanced");
  const [sliderPos, setSliderPos] = useState(50);
  const [dragging, setDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const compareRef = useRef<HTMLDivElement>(null);

  const processFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    const baseName = file.name.replace(/\.[^.]+$/, "");
    setFileName(baseName);
    setProcessing(true);
    setEnhancedUrl(null);
    setSliderPos(50);

    const url = URL.createObjectURL(file);
    setOriginalUrl(url);

    const img = new Image();
    img.onload = () => {
      // Yield to let React paint the loading state first
      setTimeout(() => {
        const result = enhance(img);
        setEnhancedUrl(result);
        setProcessing(false);
      }, 50);
    };
    img.src = url;
  }, []);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  // Slider drag
  const startDrag = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      const container = compareRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const pos = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
      setSliderPos(pos);
    };
    const up = () => setDragging(false);
    window.addEventListener("mousemove", move);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("mouseup", up);
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchend", up);
    };
  }, [dragging]);

  const download = () => {
    if (!enhancedUrl) return;
    // Blob URL approach works on iOS Safari; plain data URL + a.click() does not
    const arr = enhancedUrl.split(",");
    const mime = arr[0].match(/:(.*?);/)![1];
    const bytes = atob(arr[1]);
    const buf = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
    const blob = new Blob([buf], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${fileName}-enhanced.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const reset = () => {
    setOriginalUrl(null);
    setEnhancedUrl(null);
    setProcessing(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const hasResult = originalUrl && enhancedUrl;

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)" }}>
      {/* Nav */}
      <nav
        className="flex items-center justify-between px-8 py-4 sticky top-0 z-10"
        style={{ background: "var(--background)", borderBottom: "1px solid var(--border)" }}
      >
        <span className="font-bold font-mono text-sm" style={{ color: "var(--accent)" }}>
          {"</>"}
        </span>
        <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
          Image Enhancer
        </span>
        <a
          href="https://freedprojects.vercel.app"
          className="text-xs hover:opacity-70 transition-opacity"
          style={{ color: "var(--text-muted)" }}
        >
          ← Portfolio
        </a>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-10 flex flex-col gap-8">
        {/* Hero */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold" style={{ color: "var(--foreground)" }}>
            Auto Image Enhancer
          </h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            Drop any photo and get an instantly enhanced version — better exposure, sharper details, more vibrant colors.
          </p>
        </div>

        {/* Upload zone */}
        {!originalUrl && (
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={onDrop}
            className="flex flex-col items-center justify-center gap-4 rounded-xl cursor-pointer transition-all duration-150"
            style={{
              minHeight: 280,
              border: `2px dashed ${isDragOver ? "var(--accent)" : "var(--border)"}`,
              background: isDragOver ? "var(--accent-bg)" : "var(--surface)",
            }}
          >
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                Drop an image here or click to upload
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                PNG, JPG, JPEG, WEBP supported
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={onFileChange}
              className="hidden"
            />
          </div>
        )}

        {/* Processing state */}
        {originalUrl && processing && (
          <div
            className="flex flex-col items-center justify-center gap-4 rounded-xl"
            style={{ minHeight: 280, background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <div
              className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: "var(--border)", borderTopColor: "var(--accent)" }}
            />
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              Enhancing your image…
            </p>
          </div>
        )}

        {/* Before / After comparison */}
        {hasResult && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-4 text-xs" style={{ color: "var(--text-muted)" }}>
                <span>← Original</span>
                <span>Enhanced →</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={reset}
                  className="text-xs px-3 py-1.5 rounded transition-opacity hover:opacity-70"
                  style={{
                    background: "var(--surface-2)",
                    color: "var(--text-muted)",
                    border: "1px solid var(--border)",
                  }}
                >
                  New image
                </button>
                <button
                  onClick={download}
                  className="text-xs px-3 py-1.5 rounded font-medium transition-opacity hover:opacity-80"
                  style={{ background: "var(--accent-bg)", color: "var(--accent)", border: "1px solid var(--accent)" }}
                >
                  Download PNG
                </button>
              </div>
            </div>

            {/* Comparison slider */}
            <div
              ref={compareRef}
              className="relative rounded-xl overflow-hidden select-none"
              style={{
                border: "1px solid var(--border)",
                cursor: dragging ? "ew-resize" : "default",
                maxHeight: 600,
              }}
            >
              {/* Original — full width, clipped right half */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={originalUrl}
                alt="Original"
                className="block w-full"
                style={{ maxHeight: 600, objectFit: "contain", background: "var(--surface)" }}
                draggable={false}
              />

              {/* Enhanced — overlaid, clipped to left of slider */}
              <div
                className="absolute inset-0"
                style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={enhancedUrl}
                  alt="Enhanced"
                  className="block w-full h-full"
                  style={{ maxHeight: 600, objectFit: "contain", background: "var(--surface)" }}
                  draggable={false}
                />
              </div>

              {/* Slider handle */}
              <div
                className="absolute top-0 bottom-0 flex items-center justify-center"
                style={{ left: `${sliderPos}%`, transform: "translateX(-50%)", zIndex: 10 }}
                onMouseDown={startDrag}
                onTouchStart={startDrag}
              >
                <div className="w-0.5 h-full" style={{ background: "rgba(255,255,255,0.9)" }} />
                <div
                  className="absolute flex items-center justify-center w-11 h-11 rounded-full shadow-lg cursor-ew-resize"
                  style={{ background: "#fff" }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M4 7H1M10 7h3M4 4l-3 3 3 3M10 4l3 3-3 3" stroke="#0d1117" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>

              {/* Labels */}
              <div
                className="absolute bottom-3 left-3 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                style={{ background: "rgba(0,0,0,0.55)", color: "#fff" }}
              >
                BEFORE
              </div>
              <div
                className="absolute bottom-3 right-3 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                style={{ background: "rgba(248,131,121,0.85)", color: "#fff" }}
              >
                AFTER
              </div>
            </div>

            <p className="text-xs text-center" style={{ color: "var(--text-muted)" }}>
              Slide the handle to compare · Processes entirely in your browser — nothing is uploaded
            </p>
          </div>
        )}

        {/* Pipeline info */}
        <div
          className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2"
          style={{ color: "var(--text-muted)" }}
        >
          {[
            { label: "Auto Levels", desc: "Stretches the histogram to fix exposure" },
            { label: "Contrast Boost", desc: "S-curve to deepen shadows & pop highlights" },
            { label: "Vibrance", desc: "Lifts dull colors without oversaturating" },
            { label: "Sharpening", desc: "Unsharp mask restores fine detail" },
          ].map(({ label, desc }) => (
            <div
              key={label}
              className="p-3 rounded-lg text-xs"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <p className="font-semibold mb-1" style={{ color: "var(--accent)" }}>
                {label}
              </p>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
