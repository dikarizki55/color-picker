import { useState, useRef, useEffect } from "react";
import "./App.css";
import {
  rgbToHex,
  rgbToHsl,
  rgbToLab,
  deltaE00,
  deltaE76,
  getDeltaEInterpretation,
  type LAB,
  type HSL,
  type RGB,
} from "./utils/colorConversions";

interface ColorPick {
  id: number; // numbered 1 to 6
  color: string; // hex
  rgb: RGB;
  lab: LAB;
  hsl: HSL;
  xPercent: number; // percentage coordinate relative to canvas
  yPercent: number;
}

interface MagnifierState {
  show: boolean;
  x: number; // pixel coordinate relative to display canvas
  y: number;
  color: string;
  rgb: RGB;
  xPercent: number;
  yPercent: number;
  imgX: number; // pixel coordinate relative to original image size
  imgY: number;
}

const SAMPLE_IMAGES = [
  {
    name: "Pastel Macarons",
    url: "https://images.unsplash.com/photo-1569864358642-9d1684040f43?q=80&w=800&auto=format&fit=crop",
  },
];

const formatDiff = (valA: number, valB: number, unit: string = "") => {
  const diff = valB - valA;
  const fixedDiff = parseFloat(diff.toFixed(1));
  if (fixedDiff > 0) {
    return {
      text: `+${fixedDiff}${unit}`,
      className: "diff-positive",
    };
  } else if (fixedDiff < 0) {
    return {
      text: `${fixedDiff}${unit}`,
      className: "diff-negative",
    };
  } else {
    return {
      text: `0${unit}`,
      className: "diff-neutral",
    };
  }
};

export default function App() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  // Picks and details state
  const [picks, setPicks] = useState<ColorPick[]>([]);
  const [activePickId, setActivePickId] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [draggingPinId, setDraggingPinId] = useState<number | null>(null);
  const [blurRadius, setBlurRadius] = useState<number>(0);
  const [blurInputStr, setBlurInputStr] = useState<string>("0");
  const [zoomScale, setZoomScale] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [interactionMode, setInteractionMode] = useState<"pick" | "pan">("pick");

  // Comparison state
  const [compareIdA, setCompareIdA] = useState<number | null>(null);
  const [compareIdB, setCompareIdB] = useState<number | null>(null);

  // Magnifier Loupe state
  const [magnifier, setMagnifier] = useState<MagnifierState>({
    show: false,
    x: 0,
    y: 0,
    color: "#000000",
    rgb: { r: 0, g: 0, b: 0 },
    xPercent: 0,
    yPercent: 0,
    imgX: 0,
    imgY: 0,
  });

  // Toasts
  const [toast, setToast] = useState<{
    message: string;
    type: "info" | "error";
  } | null>(null);

  // HTML Element Refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Panning and pinching refs
  const touchStartDist = useRef<number | null>(null);
  const touchStartScale = useRef<number>(1);
  const panStartOffset = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pointerStartPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Show auto-expiring toast notifications
  const showToast = (message: string, type: "info" | "error" = "info") => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Load and render selected image to display canvas
  const loadImage = (src: string, name: string) => {
    setIsLoading(true);
    setPicks([]);
    setActivePickId(null);
    setCompareIdA(null);
    setCompareIdB(null);
    setImageName(name);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imgRef.current = img;
      setImageSrc(src);
      setIsLoading(false);
    };
    img.onerror = () => {
      setIsLoading(false);
      showToast(
        "Failed to load image. If it's a web link, CORS might be blocked.",
        "error",
      );
    };
    img.src = src;
  };

  // Draw image on canvas when imageSrc or blurRadius changes
  useEffect(() => {
    if (imageSrc && canvasRef.current && imgRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        // Set canvas resolution matching image natural size
        canvas.width = imgRef.current.naturalWidth;
        canvas.height = imgRef.current.naturalHeight;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Apply blur to canvas backing store if set (using bilinear offscreen scaling for iOS compatibility)
        if (blurRadius > 0) {
          const tempCanvas = document.createElement("canvas");
          const scale = 1 / (1 + blurRadius * 0.3);
          
          tempCanvas.width = Math.max(1, Math.round(canvas.width * scale));
          tempCanvas.height = Math.max(1, Math.round(canvas.height * scale));
          
          const tempCtx = tempCanvas.getContext("2d");
          if (tempCtx) {
            tempCtx.imageSmoothingEnabled = true;
            tempCtx.drawImage(imgRef.current, 0, 0, tempCanvas.width, tempCanvas.height);
            
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height);
          }
        } else {
          ctx.drawImage(imgRef.current, 0, 0);
        }

        // Re-sample all existing pin swatches based on the blurred canvas values
        if (picks.length > 0) {
          setPicks((prevPicks) =>
            prevPicks.map((p) => {
              const imgX = Math.floor((p.xPercent / 100) * canvas.width);
              const imgY = Math.floor((p.yPercent / 100) * canvas.height);

              const clampedX = Math.max(0, Math.min(canvas.width - 1, imgX));
              const clampedY = Math.max(0, Math.min(canvas.height - 1, imgY));

              try {
                const imgData = ctx.getImageData(clampedX, clampedY, 1, 1).data;
                const r = imgData[0];
                const g = imgData[1];
                const b = imgData[2];
                const hex = rgbToHex(r, g, b);
                const hsl = rgbToHsl(r, g, b);
                const lab = rgbToLab(r, g, b);

                return {
                  ...p,
                  color: hex,
                  rgb: { r, g, b },
                  hsl,
                  lab,
                };
              } catch (err) {
                console.error("Sampling error during blur re-sample:", err);
                return p;
              }
            }),
          );
        }
      }
    }
  }, [imageSrc, blurRadius]);

  // Keep manual input string in sync when blurRadius changes from slider or reset
  useEffect(() => {
    setBlurInputStr(blurRadius.toString());
  }, [blurRadius]);

  // Handle Magnifier update inside the loupe canvas
  useEffect(() => {
    if (magnifier.show && canvasRef.current && loupeCanvasRef.current) {
      const mainCanvas = canvasRef.current;
      const loupeCanvas = loupeCanvasRef.current;
      const lCtx = loupeCanvas.getContext("2d");

      if (lCtx) {
        lCtx.clearRect(0, 0, loupeCanvas.width, loupeCanvas.height);
        lCtx.imageSmoothingEnabled = false;

        const size = 9; // Zoom grid of 9x9 pixels
        const half = Math.floor(size / 2);

        // Draw the cropped portion centered on targeted pixel
        lCtx.drawImage(
          mainCanvas,
          magnifier.imgX - half,
          magnifier.imgY - half,
          size,
          size,
          0,
          0,
          loupeCanvas.width,
          loupeCanvas.height,
        );
      }
    }
  }, [magnifier]);

  // File Upload Handlers
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          loadImage(event.target.result as string, file.name);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Trigger camera capture or gallery
  const triggerCamera = () => cameraInputRef.current?.click();
  const triggerGallery = () => galleryInputRef.current?.click();

  // Reset application to initial welcome screen
  const handleReset = () => {
    setImageSrc(null);
    setImageName("");
    setPicks([]);
    setActivePickId(null);
    setCompareIdA(null);
    setCompareIdB(null);
    setBlurRadius(0);
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
    setInteractionMode("pick");
  };

  // Clear all picked colors on current image
  const handleClearPicks = () => {
    setPicks([]);
    setActivePickId(null);
    setCompareIdA(null);
    setCompareIdB(null);
    showToast("Cleared all color pins", "info");
  };

  // Blur filter controls
  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setBlurRadius(val);
  };

  // Zoom button handlers
  const handleZoomIn = () => {
    setZoomScale((prev) => {
      const next = Math.min(5, prev + 0.5);
      return parseFloat(next.toFixed(2));
    });
  };

  const handleZoomOut = () => {
    setZoomScale((prev) => {
      const next = Math.max(1, prev - 0.5);
      if (next === 1) {
        setPanOffset({ x: 0, y: 0 });
      }
      return parseFloat(next.toFixed(2));
    });
  };

  const handleZoomReset = () => {
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
  };

  // Pinch-to-zoom mobile gesture handlers
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      
      touchStartDist.current = dist;
      touchStartScale.current = zoomScale;
      panStartOffset.current = { ...panOffset };
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartDist.current !== null && e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      
      const ratio = dist / touchStartDist.current;
      const newScale = Math.max(1, Math.min(5, touchStartScale.current * ratio));
      
      setZoomScale(parseFloat(newScale.toFixed(2)));

      if (newScale === 1) {
        setPanOffset({ x: 0, y: 0 });
      }
    }
  };

  const handleTouchEnd = () => {
    touchStartDist.current = null;
  };

  const handleManualInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const valStr = e.target.value;
    setBlurInputStr(valStr);

    const parsed = parseFloat(valStr);
    if (!isNaN(parsed)) {
      const clamped = Math.max(0, Math.min(50, parsed));
      setBlurRadius(clamped);
    }
  };

  const handleManualBlur = () => {
    setBlurInputStr(blurRadius.toString());
  };

  // Clamping pan coordinates so the image doesn't slide completely off the screen
  const clampPan = (x: number, y: number, scale: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x, y };
    if (scale <= 1) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const maxPanX = ((rect.width / scale) * (scale - 1)) / 2;
    const maxPanY = ((rect.height / scale) * (scale - 1)) / 2;

    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, x)),
      y: Math.max(-maxPanY, Math.min(maxPanY, y)),
    };
  };

  // Process coordinates and extract RGB data from pointer events
  const processPointerEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();

    // Position of touch/mouse relative to canvas display bounding box
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    // Relative percentage coords [0, 1]
    const xRel = Math.max(0, Math.min(1, canvasX / rect.width));
    const yRel = Math.max(0, Math.min(1, canvasY / rect.height));

    // Map to backing canvas high-resolution image index
    const imgX = Math.floor(xRel * canvas.width);
    const imgY = Math.floor(yRel * canvas.height);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      // Sample 1x1 pixel data
      const imgData = ctx.getImageData(imgX, imgY, 1, 1).data;
      const r = imgData[0];
      const g = imgData[1];
      const b = imgData[2];
      const hex = rgbToHex(r, g, b);

      // Loupe position relative to the unzoomed outer .canvas-wrapper
      let loupeX = canvasX;
      let loupeY = canvasY;
      const wrapper = wrapperRef.current;
      if (wrapper) {
        const wRect = wrapper.getBoundingClientRect();
        loupeX = e.clientX - wRect.left;
        loupeY = e.clientY - wRect.top;
      }

      setMagnifier({
        show: true,
        x: loupeX,
        y: loupeY,
        color: hex,
        rgb: { r, g, b },
        xPercent: xRel * 100,
        yPercent: yRel * 100,
        imgX,
        imgY,
      });
    } catch (err) {
      console.error("Canvas sampling error:", err);
    }
  };

  // Pointer Down
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    const canvas = e.currentTarget;
    canvas.setPointerCapture(e.pointerId);

    if (interactionMode === "pan") {
      pointerStartPos.current = { x: e.clientX, y: e.clientY };
      panStartOffset.current = { ...panOffset };
      return;
    }

    processPointerEvent(e);
  };

  // Pointer Move
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;

    if (interactionMode === "pan") {
      const deltaX = e.clientX - pointerStartPos.current.x;
      const deltaY = e.clientY - pointerStartPos.current.y;
      const newX = panStartOffset.current.x + deltaX;
      const newY = panStartOffset.current.y + deltaY;
      setPanOffset(clampPan(newX, newY, zoomScale));
      return;
    }

    processPointerEvent(e);
  };

  // Pointer Up (Commit the picked color)
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    setIsDragging(false);

    const canvas = e.currentTarget;
    canvas.releasePointerCapture(e.pointerId);

    if (interactionMode === "pan") {
      return;
    }

    if (draggingPinId !== null) return;

    // Final sample check
    processPointerEvent(e);

    // Hide magnifier loupe
    setMagnifier((prev) => ({ ...prev, show: false }));

    if (picks.length >= 6) {
      showToast(
        "Color limit reached! Remove an existing pin to pick more (max 6).",
        "error",
      );
      return;
    }

    // Capture the final sampled color coordinates and metrics
    const { r, g, b } = magnifier.rgb;
    const hex = magnifier.color;
    const hsl = rgbToHsl(r, g, b);
    const lab = rgbToLab(r, g, b);

    // Find next available pin ID number (1-6)
    const activeIds = picks.map((p) => p.id);
    let nextId = 1;
    for (let i = 1; i <= 6; i++) {
      if (!activeIds.includes(i)) {
        nextId = i;
        break;
      }
    }

    const newPick: ColorPick = {
      id: nextId,
      color: hex,
      rgb: { r, g, b },
      hsl,
      lab,
      xPercent: magnifier.xPercent,
      yPercent: magnifier.yPercent,
    };

    const updatedPicks = [...picks, newPick].sort((a, b) => a.id - b.id);
    setPicks(updatedPicks);
    setActivePickId(nextId);

    // Automatically set up comparison for new colors
    if (updatedPicks.length === 2) {
      setCompareIdA(updatedPicks[0].id);
      setCompareIdB(updatedPicks[1].id);
    } else if (updatedPicks.length > 2) {
      // Auto shift compare selection to include the latest pick
      setCompareIdB(nextId);
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDragging(false);
    setMagnifier((prev) => ({ ...prev, show: false }));
    const canvas = e.currentTarget;
    canvas.releasePointerCapture(e.pointerId);
  };

  // Drag existing pin handlers
  const handlePinPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    pinId: number,
  ) => {
    e.stopPropagation();
    setIsDragging(true);
    setDraggingPinId(pinId);
    setActivePickId(pinId);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePinPointerMove = (
    e: React.PointerEvent<HTMLDivElement>,
    pinId: number,
  ) => {
    if (draggingPinId !== pinId) return;
    e.stopPropagation();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    const xRel = Math.max(0, Math.min(1, canvasX / rect.width));
    const yRel = Math.max(0, Math.min(1, canvasY / rect.height));

    const imgX = Math.floor(xRel * canvas.width);
    const imgY = Math.floor(yRel * canvas.height);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      const imgData = ctx.getImageData(imgX, imgY, 1, 1).data;
      const r = imgData[0];
      const g = imgData[1];
      const b = imgData[2];
      const hex = rgbToHex(r, g, b);
      const hsl = rgbToHsl(r, g, b);
      const lab = rgbToLab(r, g, b);

      setPicks((prevPicks) =>
        prevPicks.map((p) =>
          p.id === pinId
            ? {
                ...p,
                color: hex,
                rgb: { r, g, b },
                hsl,
                lab,
                xPercent: xRel * 100,
                yPercent: yRel * 100,
              }
            : p,
        ),
      );

      // Loupe position relative to the unzoomed outer .canvas-wrapper
      let loupeX = canvasX;
      let loupeY = canvasY;
      const wrapper = wrapperRef.current;
      if (wrapper) {
        const wRect = wrapper.getBoundingClientRect();
        loupeX = e.clientX - wRect.left;
        loupeY = e.clientY - wRect.top;
      }

      setMagnifier({
        show: true,
        x: loupeX,
        y: loupeY,
        color: hex,
        rgb: { r, g, b },
        xPercent: xRel * 100,
        yPercent: yRel * 100,
        imgX,
        imgY,
      });
    } catch (err) {
      console.error("Canvas sampling error during pin drag:", err);
    }
  };

  const handlePinPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setDraggingPinId(null);
    setIsDragging(false);
    setMagnifier((prev) => ({ ...prev, show: false }));
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const handlePinPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    setDraggingPinId(null);
    setIsDragging(false);
    setMagnifier((prev) => ({ ...prev, show: false }));
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // Delete specific color pick
  const handleDeletePick = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedPicks = picks.filter((p) => p.id !== id);
    setPicks(updatedPicks);

    if (activePickId === id) {
      setActivePickId(updatedPicks.length > 0 ? updatedPicks[0].id : null);
    }

    // Reset comparison choices if one of the chosen comparison colors is deleted
    if (compareIdA === id || compareIdB === id) {
      if (updatedPicks.length >= 2) {
        setCompareIdA(updatedPicks[0].id);
        setCompareIdB(updatedPicks[1].id);
      } else {
        setCompareIdA(null);
        setCompareIdB(null);
      }
    }
  };

  // Get active selected pick parameters
  const activePick = picks.find((p) => p.id === activePickId);

  // Delta E Calculations if we have at least 2 picks
  const colorA = picks.find((p) => p.id === compareIdA);
  const colorB = picks.find((p) => p.id === compareIdB);

  let delta00Score = 0;
  let delta76Score = 0;
  let deltaInterpretation = null;

  if (colorA && colorB) {
    delta00Score = deltaE00(colorA.lab, colorB.lab);
    delta76Score = deltaE76(colorA.lab, colorB.lab);
    deltaInterpretation = getDeltaEInterpretation(delta00Score);
  }

  return (
    <div className="app-container">
      {/* Hidden inputs for camera capture and file selection */}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={cameraInputRef}
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
      <input
        type="file"
        accept="image/*"
        ref={galleryInputRef}
        onChange={handleFileChange}
        style={{ display: "none" }}
      />

      {/* Header */}
      <header className="app-header glass">
        <div className="logo-group">
          <div className="logo-circle" />
          <span className="logo-text">DikaColorCompare</span>
        </div>
        <span className="version-badge">v1.1</span>
      </header>

      {/* Main Container */}
      <main className="app-main">
        {isLoading && (
          <div
            className="flex-center"
            style={{ flex: 1, flexDirection: "column", gap: "16px" }}
          >
            <div
              className="logo-circle"
              style={{
                width: "40px",
                height: "40px",
                animation: "pulseBorder 1.5s infinite",
              }}
            />
            <span
              style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}
            >
              Analyzing image channels...
            </span>
          </div>
        )}

        {/* 1. WELCOME SCREEN: IMAGE UPLOADER & CAMERA */}
        {!imageSrc && !isLoading && (
          <div className="welcome-container">
            <div className="welcome-hero">
              <h1>Compare Colors.</h1>
              <p>
                Upload any picture, drop high-precision pins, and measure color
                differences instantly using Delta E.
              </p>
            </div>

            <div
              className="upload-card glass-interactive"
              onClick={triggerGallery}
            >
              <div className="upload-icon-wrapper">
                <svg
                  width="24"
                  height="24"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <h3>Load Image</h3>
              <p>Tap to upload from your gallery or choose a file</p>

              <div className="upload-actions">
                <button
                  className="upload-btn glow-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerCamera();
                  }}
                >
                  <svg
                    width="18"
                    height="18"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                    />
                    <circle cx="12" cy="13" r="3" />
                  </svg>
                  Use Native Camera
                </button>
                <button className="upload-btn gallery-btn">
                  Browse Gallery
                </button>
              </div>
            </div>

            <div className="samples-section">
              <span className="samples-title">Or try a sample photo:</span>
              <div className="samples-grid">
                {SAMPLE_IMAGES.map((sample, idx) => (
                  <div
                    key={idx}
                    className="sample-thumbnail"
                    onClick={() => loadImage(sample.url, sample.name)}
                  >
                    <img src={sample.url} alt={sample.name} />
                    <div className="sample-label">{sample.name}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* 2. ACTIVE STUDIO: CANVAS + PIN LIST + CALCULATOR */}
        {imageSrc && !isLoading && (
          <div className="studio-container">
            {/* Toolbar */}
            <div className="studio-toolbar">
              <button className="toolbar-btn" onClick={handleReset}>
                <svg
                  width="16"
                  height="16"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
                Change Photo
              </button>

              <div
                className="logo-group"
                style={{ flexDirection: "column", gap: "2px" }}
              >
                <span className="pick-counter">{picks.length} / 6 Pins</span>
                {imageName && (
                  <span
                    style={{
                      fontSize: "0.65rem",
                      color: "var(--text-tertiary)",
                      maxWidth: "120px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {imageName}
                  </span>
                )}
              </div>

              <button
                className="toolbar-btn"
                onClick={handleClearPicks}
                disabled={picks.length === 0}
                style={{ opacity: picks.length === 0 ? 0.4 : 1 }}
              >
                Clear Pins
              </button>
            </div>

            {/* Interactive Canvas Viewport */}
            <div ref={wrapperRef} className="canvas-wrapper">
              {/* Floating Zoom & Mode Controls */}
              <div className="zoom-controls-overlay">
                {/* Select Mode / Pan Mode Switch */}
                <div className="mode-toggle-group glass">
                  <button
                    className={`control-btn ${interactionMode === "pick" ? "active-mode" : ""}`}
                    onClick={() => setInteractionMode("pick")}
                    title="Select / Drop Pin Mode"
                  >
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-6 6m0 0l-3-3m3 3V15" />
                    </svg>
                  </button>
                  <button
                    className={`control-btn ${interactionMode === "pan" ? "active-mode" : ""}`}
                    onClick={() => setInteractionMode("pan")}
                    title="Pan / Zoom Mode"
                  >
                    <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1" />
                    </svg>
                  </button>
                </div>

                {/* Zoom Actions Group */}
                <div className="zoom-actions-group glass">
                  <button className="control-btn" onClick={handleZoomIn} title="Zoom In">
                    ＋
                  </button>
                  <span className="zoom-value-label">{zoomScale}x</span>
                  <button className="control-btn" onClick={handleZoomOut} title="Zoom Out" disabled={zoomScale === 1}>
                    －
                  </button>
                  <button className="control-btn" onClick={handleZoomReset} title="Reset View" disabled={zoomScale === 1 && panOffset.x === 0 && panOffset.y === 0}>
                    ⟲
                  </button>
                </div>
              </div>

              {/* Zoomable / Pannable Workspace */}
              <div
                style={{
                  position: "relative",
                  display: "inline-block",
                  maxWidth: "100%",
                  transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
                  transformOrigin: "center center",
                  transition: isDragging ? "none" : "transform 0.15s ease-out",
                  touchAction: "none",
                }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
              >
                <canvas
                  ref={canvasRef}
                  className={`studio-canvas ${interactionMode === "pan" ? "pan-cursor" : ""}`}
                  style={{ touchAction: "none" }}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerCancel}
                />

                {/* Render circular interactive pin markers on canvas coordinates */}
                {picks.map((pick) => (
                  <div
                    key={pick.id}
                    className={`canvas-pin ${activePickId === pick.id ? "active" : ""} ${draggingPinId === pick.id ? "dragging" : ""}`}
                    onPointerDown={(e) => handlePinPointerDown(e, pick.id)}
                    onPointerMove={(e) => handlePinPointerMove(e, pick.id)}
                    onPointerUp={handlePinPointerUp}
                    onPointerCancel={handlePinPointerCancel}
                    style={{
                      left: `${pick.xPercent}%`,
                      top: `${pick.yPercent}%`,
                      backgroundColor: pick.color,
                      touchAction: "none",
                    }}
                  >
                    {pick.id}
                  </div>
                ))}
              </div>

              {/* Floating Magnifier Loupe (Rendered outside of the scaled inner container so it remains unscaled) */}
              {magnifier.show && (
                <div
                  className="loupe"
                  style={{
                    left: `${magnifier.x}px`,
                    top: `${magnifier.y}px`,
                  }}
                >
                  <canvas
                    ref={loupeCanvasRef}
                    width={120}
                    height={120}
                    className="loupe-canvas"
                  />
                  <div className="loupe-crosshair" />
                </div>
              )}
            </div>

            {/* Noise Reducer (Blur) Control Panel */}
            <div className="blur-panel glass">
              <div className="blur-header">
                <div className="blur-title">
                  <svg
                    width="14"
                    height="14"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m0-12.728l.707.707m11.314 11.314l.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z"
                    />
                  </svg>
                  <span>Noise Reducer (Blur)</span>
                </div>
                {blurRadius > 0 && (
                  <button
                    className="blur-reset-link"
                    onClick={() => setBlurRadius(0)}
                  >
                    Reset to Sharp
                  </button>
                )}
              </div>
              <div className="blur-controls">
                <input
                  type="range"
                  min="0"
                  max="30"
                  step="1"
                  value={blurRadius}
                  onChange={handleSliderChange}
                  className="blur-slider"
                />
                <div className="blur-input-container">
                  <input
                    type="number"
                    min="0"
                    max="50"
                    step="0.5"
                    value={blurInputStr}
                    onChange={handleManualInputChange}
                    onBlur={handleManualBlur}
                    className="blur-number-input"
                  />
                  <span className="blur-unit">px</span>
                </div>
              </div>
            </div>

            {/* Picked Colors List Section */}
            <div className="colors-grid-section">
              <div className="section-hdr">
                <h4>Picked Swatches</h4>
                {picks.length === 0 && (
                  <span className="helper-text">
                    Tap anywhere on the photo above to pick a color
                  </span>
                )}
                {picks.length > 0 && picks.length < 6 && (
                  <span className="helper-text">
                    Tap image to add up to {6 - picks.length} more
                  </span>
                )}
              </div>

              <div className="colors-grid">
                {picks.map((pick) => (
                  <div
                    key={pick.id}
                    className={`color-card glass-interactive ${activePickId === pick.id ? "active" : ""}`}
                    onClick={() => setActivePickId(pick.id)}
                  >
                    <button
                      className="delete-pin-btn"
                      onClick={(e) => handleDeletePick(pick.id, e)}
                    >
                      ×
                    </button>
                    <div
                      className="card-swatch"
                      style={{ backgroundColor: pick.color }}
                    >
                      {pick.id}
                    </div>
                    <span className="card-hex">{pick.color.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Selected Swatch Details */}
            {activePick && (
              <div className="color-details-panel glass">
                <div className="details-hdr">
                  <div className="details-title">
                    <div
                      style={{
                        width: "14px",
                        height: "14px",
                        borderRadius: "4px",
                        backgroundColor: activePick.color,
                        border: "1px solid var(--border-medium)",
                      }}
                    />
                    <span>Pin #{activePick.id} Details</span>
                  </div>
                  <span
                    style={{
                      fontSize: "0.75rem",
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    RGB({activePick.rgb.r}, {activePick.rgb.g},{" "}
                    {activePick.rgb.b})
                  </span>
                </div>

                <div className="details-values-row">
                  <div className="details-val-col">
                    <h5>CIE L*a*b*</h5>
                    <p>
                      L: {activePick.lab.l} a: {activePick.lab.a} b:{" "}
                      {activePick.lab.b}
                    </p>
                  </div>
                  <div className="details-val-col">
                    <h5>HSL</h5>
                    <p>
                      H: {activePick.hsl.h}° S: {activePick.hsl.s}% L:{" "}
                      {activePick.hsl.l}%
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Delta E Comparison Panel */}
            {picks.length >= 2 && (
              <div
                className="comparison-section glass"
                style={{
                  border: "1px solid var(--accent-border)",
                  background: "rgba(139, 92, 246, 0.03)",
                }}
              >
                <div className="comp-header">
                  <h3>Color Difference (Delta E)</h3>
                  {deltaInterpretation && (
                    <span
                      className={`delta-badge ${deltaInterpretation.className}`}
                    >
                      {deltaInterpretation.rating}
                    </span>
                  )}
                </div>

                {/* Dropdowns to select comparison pins */}
                <div className="selector-grid">
                  <div className="picker-select-wrapper">
                    <label htmlFor="compareA">Color A</label>
                    <select
                      id="compareA"
                      className="color-dropdown"
                      value={compareIdA || ""}
                      onChange={(e) => setCompareIdA(Number(e.target.value))}
                    >
                      {picks.map((p) => (
                        <option
                          key={p.id}
                          value={p.id}
                          disabled={p.id === compareIdB}
                        >
                          Pin #{p.id} ({p.color.toUpperCase()})
                        </option>
                      ))}
                    </select>
                  </div>

                  <span className="vs-divider flex-center">VS</span>

                  <div className="picker-select-wrapper">
                    <label htmlFor="compareB">Color B</label>
                    <select
                      id="compareB"
                      className="color-dropdown"
                      value={compareIdB || ""}
                      onChange={(e) => setCompareIdB(Number(e.target.value))}
                    >
                      {picks.map((p) => (
                        <option
                          key={p.id}
                          value={p.id}
                          disabled={p.id === compareIdA}
                        >
                          Pin #{p.id} ({p.color.toUpperCase()})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Split Color Swatch */}
                {colorA && colorB && (
                  <>
                    <div className="comparison-split-card">
                      <div
                        className="split-side side-a"
                        style={{ backgroundColor: colorA.color }}
                      >
                        <span className="split-badge">A (Pin {colorA.id})</span>
                        <span className="split-hex">
                          {colorA.color.toUpperCase()}
                        </span>
                      </div>
                      <div
                        className="split-side side-b"
                        style={{ backgroundColor: colorB.color }}
                      >
                        <span className="split-badge">B (Pin {colorB.id})</span>
                        <span className="split-hex">
                          {colorB.color.toUpperCase()}
                        </span>
                      </div>
                    </div>

                    <div className="delta-results-grid">
                      <div className="main-delta-box">
                        <div className="score-display">
                          <span className="delta-number">{delta00Score}</span>
                          <span className="delta-formula-label">
                            ΔE₀₀ (CIEDE2000)
                          </span>
                        </div>
                        {/* Gauge Meter */}
                        {deltaInterpretation && (
                          <div className="gauge-track">
                            <div
                              className={`gauge-bar ${deltaInterpretation.className}`}
                              style={{
                                width: `${deltaInterpretation.percent}%`,
                              }}
                            />
                          </div>
                        )}
                      </div>

                      <div className="interpretation-text">
                        {deltaInterpretation
                          ? deltaInterpretation.description
                          : ""}
                      </div>

                      <div className="delta-formula-row">
                        <span>CIE76 Difference (ΔE₇₆):</span>
                        <span>{delta76Score}</span>
                      </div>
                    </div>

                    {/* Comparison Swatches LAB & HSL Values Table */}
                    <div className="comp-table-wrapper">
                      <div className="comp-table-row header">
                        <div className="comp-cell metric">Metric</div>
                        <div className="comp-cell val-a">
                          Pin {colorA.id} (A)
                        </div>
                        <div className="comp-cell val-b">
                          Pin {colorB.id} (B)
                        </div>
                        <div className="comp-cell diff">Shift (B-A)</div>
                      </div>

                      <div className="comp-table-row">
                        <div className="comp-cell metric">Lightness (L*)</div>
                        <div className="comp-cell val-a">{colorA.lab.l}</div>
                        <div className="comp-cell val-b">{colorB.lab.l}</div>
                        <div
                          className={`comp-cell diff ${formatDiff(colorA.lab.l, colorB.lab.l).className}`}
                        >
                          {formatDiff(colorA.lab.l, colorB.lab.l).text}
                        </div>
                      </div>

                      <div className="comp-table-row">
                        <div className="comp-cell metric">Red/Green (a*)</div>
                        <div className="comp-cell val-a">{colorA.lab.a}</div>
                        <div className="comp-cell val-b">{colorB.lab.a}</div>
                        <div
                          className={`comp-cell diff ${formatDiff(colorA.lab.a, colorB.lab.a).className}`}
                        >
                          {formatDiff(colorA.lab.a, colorB.lab.a).text}
                        </div>
                      </div>

                      <div className="comp-table-row">
                        <div className="comp-cell metric">Yellow/Blue (b*)</div>
                        <div className="comp-cell val-a">{colorA.lab.b}</div>
                        <div className="comp-cell val-b">{colorB.lab.b}</div>
                        <div
                          className={`comp-cell diff ${formatDiff(colorA.lab.b, colorB.lab.b).className}`}
                        >
                          {formatDiff(colorA.lab.b, colorB.lab.b).text}
                        </div>
                      </div>

                      <div className="comp-table-row">
                        <div className="comp-cell metric">Hue (H)</div>
                        <div className="comp-cell val-a">{colorA.hsl.h}°</div>
                        <div className="comp-cell val-b">{colorB.hsl.h}°</div>
                        <div
                          className={`comp-cell diff ${formatDiff(colorA.hsl.h, colorB.hsl.h, "°").className}`}
                        >
                          {formatDiff(colorA.hsl.h, colorB.hsl.h, "°").text}
                        </div>
                      </div>

                      <div className="comp-table-row">
                        <div className="comp-cell metric">Saturation (S)</div>
                        <div className="comp-cell val-a">{colorA.hsl.s}%</div>
                        <div className="comp-cell val-b">{colorB.hsl.s}%</div>
                        <div
                          className={`comp-cell diff ${formatDiff(colorA.hsl.s, colorB.hsl.s, "%").className}`}
                        >
                          {formatDiff(colorA.hsl.s, colorB.hsl.s, "%").text}
                        </div>
                      </div>

                      <div className="comp-table-row">
                        <div className="comp-cell metric">Lightness (L)</div>
                        <div className="comp-cell val-a">{colorA.hsl.l}%</div>
                        <div className="comp-cell val-b">{colorB.hsl.l}%</div>
                        <div
                          className={`comp-cell diff ${formatDiff(colorA.hsl.l, colorB.hsl.l, "%").className}`}
                        >
                          {formatDiff(colorA.hsl.l, colorB.hsl.l, "%").text}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Floating alert toasts */}
      {toast && (
        <div className={`toast-msg ${toast.type}`}>{toast.message}</div>
      )}
    </div>
  );
}
