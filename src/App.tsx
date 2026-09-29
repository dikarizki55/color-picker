import { useState, useRef, useEffect, useCallback } from "react";
import "./App.css";
import {
  rgbToHex,
  rgbToHsl,
  rgbToLab,
  rgbToCmyk,
  deltaE00,
  deltaE76,
  getDeltaEInterpretation,
  type LAB,
  type HSL,
  type RGB,
  type CMYK,
} from "./utils/colorConversions";

interface ColorPick {
  id: number;
  color: string;
  rgb: RGB;
  lab: LAB;
  hsl: HSL;
  cmyk: CMYK;
  xPercent: number;
  yPercent: number;
}

interface MagnifierState {
  show: boolean;
  x: number;
  y: number;
  color: string;
  rgb: RGB;
  xPercent: number;
  yPercent: number;
  imgX: number;
  imgY: number;
}

interface WhiteBalanceState {
  enabled: boolean;
  reference: RGB | null;
  gain: RGB;
}

const SAMPLE_IMAGES = [
  {
    name: "Pastel Macarons",
    url: "https://images.unsplash.com/photo-1569864358642-9d1684040f43?q=80&w=800&auto=format&fit=crop",
  },
  {
    name: "Color Pallet",
    url: "https://images.unsplash.com/photo-1635536816492-9a6fb49354d3?q=80&w=756&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D",
  },
];

const formatDiff = (
  valA: number,
  valB: number,
  unit: string = "",
) => {
  const diff = valB - valA;
  const fixedDiff = parseFloat(diff.toFixed(1));

  if (fixedDiff > 0) {
    return {
      text: `+${fixedDiff}${unit}`,
      className: "diff-positive",
    };
  }

  if (fixedDiff < 0) {
    return {
      text: `${fixedDiff}${unit}`,
      className: "diff-negative",
    };
  }

  return {
    text: `0${unit}`,
    className: "diff-neutral",
  };
};

export default function App() {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  // ============================================================
  // COLOR PICKS
  // ============================================================

  const [picks, setPicks] = useState<ColorPick[]>([]);
  const [activePickId, setActivePickId] = useState<number | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [draggingPinId, setDraggingPinId] = useState<number | null>(null);

  // ============================================================
  // SAMPLING
  // ============================================================

  // 7 = 7x7 sampling area
  const [samplingSize, setSamplingSize] = useState<number>(7);

  // ============================================================
  // WHITE BALANCE
  // ============================================================

  const [whiteBalance, setWhiteBalance] =
    useState<WhiteBalanceState>({
      enabled: false,
      reference: null,
      gain: { r: 1, g: 1, b: 1 },
    });

  const [isPickingWhite, setIsPickingWhite] =
    useState<boolean>(false);

  // ============================================================
  // ZOOM / PAN
  // ============================================================

  const [zoomScale, setZoomScale] = useState<number>(1);

  const [panOffset, setPanOffset] = useState<{
    x: number;
    y: number;
  }>({
    x: 0,
    y: 0,
  });

  const [interactionMode, setInteractionMode] =
    useState<"pick" | "pan">("pick");

  // ============================================================
  // COMPARISON
  // ============================================================

  const [compareIdA, setCompareIdA] =
    useState<number | null>(null);

  const [compareIdB, setCompareIdB] =
    useState<number | null>(null);

  // ============================================================
  // MAGNIFIER
  // ============================================================

  const [magnifier, setMagnifier] =
    useState<MagnifierState>({
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

  // ============================================================
  // TOAST
  // ============================================================

  const [toast, setToast] = useState<{
    message: string;
    type: "info" | "error";
  } | null>(null);

  // ============================================================
  // REFS
  // ============================================================

  const canvasRef =
    useRef<HTMLCanvasElement | null>(null);

  const loupeCanvasRef =
    useRef<HTMLCanvasElement | null>(null);

  const cameraInputRef =
    useRef<HTMLInputElement | null>(null);

  const galleryInputRef =
    useRef<HTMLInputElement | null>(null);

  const imgRef =
    useRef<HTMLImageElement | null>(null);

  const wrapperRef =
    useRef<HTMLDivElement | null>(null);

  // Original unmodified image canvas.
  // This is important so white balance can always be recalculated
  // from the original image.
  const originalCanvasRef =
    useRef<HTMLCanvasElement | null>(null);

  // ============================================================
  // TOUCH / PAN REFS
  // ============================================================

  const touchStartDist =
    useRef<number | null>(null);

  const touchStartScale =
    useRef<number>(1);

  const panStartOffset =
    useRef<{ x: number; y: number }>({
      x: 0,
      y: 0,
    });

  const pointerStartPos =
    useRef<{ x: number; y: number }>({
      x: 0,
      y: 0,
    });

  // ============================================================
  // TOAST
  // ============================================================

  const showToast = (
    message: string,
    type: "info" | "error" = "info",
  ) => {
    setToast({
      message,
      type,
    });
  };

  useEffect(() => {
    if (!toast) return;

    const timer = setTimeout(() => {
      setToast(null);
    }, 3000);

    return () => clearTimeout(timer);
  }, [toast]);

  // ============================================================
  // IMAGE LOADING
  // ============================================================

  const loadImage = (
    src: string,
    name: string,
  ) => {
    setIsLoading(true);

    setPicks([]);
    setActivePickId(null);

    setCompareIdA(null);
    setCompareIdB(null);

    setWhiteBalance({
      enabled: false,
      reference: null,
      gain: {
        r: 1,
        g: 1,
        b: 1,
      },
    });

    setIsPickingWhite(false);

    setZoomScale(1);
    setPanOffset({
      x: 0,
      y: 0,
    });

    setImageName(name);

    const img = new Image();

    img.crossOrigin = "anonymous";

    img.onload = () => {
      imgRef.current = img;

      // Create original canvas
      const originalCanvas =
        document.createElement("canvas");

      originalCanvas.width =
        img.naturalWidth;

      originalCanvas.height =
        img.naturalHeight;

      const originalCtx =
        originalCanvas.getContext("2d", {
          willReadFrequently: true,
        });

      if (!originalCtx) {
        setIsLoading(false);

        showToast(
          "Unable to initialize image processing.",
          "error",
        );

        return;
      }

      originalCtx.drawImage(
        img,
        0,
        0,
        img.naturalWidth,
        img.naturalHeight,
      );

      originalCanvasRef.current =
        originalCanvas;

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

  // ============================================================
  // WHITE BALANCE CORRECTION
  // ============================================================

  /**
   * Clamp RGB channel to valid 0-255 range.
   */
  const clampChannel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)));

  /**
   * Apply white balance to original image.
   *
   * The reference is assumed to be a neutral white/gray area.
   *
   * We use a target around 230 rather than 255 to avoid
   * excessive highlight clipping.
   */
  const calculateWhiteBalanceGain = (
    reference: RGB,
  ): RGB => {
    const target = 230;

    const safeR = Math.max(reference.r, 1);
    const safeG = Math.max(reference.g, 1);
    const safeB = Math.max(reference.b, 1);

    return {
      r: target / safeR,
      g: target / safeG,
      b: target / safeB,
    };
  };

  /**
   * Apply RGB gain correction to the image.
   *
   * This is deliberately done from the ORIGINAL canvas.
   */
  const renderCorrectedImage = useCallback(
    (
      wb: WhiteBalanceState,
    ) => {
      const sourceCanvas =
        originalCanvasRef.current;

      const targetCanvas =
        canvasRef.current;

      if (!sourceCanvas || !targetCanvas) {
        return;
      }

      const sourceCtx =
        sourceCanvas.getContext("2d", {
          willReadFrequently: true,
        });

      const targetCtx =
        targetCanvas.getContext("2d", {
          willReadFrequently: true,
        });

      if (!sourceCtx || !targetCtx) {
        return;
      }

      const width =
        sourceCanvas.width;

      const height =
        sourceCanvas.height;

      targetCanvas.width = width;
      targetCanvas.height = height;

      const sourceImageData =
        sourceCtx.getImageData(
          0,
          0,
          width,
          height,
        );

      const sourceData =
        sourceImageData.data;

      const correctedImageData =
        targetCtx.createImageData(
          width,
          height,
        );

      const targetData =
        correctedImageData.data;

      const gain =
        wb.enabled
          ? wb.gain
          : {
              r: 1,
              g: 1,
              b: 1,
            };

      for (
        let i = 0;
        i < sourceData.length;
        i += 4
      ) {
        targetData[i] =
          clampChannel(
            sourceData[i] * gain.r,
          );

        targetData[i + 1] =
          clampChannel(
            sourceData[i + 1] * gain.g,
          );

        targetData[i + 2] =
          clampChannel(
            sourceData[i + 2] * gain.b,
          );

        // Keep alpha
        targetData[i + 3] =
          sourceData[i + 3];
      }

      targetCtx.putImageData(
        correctedImageData,
        0,
        0,
      );
    },
    [],
  );

  // ============================================================
  // SAMPLING
  // ============================================================

  /**
   * Returns median value from an array.
   */
  const median = (
    values: number[],
  ): number => {
    if (values.length === 0) {
      return 0;
    }

    const sorted = [...values].sort(
      (a, b) => a - b,
    );

    const middle =
      Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
      return (
        (sorted[middle - 1] +
          sorted[middle]) /
        2
      );
    }

    return sorted[middle];
  };

  /**
   * Sample a square area around x/y.
   *
   * Example:
   * 1 -> 1x1
   * 3 -> 3x3
   * 5 -> 5x5
   * 7 -> 7x7
   * 11 -> 11x11
   */
  const sampleAreaMedian = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
  ): RGB => {
    const canvas = ctx.canvas;

    const safeSize =
      Math.max(1, Math.floor(size));

    const half =
      Math.floor(safeSize / 2);

    const xStart = Math.max(
      0,
      Math.min(
        canvas.width - 1,
        x - half,
      ),
    );

    const yStart = Math.max(
      0,
      Math.min(
        canvas.height - 1,
        y - half,
      ),
    );

    const xEnd = Math.min(
      canvas.width - 1,
      x + half,
    );

    const yEnd = Math.min(
      canvas.height - 1,
      y + half,
    );

    const width =
      xEnd - xStart + 1;

    const height =
      yEnd - yStart + 1;

    const imageData =
      ctx.getImageData(
        xStart,
        yStart,
        width,
        height,
      ).data;

    const rs: number[] = [];
    const gs: number[] = [];
    const bs: number[] = [];

    for (
      let i = 0;
      i < imageData.length;
      i += 4
    ) {
      rs.push(imageData[i]);
      gs.push(imageData[i + 1]);
      bs.push(imageData[i + 2]);
    }

    return {
      r: Math.round(median(rs)),
      g: Math.round(median(gs)),
      b: Math.round(median(bs)),
    };
  };

  /**
   * Get current corrected image context.
   */
  const getCanvasContext =
    (): CanvasRenderingContext2D | null => {
      const canvas =
        canvasRef.current;

      if (!canvas) {
        return null;
      }

      return canvas.getContext(
        "2d",
        {
          willReadFrequently: true,
        },
      );
    };

  // ============================================================
  // DRAW IMAGE
  // ============================================================

  useEffect(() => {
    if (
      !imageSrc ||
      !canvasRef.current ||
      !originalCanvasRef.current
    ) {
      return;
    }

    renderCorrectedImage(
      whiteBalance,
    );
  }, [
    imageSrc,
    whiteBalance,
    renderCorrectedImage,
  ]);

  // ============================================================
  // RESAMPLE EXISTING PINS
  // ============================================================

  useEffect(() => {
    if (
      !imageSrc ||
      !canvasRef.current ||
      picks.length === 0
    ) {
      return;
    }

    const canvas =
      canvasRef.current;

    const ctx =
      getCanvasContext();

    if (!ctx) {
      return;
    }

    setPicks((prevPicks) =>
      prevPicks.map((p) => {
        const imgX = Math.floor(
          (p.xPercent / 100) *
            canvas.width,
        );

        const imgY = Math.floor(
          (p.yPercent / 100) *
            canvas.height,
        );

        const sampled =
          sampleAreaMedian(
            ctx,
            imgX,
            imgY,
            samplingSize,
          );

        const {
          r,
          g,
          b,
        } = sampled;

        const hex =
          rgbToHex(r, g, b);

        const hsl =
          rgbToHsl(r, g, b);

        const lab =
          rgbToLab(r, g, b);

        const cmyk =
          rgbToCmyk(r, g, b);

        return {
          ...p,
          color: hex,
          rgb: {
            r,
            g,
            b,
          },
          hsl,
          lab,
          cmyk,
        };
      }),
    );
  }, [
    imageSrc,
    whiteBalance,
    samplingSize,
  ]);

  // ============================================================
  // MAGNIFIER
  // ============================================================

  useEffect(() => {
    if (
      !magnifier.show ||
      !canvasRef.current ||
      !loupeCanvasRef.current
    ) {
      return;
    }

    const mainCanvas =
      canvasRef.current;

    const loupeCanvas =
      loupeCanvasRef.current;

    const lCtx =
      loupeCanvas.getContext("2d");

    if (!lCtx) {
      return;
    }

    lCtx.clearRect(
      0,
      0,
      loupeCanvas.width,
      loupeCanvas.height,
    );

    lCtx.imageSmoothingEnabled =
      false;

    const size = Math.max(
      9,
      samplingSize,
    );

    const half =
      Math.floor(size / 2);

    const sx = Math.max(
      0,
      Math.min(
        mainCanvas.width - size,
        magnifier.imgX - half,
      ),
    );

    const sy = Math.max(
      0,
      Math.min(
        mainCanvas.height - size,
        magnifier.imgY - half,
      ),
    );

    lCtx.drawImage(
      mainCanvas,
      sx,
      sy,
      Math.min(
        size,
        mainCanvas.width,
      ),
      Math.min(
        size,
        mainCanvas.height,
      ),
      0,
      0,
      loupeCanvas.width,
      loupeCanvas.height,
    );
  }, [
    magnifier,
    samplingSize,
  ]);

  // ============================================================
  // FILE UPLOAD
  // ============================================================

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = e.target.files;

    if (
      !files ||
      files.length === 0
    ) {
      return;
    }

    const file = files[0];

    const reader =
      new FileReader();

    reader.onload = (event) => {
      if (event.target?.result) {
        loadImage(
          event.target.result as string,
          file.name,
        );
      }
    };

    reader.readAsDataURL(file);

    // Allows selecting the same file again
    e.target.value = "";
  };

  const triggerCamera = () =>
    cameraInputRef.current?.click();

  const triggerGallery = () =>
    galleryInputRef.current?.click();

  // ============================================================
  // RESET
  // ============================================================

  const handleReset = () => {
    setImageSrc(null);
    setImageName("");

    setPicks([]);
    setActivePickId(null);

    setCompareIdA(null);
    setCompareIdB(null);

    setWhiteBalance({
      enabled: false,
      reference: null,
      gain: {
        r: 1,
        g: 1,
        b: 1,
      },
    });

    setIsPickingWhite(false);

    setZoomScale(1);

    setPanOffset({
      x: 0,
      y: 0,
    });

    setInteractionMode("pick");
  };

  const handleClearPicks = () => {
    setPicks([]);

    setActivePickId(null);

    setCompareIdA(null);
    setCompareIdB(null);

    showToast(
      "Cleared all color pins",
      "info",
    );
  };

  // ============================================================
  // WHITE BALANCE RESET
  // ============================================================

  const handleResetWhiteBalance = () => {
    setWhiteBalance({
      enabled: false,
      reference: null,
      gain: {
        r: 1,
        g: 1,
        b: 1,
      },
    });

    setIsPickingWhite(false);

    showToast(
      "White balance reset to original image",
      "info",
    );
  };

  // ============================================================
  // SAMPLING CONTROL
  // ============================================================

  const handleSamplingChange = (
    e: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    setSamplingSize(
      Number(e.target.value),
    );
  };

  // ============================================================
  // ZOOM
  // ============================================================

  const handleZoomIn = () => {
    setZoomScale((prev) => {
      const next = Math.min(
        5,
        prev + 0.5,
      );

      return parseFloat(
        next.toFixed(2),
      );
    });
  };

  const handleZoomOut = () => {
    setZoomScale((prev) => {
      const next = Math.max(
        1,
        prev - 0.5,
      );

      if (next === 1) {
        setPanOffset({
          x: 0,
          y: 0,
        });
      }

      return parseFloat(
        next.toFixed(2),
      );
    });
  };

  const handleZoomReset = () => {
    setZoomScale(1);

    setPanOffset({
      x: 0,
      y: 0,
    });
  };

  // ============================================================
  // PINCH ZOOM
  // ============================================================

  const handleTouchStart = (
    e: React.TouchEvent<HTMLDivElement>,
  ) => {
    if (e.touches.length === 2) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];

      const dist = Math.hypot(
        t1.clientX - t2.clientX,
        t1.clientY - t2.clientY,
      );

      touchStartDist.current =
        dist;

      touchStartScale.current =
        zoomScale;

      panStartOffset.current = {
        ...panOffset,
      };
    }
  };

  const handleTouchMove = (
    e: React.TouchEvent<HTMLDivElement>,
  ) => {
    if (
      touchStartDist.current !==
        null &&
      e.touches.length === 2
    ) {
      const t1 = e.touches[0];
      const t2 = e.touches[1];

      const dist = Math.hypot(
        t1.clientX - t2.clientX,
        t1.clientY - t2.clientY,
      );

      const ratio =
        dist /
        touchStartDist.current;

      const newScale = Math.max(
        1,
        Math.min(
          5,
          touchStartScale.current *
            ratio,
        ),
      );

      setZoomScale(
        parseFloat(
          newScale.toFixed(2),
        ),
      );

      if (newScale === 1) {
        setPanOffset({
          x: 0,
          y: 0,
        });
      }
    }
  };

  const handleTouchEnd = () => {
    touchStartDist.current =
      null;
  };

  // ============================================================
  // PAN
  // ============================================================

  const clampPan = (
    x: number,
    y: number,
    scale: number,
  ) => {
    const canvas =
      canvasRef.current;

    if (!canvas) {
      return {
        x,
        y,
      };
    }

    if (scale <= 1) {
      return {
        x: 0,
        y: 0,
      };
    }

    const rect =
      canvas.getBoundingClientRect();

    const maxPanX =
      ((rect.width / scale) *
        (scale - 1)) /
      2;

    const maxPanY =
      ((rect.height / scale) *
        (scale - 1)) /
      2;

    return {
      x: Math.max(
        -maxPanX,
        Math.min(
          maxPanX,
          x,
        ),
      ),
      y: Math.max(
        -maxPanY,
        Math.min(
          maxPanY,
          y,
        ),
      ),
    };
  };

  // ============================================================
  // SAMPLE POINTER
  // ============================================================

  interface PointerSample {
    rgb: RGB;
    hex: string;
    hsl: HSL;
    lab: LAB;
    cmyk: CMYK;
    xRel: number;
    yRel: number;
    imgX: number;
    imgY: number;
    loupeX: number;
    loupeY: number;
  }

  const samplePointerEvent = (
    e: React.PointerEvent<HTMLCanvasElement>,
  ): PointerSample | null => {
    const canvas =
      canvasRef.current;

    if (!canvas) {
      return null;
    }

    const rect =
      canvas.getBoundingClientRect();

    const canvasX =
      e.clientX -
      rect.left;

    const canvasY =
      e.clientY -
      rect.top;

    const xRel = Math.max(
      0,
      Math.min(
        1,
        canvasX / rect.width,
      ),
    );

    const yRel = Math.max(
      0,
      Math.min(
        1,
        canvasY / rect.height,
      ),
    );

    const imgX = Math.max(
      0,
      Math.min(
        canvas.width - 1,
        Math.floor(
          xRel * canvas.width,
        ),
      ),
    );

    const imgY = Math.max(
      0,
      Math.min(
        canvas.height - 1,
        Math.floor(
          yRel * canvas.height,
        ),
      ),
    );

    const ctx =
      getCanvasContext();

    if (!ctx) {
      return null;
    }

    try {
      const rgb =
        sampleAreaMedian(
          ctx,
          imgX,
          imgY,
          samplingSize,
        );

      const {
        r,
        g,
        b,
      } = rgb;

      const hex =
        rgbToHex(r, g, b);

      const hsl =
        rgbToHsl(r, g, b);

      const lab =
        rgbToLab(r, g, b);

      const cmyk =
        rgbToCmyk(r, g, b);

      let loupeX =
        canvasX;

      let loupeY =
        canvasY;

      const wrapper =
        wrapperRef.current;

      if (wrapper) {
        const wRect =
          wrapper.getBoundingClientRect();

        loupeX =
          e.clientX -
          wRect.left;

        loupeY =
          e.clientY -
          wRect.top;
      }

      return {
        rgb,
        hex,
        hsl,
        lab,
        cmyk,
        xRel,
        yRel,
        imgX,
        imgY,
        loupeX,
        loupeY,
      };
    } catch (err) {
      console.error(
        "Canvas sampling error:",
        err,
      );

      return null;
    }
  };

  // ============================================================
  // UPDATE MAGNIFIER
  // ============================================================

  const updateMagnifier = (
    sample: PointerSample,
  ) => {
    setMagnifier({
      show: true,

      x: sample.loupeX,
      y: sample.loupeY,

      color: sample.hex,

      rgb: sample.rgb,

      xPercent:
        sample.xRel * 100,

      yPercent:
        sample.yRel * 100,

      imgX: sample.imgX,
      imgY: sample.imgY,
    });
  };

  // ============================================================
  // WHITE BALANCE PICK
  // ============================================================

  const handleWhiteBalanceSample = (
    sample: PointerSample,
  ) => {
    const reference =
      sample.rgb;

    // Warn if selected area is extremely dark.
    if (
      reference.r < 40 &&
      reference.g < 40 &&
      reference.b < 40
    ) {
      showToast(
        "Please pick a white or neutral light-gray area.",
        "error",
      );

      return;
    }

    const gain =
      calculateWhiteBalanceGain(
        reference,
      );

    setWhiteBalance({
      enabled: true,
      reference,
      gain,
    });

    setIsPickingWhite(false);

    setMagnifier((prev) => ({
      ...prev,
      show: false,
    }));

    showToast(
      `White balance set from ${rgbToHex(
        reference.r,
        reference.g,
        reference.b,
      )}`,
      "info",
    );
  };

  // ============================================================
  // POINTER DOWN
  // ============================================================

  const handlePointerDown = (
    e: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    setIsDragging(true);

    const canvas =
      e.currentTarget;

    canvas.setPointerCapture(
      e.pointerId,
    );

    if (
      interactionMode === "pan"
    ) {
      pointerStartPos.current = {
        x: e.clientX,
        y: e.clientY,
      };

      panStartOffset.current = {
        ...panOffset,
      };

      return;
    }

    const sample =
      samplePointerEvent(e);

    if (!sample) {
      return;
    }

    updateMagnifier(sample);
  };

  // ============================================================
  // POINTER MOVE
  // ============================================================

  const handlePointerMove = (
    e: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    if (!isDragging) {
      return;
    }

    if (
      interactionMode === "pan"
    ) {
      const deltaX =
        e.clientX -
        pointerStartPos.current.x;

      const deltaY =
        e.clientY -
        pointerStartPos.current.y;

      const newX =
        panStartOffset.current.x +
        deltaX;

      const newY =
        panStartOffset.current.y +
        deltaY;

      setPanOffset(
        clampPan(
          newX,
          newY,
          zoomScale,
        ),
      );

      return;
    }

    const sample =
      samplePointerEvent(e);

    if (!sample) {
      return;
    }

    updateMagnifier(sample);
  };

  // ============================================================
  // POINTER UP
  // ============================================================

  const handlePointerUp = (
    e: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    if (!isDragging) {
      return;
    }

    setIsDragging(false);

    const canvas =
      e.currentTarget;

    try {
      canvas.releasePointerCapture(
        e.pointerId,
      );
    } catch {
      // Ignore release errors
    }

    if (
      interactionMode === "pan"
    ) {
      return;
    }

    if (
      draggingPinId !== null
    ) {
      return;
    }

    const sample =
      samplePointerEvent(e);

    if (!sample) {
      return;
    }

    // ========================================================
    // WHITE BALANCE MODE
    // ========================================================

    if (isPickingWhite) {
      handleWhiteBalanceSample(
        sample,
      );

      return;
    }

    // ========================================================
    // NORMAL COLOR PICK MODE
    // ========================================================

    setMagnifier((prev) => ({
      ...prev,
      show: false,
    }));

    if (picks.length >= 6) {
      showToast(
        "Color limit reached! Remove an existing pin to pick more (max 6).",
        "error",
      );

      return;
    }

    const {
      rgb,
      hex,
      hsl,
      lab,
      cmyk,
      xRel,
      yRel,
    } = sample;

    const activeIds =
      picks.map(
        (p) => p.id,
      );

    let nextId = 1;

    for (
      let i = 1;
      i <= 6;
      i++
    ) {
      if (
        !activeIds.includes(i)
      ) {
        nextId = i;
        break;
      }
    }

    const newPick: ColorPick = {
      id: nextId,

      color: hex,

      rgb,

      hsl,

      lab,

      cmyk,

      xPercent:
        xRel * 100,

      yPercent:
        yRel * 100,
    };

    const updatedPicks =
      [
        ...picks,
        newPick,
      ].sort(
        (a, b) =>
          a.id - b.id,
      );

    setPicks(
      updatedPicks,
    );

    setActivePickId(
      nextId,
    );

    if (
      updatedPicks.length === 2
    ) {
      setCompareIdA(
        updatedPicks[0].id,
      );

      setCompareIdB(
        updatedPicks[1].id,
      );
    } else if (
      updatedPicks.length > 2
    ) {
      setCompareIdB(
        nextId,
      );
    }
  };

  // ============================================================
  // POINTER CANCEL
  // ============================================================

  const handlePointerCancel = (
    e: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    setIsDragging(false);

    setMagnifier((prev) => ({
      ...prev,
      show: false,
    }));

    try {
      e.currentTarget.releasePointerCapture(
        e.pointerId,
      );
    } catch {
      // Ignore
    }
  };

  // ============================================================
  // PIN DRAG
  // ============================================================

  const handlePinPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    pinId: number,
  ) => {
    e.stopPropagation();

    setIsDragging(true);

    setDraggingPinId(
      pinId,
    );

    setActivePickId(
      pinId,
    );

    e.currentTarget.setPointerCapture(
      e.pointerId,
    );
  };

  const handlePinPointerMove = (
    e: React.PointerEvent<HTMLDivElement>,
    pinId: number,
  ) => {
    if (
      draggingPinId !== pinId
    ) {
      return;
    }

    e.stopPropagation();

    const canvas =
      canvasRef.current;

    if (!canvas) {
      return;
    }

    const rect =
      canvas.getBoundingClientRect();

    const canvasX =
      e.clientX -
      rect.left;

    const canvasY =
      e.clientY -
      rect.top;

    const xRel = Math.max(
      0,
      Math.min(
        1,
        canvasX / rect.width,
      ),
    );

    const yRel = Math.max(
      0,
      Math.min(
        1,
        canvasY / rect.height,
      ),
    );

    const imgX = Math.max(
      0,
      Math.min(
        canvas.width - 1,
        Math.floor(
          xRel * canvas.width,
        ),
      ),
    );

    const imgY = Math.max(
      0,
      Math.min(
        canvas.height - 1,
        Math.floor(
          yRel * canvas.height,
        ),
      ),
    );

    const ctx =
      getCanvasContext();

    if (!ctx) {
      return;
    }

    try {
      const rgb =
        sampleAreaMedian(
          ctx,
          imgX,
          imgY,
          samplingSize,
        );

      const {
        r,
        g,
        b,
      } = rgb;

      const hex =
        rgbToHex(r, g, b);

      const hsl =
        rgbToHsl(r, g, b);

      const lab =
        rgbToLab(r, g, b);

      const cmyk =
        rgbToCmyk(r, g, b);

      setPicks(
        (prevPicks) =>
          prevPicks.map(
            (p) =>
              p.id === pinId
                ? {
                    ...p,

                    color: hex,

                    rgb: {
                      r,
                      g,
                      b,
                    },

                    hsl,

                    lab,

                    cmyk,

                    xPercent:
                      xRel * 100,

                    yPercent:
                      yRel * 100,
                  }
                : p,
          ),
      );

      let loupeX =
        canvasX;

      let loupeY =
        canvasY;

      const wrapper =
        wrapperRef.current;

      if (wrapper) {
        const wRect =
          wrapper.getBoundingClientRect();

        loupeX =
          e.clientX -
          wRect.left;

        loupeY =
          e.clientY -
          wRect.top;
      }

      setMagnifier({
        show: true,

        x: loupeX,

        y: loupeY,

        color: hex,

        rgb: {
          r,
          g,
          b,
        },

        xPercent:
          xRel * 100,

        yPercent:
          yRel * 100,

        imgX,

        imgY,
      });
    } catch (err) {
      console.error(
        "Canvas sampling error during pin drag:",
        err,
      );
    }
  };

  const handlePinPointerUp = (
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    e.stopPropagation();

    setDraggingPinId(
      null,
    );

    setIsDragging(false);

    setMagnifier((prev) => ({
      ...prev,
      show: false,
    }));

    try {
      e.currentTarget.releasePointerCapture(
        e.pointerId,
      );
    } catch {
      // Ignore
    }
  };

  const handlePinPointerCancel = (
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    e.stopPropagation();

    setDraggingPinId(
      null,
    );

    setIsDragging(false);

    setMagnifier((prev) => ({
      ...prev,
      show: false,
    }));

    try {
      e.currentTarget.releasePointerCapture(
        e.pointerId,
      );
    } catch {
      // Ignore
    }
  };

  // ============================================================
  // DELETE PICK
  // ============================================================

  const handleDeletePick = (
    id: number,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();

    const updatedPicks =
      picks.filter(
        (p) => p.id !== id,
      );

    setPicks(
      updatedPicks,
    );

    if (
      activePickId === id
    ) {
      setActivePickId(
        updatedPicks.length >
          0
          ? updatedPicks[0].id
          : null,
      );
    }

    if (
      compareIdA === id ||
      compareIdB === id
    ) {
      if (
        updatedPicks.length >= 2
      ) {
        setCompareIdA(
          updatedPicks[0].id,
        );

        setCompareIdB(
          updatedPicks[1].id,
        );
      } else {
        setCompareIdA(null);
        setCompareIdB(null);
      }
    }
  };

  // ============================================================
  // ACTIVE COLOR
  // ============================================================

  const activePick =
    picks.find(
      (p) =>
        p.id === activePickId,
    );

  // ============================================================
  // DELTA E
  // ============================================================

  const colorA =
    picks.find(
      (p) =>
        p.id === compareIdA,
    );

  const colorB =
    picks.find(
      (p) =>
        p.id === compareIdB,
    );

  let delta00Score = 0;
  let delta76Score = 0;
  let deltaInterpretation =
    null;

  if (
    colorA &&
    colorB
  ) {
    delta00Score =
      deltaE00(
        colorA.lab,
        colorB.lab,
      );

    delta76Score =
      deltaE76(
        colorA.lab,
        colorB.lab,
      );

    deltaInterpretation =
      getDeltaEInterpretation(
        delta00Score,
      );
  }

    // ============================================================
  // COLOR ADJUSTMENT GUIDANCE
  // ============================================================

  const getColorAdjustmentGuidance = () => {
    if (!colorA || !colorB) {
      return null;
    }

    const tolerance = 0.5;

    const cmyk = [
      {
        key: "c",
        label: "Cyan",
        valueA: colorA.cmyk.c,
        valueB: colorB.cmyk.c,
      },
      {
        key: "m",
        label: "Magenta",
        valueA: colorA.cmyk.m,
        valueB: colorB.cmyk.m,
      },
      {
        key: "y",
        label: "Yellow",
        valueA: colorA.cmyk.y,
        valueB: colorB.cmyk.y,
      },
      {
        key: "k",
        label: "Black",
        valueA: colorA.cmyk.k,
        valueB: colorB.cmyk.k,
      },
    ];

    const lab = [
      {
        key: "l",
        label: "Lightness",
        valueA: colorA.lab.l,
        valueB: colorB.lab.l,
      },
      {
        key: "a",
        label: "Red / Green",
        valueA: colorA.lab.a,
        valueB: colorB.lab.a,
      },
      {
        key: "b",
        label: "Yellow / Blue",
        valueA: colorA.lab.b,
        valueB: colorB.lab.b,
      },
    ];

    const getDirection = (
      valueA: number,
      valueB: number,
      positiveText: string,
      negativeText: string,
    ) => {
      const difference = valueA - valueB;

      if (Math.abs(difference) <= tolerance) {
        return {
          direction: "No significant change",
          difference: 0,
          className: "neutral",
        };
      }

      if (difference > 0) {
        return {
          direction: positiveText,
          difference,
          className: "increase",
        };
      }

      return {
        direction: negativeText,
        difference,
        className: "decrease",
      };
    };

    const cmykGuidance = cmyk.map((item) => {
      const result = getDirection(
        item.valueA,
        item.valueB,
        `Need more ${item.label}`,
        `Need less ${item.label}`,
      );

      return {
        ...item,
        ...result,
      };
    });

    const labGuidance = [
      {
        ...lab[0],
        ...getDirection(
          lab[0].valueA,
          lab[0].valueB,
          "Need brighter",
          "Need darker",
        ),
      },
      {
        ...lab[1],
        ...getDirection(
          lab[1].valueA,
          lab[1].valueB,
          "Need more Red",
          "Need more Green",
        ),
      },
      {
        ...lab[2],
        ...getDirection(
          lab[2].valueA,
          lab[2].valueB,
          "Need more Yellow",
          "Need more Blue",
        ),
      },
    ];

    return {
      cmyk: cmykGuidance,
      lab: labGuidance,
    };
  };

  const adjustmentGuidance =
    getColorAdjustmentGuidance();

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <div className="app-container">

      {/* ======================================================
          FILE INPUTS
      ====================================================== */}

      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={cameraInputRef}
        onChange={handleFileChange}
        style={{
          display: "none",
        }}
      />

      <input
        type="file"
        accept="image/*"
        ref={galleryInputRef}
        onChange={handleFileChange}
        style={{
          display: "none",
        }}
      />

      {/* ======================================================
          HEADER
      ====================================================== */}

      <header className="app-header glass">
        <div className="logo-group">
          <div className="logo-circle" />

          <span className="logo-text">
            DikaColorCompare
          </span>
        </div>

        <span className="version-badge">
          v1.2
        </span>
      </header>

      {/* ======================================================
          MAIN
      ====================================================== */}

      <main className="app-main">

        {/* ====================================================
            LOADING
        ==================================================== */}

        {isLoading && (
          <div
            className="flex-center"
            style={{
              flex: 1,
              flexDirection:
                "column",
              gap: "16px",
            }}
          >
            <div
              className="logo-circle"
              style={{
                width: "40px",
                height: "40px",
                animation:
                  "pulseBorder 1.5s infinite",
              }}
            />

            <span
              style={{
                fontSize:
                  "0.85rem",
                color:
                  "var(--text-secondary)",
              }}
            >
              Analyzing image channels...
            </span>
          </div>
        )}

        {/* ====================================================
            WELCOME
        ==================================================== */}

        {!imageSrc &&
          !isLoading && (
            <div className="welcome-container">

              <div className="welcome-hero">
                <h1>
                  Compare Colors.
                </h1>

                <p>
                  Upload any picture,
                  drop high-precision
                  pins, and measure
                  color differences
                  instantly using
                  Delta E.
                </p>
              </div>

              <div
                className="upload-card glass-interactive"
                onClick={
                  triggerGallery
                }
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

                <h3>
                  Load Image
                </h3>

                <p>
                  Tap to upload from
                  your gallery or
                  choose a file
                </p>

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

                      <circle
                        cx="12"
                        cy="13"
                        r="3"
                      />
                    </svg>

                    Use Native Camera
                  </button>

                  <button
                    className="upload-btn gallery-btn"
                    onClick={(e) => {
                      e.stopPropagation();

                      triggerGallery();
                    }}
                  >
                    Browse Gallery
                  </button>

                </div>
              </div>

              <div className="samples-section">
                <span className="samples-title">
                  Or try a sample
                  photo:
                </span>

                <div className="samples-grid">
                  {SAMPLE_IMAGES.map(
                    (
                      sample,
                      idx,
                    ) => (
                      <div
                        key={idx}
                        className="sample-thumbnail"
                        onClick={() =>
                          loadImage(
                            sample.url,
                            sample.name,
                          )
                        }
                      >
                        <img
                          src={
                            sample.url
                          }
                          alt={
                            sample.name
                          }
                        />

                        <div className="sample-label">
                          {
                            sample.name
                          }
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>
          )}

        {/* ====================================================
            STUDIO
        ==================================================== */}

        {imageSrc &&
          !isLoading && (
            <div className="studio-container">

              {/* ==================================================
                  TOOLBAR
              ================================================== */}

              <div className="studio-toolbar">

                <button
                  className="toolbar-btn"
                  onClick={
                    handleReset
                  }
                >
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
                  style={{
                    flexDirection:
                      "column",
                    gap: "2px",
                  }}
                >
                  <span className="pick-counter">
                    {picks.length} /
                    6 Pins
                  </span>

                  {imageName && (
                    <span
                      style={{
                        fontSize:
                          "0.65rem",
                        color:
                          "var(--text-tertiary)",
                        maxWidth:
                          "120px",
                        overflow:
                          "hidden",
                        textOverflow:
                          "ellipsis",
                        whiteSpace:
                          "nowrap",
                      }}
                    >
                      {imageName}
                    </span>
                  )}
                </div>

                <button
                  className="toolbar-btn"
                  onClick={
                    handleClearPicks
                  }
                  disabled={
                    picks.length ===
                    0
                  }
                  style={{
                    opacity:
                      picks.length ===
                      0
                        ? 0.4
                        : 1,
                  }}
                >
                  Clear Pins
                </button>

              </div>

              {/* ==================================================
                  CANVAS
              ================================================== */}

              <div
                ref={wrapperRef}
                className="canvas-wrapper"
              >

                {/* =================================================
                    ZOOM / MODE
                ================================================= */}

                <div className="zoom-controls-overlay">

                  <div className="mode-toggle-group glass">

                    <button
                      className={`control-btn ${
                        interactionMode ===
                        "pick"
                          ? "active-mode"
                          : ""
                      }`}
                      onClick={() =>
                        setInteractionMode(
                          "pick",
                        )
                      }
                      title="Select / Drop Pin Mode"
                    >
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
                          d="M15 15l-6 6m0 0l-3-3m3 3V15"
                        />
                      </svg>
                    </button>

                    <button
                      className={`control-btn ${
                        interactionMode ===
                        "pan"
                          ? "active-mode"
                          : ""
                      }`}
                      onClick={() =>
                        setInteractionMode(
                          "pan",
                        )
                      }
                      title="Pan / Zoom Mode"
                    >
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
                          d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1"
                        />
                      </svg>
                    </button>

                  </div>

                  <div className="zoom-actions-group glass">

                    <button
                      className="control-btn"
                      onClick={
                        handleZoomIn
                      }
                      title="Zoom In"
                    >
                      ＋
                    </button>

                    <span className="zoom-value-label">
                      {zoomScale}x
                    </span>

                    <button
                      className="control-btn"
                      onClick={
                        handleZoomOut
                      }
                      title="Zoom Out"
                      disabled={
                        zoomScale ===
                        1
                      }
                    >
                      －
                    </button>

                    <button
                      className="control-btn"
                      onClick={
                        handleZoomReset
                      }
                      title="Reset View"
                      disabled={
                        zoomScale ===
                          1 &&
                        panOffset.x ===
                          0 &&
                        panOffset.y ===
                          0
                      }
                    >
                      ⟲
                    </button>

                  </div>
                </div>

                {/* =================================================
                    IMAGE WORKSPACE
                ================================================= */}

                <div
                  style={{
                    position:
                      "relative",
                    display:
                      "inline-block",
                    maxWidth:
                      "100%",
                    transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
                    transformOrigin:
                      "center center",
                    transition:
                      isDragging
                        ? "none"
                        : "transform 0.15s ease-out",
                    touchAction:
                      "none",
                  }}
                  onTouchStart={
                    handleTouchStart
                  }
                  onTouchMove={
                    handleTouchMove
                  }
                  onTouchEnd={
                    handleTouchEnd
                  }
                  onTouchCancel={
                    handleTouchEnd
                  }
                >

                  <canvas
                    ref={canvasRef}
                    className={`studio-canvas ${
                      interactionMode ===
                      "pan"
                        ? "pan-cursor"
                        : ""
                    }`}
                    style={{
                      touchAction:
                        "none",
                    }}
                    onPointerDown={
                      handlePointerDown
                    }
                    onPointerMove={
                      handlePointerMove
                    }
                    onPointerUp={
                      handlePointerUp
                    }
                    onPointerCancel={
                      handlePointerCancel
                    }
                  />

                  {/* =================================================
                      PINS
                  ================================================= */}

                  {picks.map(
                    (pick) => (
                      <div
                        key={
                          pick.id
                        }
                        className={`canvas-pin ${
                          activePickId ===
                          pick.id
                            ? "active"
                            : ""
                        } ${
                          draggingPinId ===
                          pick.id
                            ? "dragging"
                            : ""
                        }`}
                        onPointerDown={(
                          e,
                        ) =>
                          handlePinPointerDown(
                            e,
                            pick.id,
                          )
                        }
                        onPointerMove={(
                          e,
                        ) =>
                          handlePinPointerMove(
                            e,
                            pick.id,
                          )
                        }
                        onPointerUp={
                          handlePinPointerUp
                        }
                        onPointerCancel={
                          handlePinPointerCancel
                        }
                        style={{
                          left: `${pick.xPercent}%`,
                          top: `${pick.yPercent}%`,
                          backgroundColor:
                            pick.color,
                          touchAction:
                            "none",
                          transform: `translate(-50%, -50%) scale(${
                            (draggingPinId ===
                            pick.id
                              ? 1.3
                              : activePickId ===
                                  pick.id
                                ? 1.2
                                : 1) /
                            zoomScale
                          })`,
                        }}
                      >
                        {
                          pick.id
                        }
                      </div>
                    ),
                  )}

                </div>

                {/* =================================================
                    MAGNIFIER
                ================================================= */}

                {magnifier.show && (
                  <div
                    className="loupe"
                    style={{
                      left: `${magnifier.x}px`,
                      top: `${magnifier.y}px`,
                    }}
                  >
                    <canvas
                      ref={
                        loupeCanvasRef
                      }
                      width={120}
                      height={120}
                      className="loupe-canvas"
                    />

                    <div className="loupe-crosshair" />
                  </div>
                )}

              </div>

              {/* ==================================================
                  DELTA SHORTCUT
              ================================================== */}

{colorA &&
                colorB && (
                  <div className="delta-shortcut-bar">

                    <div className="delta-shortcut-left">

                      <span
                        className={`delta-shortcut-score ${
                          deltaInterpretation?.className ||
                          ""
                        }`}
                      >
                        {delta00Score}
                      </span>

                      <div>

                        <div className="delta-shortcut-label">
                          ΔE₀₀
                        </div>

                        {deltaInterpretation && (
                          <div
                            className={`delta-shortcut-badge ${deltaInterpretation.className}`}
                          >
                            {
                              deltaInterpretation.rating
                            }
                          </div>
                        )}

                      </div>

                    </div>

                    {deltaInterpretation && (
                      <div className="delta-shortcut-gauge">

                        <div
                          className={`delta-shortcut-gauge-fill ${deltaInterpretation.className}`}
                          style={{
                            width: `${deltaInterpretation.percent}%`,
                          }}
                        />

                      </div>
                    )}

                    <div className="delta-shortcut-pin-labels">

                      <span
                        className="delta-shortcut-pin-dot"
                        style={{
                          backgroundColor:
                            colorA.color,
                        }}
                      >
                        {
                          colorA.id
                        }
                      </span>

                      <span>
                        vs
                      </span>

                      <span
                        className="delta-shortcut-pin-dot"
                        style={{
                          backgroundColor:
                            colorB.color,
                        }}
                      >
                        {
                          colorB.id
                        }
                      </span>

                    </div>

                  </div>
                )}


              {/* ==================================================
                  WHITE BALANCE PANEL
              ================================================== */}

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
                      <circle
                        cx="12"
                        cy="12"
                        r="8"
                      />

                      <circle
                        cx="12"
                        cy="12"
                        r="3"
                      />
                    </svg>

                    <span>
                      White Balance
                    </span>
                  </div>

                  {whiteBalance.enabled && (
                    <button
                      className="blur-reset-link"
                      onClick={
                        handleResetWhiteBalance
                      }
                    >
                      Reset
                    </button>
                  )}

                </div>

                <div
                  style={{
                    display:
                      "flex",
                    flexDirection:
                      "column",
                    gap: "12px",
                  }}
                >

                  <div
                    style={{
                      fontSize:
                        "0.78rem",
                      color:
                        "var(--text-secondary)",
                      lineHeight:
                        1.5,
                    }}
                  >
                    Pick a white or
                    neutral light-gray
                    area from the image
                    to correct the
                    camera's color
                    temperature.
                  </div>

                  <div
                    style={{
                      display:
                        "flex",
                      gap: "8px",
                      flexWrap:
                        "wrap",
                      alignItems:
                        "center",
                    }}
                  >

                    <button
                      className={`upload-btn ${
                        isPickingWhite
                          ? "glow-btn"
                          : ""
                      }`}
                      onClick={() => {
                        setIsPickingWhite(
                          (prev) =>
                            !prev,
                        );

                        setMagnifier(
                          (prev) => ({
                            ...prev,
                            show: false,
                          }),
                        );
                      }}
                    >
                      {isPickingWhite
                        ? "Click White Area..."
                        : whiteBalance.enabled
                          ? "Pick New White"
                          : "Pick White"}
                    </button>

                    {whiteBalance.enabled && (
                      <button
                        className="upload-btn gallery-btn"
                        onClick={
                          handleResetWhiteBalance
                        }
                      >
                        Reset White Balance
                      </button>
                    )}

                  </div>

                  {/* =================================================
                      WHITE REFERENCE INFO
                  ================================================= */}

                  {whiteBalance.reference && (
                    <div
                      style={{
                        display:
                          "flex",
                        flexDirection:
                          "column",
                        gap: "8px",
                        padding:
                          "10px",
                        border:
                          "1px solid var(--border-medium)",
                        borderRadius:
                          "10px",
                      }}
                    >

                      <div
                        style={{
                          display:
                            "flex",
                          alignItems:
                            "center",
                          gap: "8px",
                        }}
                      >
                        <div
                          style={{
                            width:
                              "24px",
                            height:
                              "24px",
                            borderRadius:
                              "6px",
                            backgroundColor:
                              rgbToHex(
                                whiteBalance
                                  .reference
                                  .r,
                                whiteBalance
                                  .reference
                                  .g,
                                whiteBalance
                                  .reference
                                  .b,
                              ),
                            border:
                              "1px solid var(--border-medium)",
                          }}
                        />

                        <div
                          style={{
                            fontSize:
                              "0.75rem",
                            fontFamily:
                              "var(--font-mono)",
                          }}
                        >
                          Reference:{" "}
                          {rgbToHex(
                            whiteBalance
                              .reference
                              .r,
                            whiteBalance
                              .reference
                              .g,
                            whiteBalance
                              .reference
                              .b,
                          ).toUpperCase()}
                        </div>

                      </div>

                      <div
                        style={{
                          display:
                            "grid",
                          gridTemplateColumns:
                            "repeat(3, 1fr)",
                          gap: "6px",
                          fontSize:
                            "0.7rem",
                          fontFamily:
                            "var(--font-mono)",
                          color:
                            "var(--text-secondary)",
                        }}
                      >

                        <span>
                          R ×{" "}
                          {whiteBalance.gain.r.toFixed(
                            3,
                          )}
                        </span>

                        <span>
                          G ×{" "}
                          {whiteBalance.gain.g.toFixed(
                            3,
                          )}
                        </span>

                        <span>
                          B ×{" "}
                          {whiteBalance.gain.b.toFixed(
                            3,
                          )}
                        </span>

                      </div>

                    </div>
                  )}

                </div>
              </div>

              {/* ==================================================
                  SAMPLING AREA
              ================================================== */}

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
                      <rect
                        x="4"
                        y="4"
                        width="16"
                        height="16"
                        rx="2"
                      />

                      <path
                        d="M8 8h8v8H8z"
                      />
                    </svg>

                    <span>
                      Sampling Area
                    </span>
                  </div>

                </div>

                <div className="blur-controls">

                  <input type="number" 
                  min={1}
                  value={
                    samplingSize
                  }
                  onChange={
                    handleSamplingChange
                  }
                  className="color-dropdown"
                  name="" id="" />

                  <select
                    value={
                      samplingSize
                    }
                    onChange={
                      handleSamplingChange
                    }
                    className="color-dropdown"
                  >
                    <option value={1}>
                      1 × 1 pixel
                    </option>

                    <option value={3}>
                      3 × 3 pixels
                    </option>

                    <option value={5}>
                      5 × 5 pixels
                    </option>

                    <option value={7}>
                      7 × 7 pixels
                    </option>

                    <option value={11}>
                      11 × 11 pixels
                    </option>

                    <option value={15}>
                      15 × 15 pixels
                    </option>

                    <option value={25}>
                      25 × 25 pixels
                    </option>

                    <option value={35}>
                      35 × 35 pixels
                    </option>

                    <option value={50}>
                      50 × 50 pixels
                    </option>

                    <option value={100}>
                      100 × 100 pixels
                    </option>
                  </select>

                  <span
                    style={{
                      fontSize:
                        "0.72rem",
                      color:
                        "var(--text-secondary)",
                    }}
                  >
                    Median sampling
                  </span>

                </div>

                <div
                  style={{
                    fontSize:
                      "0.72rem",
                    color:
                      "var(--text-tertiary)",
                    marginTop:
                      "6px",
                    lineHeight:
                      1.45,
                  }}
                >
                  Larger areas reduce
                  camera noise and
                  individual pixel
                  variations without
                  blurring the image.
                </div>

              </div>

              {/* ==================================================
                  WHITE BALANCE ACTIVE NOTICE
              ================================================== */}

              {isPickingWhite && (
                <div
                  className="delta-shortcut-bar"
                  style={{
                    justifyContent:
                      "center",
                  }}
                >
                  <strong>
                    Pick a WHITE / NEUTRAL
                    area on the image
                  </strong>
                </div>
              )}

              {/* ==================================================
                  PICKED COLORS
              ================================================== */}

              <div className="colors-grid-section">

                <div className="section-hdr">

                  <h4>
                    Picked Swatches
                  </h4>

                  {picks.length ===
                    0 && (
                    <span className="helper-text">
                      Tap anywhere
                      on the photo
                      above to pick
                      a color
                    </span>
                  )}

                  {picks.length >
                    0 &&
                    picks.length <
                      6 && (
                      <span className="helper-text">
                        Tap image
                        to add up
                        to{" "}
                        {6 -
                          picks.length}{" "}
                        more
                      </span>
                    )}

                </div>

                <div className="colors-grid">

                  {picks.map(
                    (pick) => (
                      <div
                        key={
                          pick.id
                        }
                        className={`color-card glass-interactive ${
                          activePickId ===
                          pick.id
                            ? "active"
                            : ""
                        }`}
                        onClick={() =>
                          setActivePickId(
                            pick.id,
                          )
                        }
                      >

                        <button
                          className="delete-pin-btn"
                          onClick={(
                            e,
                          ) =>
                            handleDeletePick(
                              pick.id,
                              e,
                            )
                          }
                        >
                          ×
                        </button>

                        <div
                          className="card-swatch"
                          style={{
                            backgroundColor:
                              pick.color,
                          }}
                        >
                          {
                            pick.id
                          }
                        </div>

                        <span className="card-hex">
                          {pick.color.toUpperCase()}
                        </span>

                      </div>
                    ),
                  )}

                </div>
              </div>

              {/* ==================================================
                  ACTIVE COLOR DETAILS
              ================================================== */}

              {activePick && (
                <div className="color-details-panel glass">

                  <div className="details-hdr">

                    <div className="details-title">

                      <div
                        style={{
                          width:
                            "14px",
                          height:
                            "14px",
                          borderRadius:
                            "4px",
                          backgroundColor:
                            activePick.color,
                          border:
                            "1px solid var(--border-medium)",
                        }}
                      />

                      <span>
                        Pin #
                        {
                          activePick.id
                        }{" "}
                        Details
                      </span>

                    </div>

                    <span
                      style={{
                        fontSize:
                          "0.75rem",
                        fontFamily:
                          "var(--font-mono)",
                        color:
                          "var(--text-secondary)",
                      }}
                    >
                      RGB(
                      {
                        activePick
                          .rgb
                          .r
                      }
                      ,{" "}
                      {
                        activePick
                          .rgb
                          .g
                      }
                      ,{" "}
                      {
                        activePick
                          .rgb
                          .b
                      }
                      )
                    </span>

                  </div>

                  <div className="details-values-row">

                    <div className="details-val-col">

                      <h5>
                        CIE L*a*b*
                      </h5>

                      <p>
                        L:{" "}
                        {
                          activePick
                            .lab
                            .l
                        }{" "}
                        a:{" "}
                        {
                          activePick
                            .lab
                            .a
                        }{" "}
                        b:{" "}
                        {
                          activePick
                            .lab
                            .b
                        }
                      </p>

                    </div>

                    <div className="details-val-col">

                      <h5>
                        HSL
                      </h5>

                      <p>
                        H:{" "}
                        {
                          activePick
                            .hsl
                            .h
                        }
                        ° S:{" "}
                        {
                          activePick
                            .hsl
                            .s
                        }
                        % L:{" "}
                        {
                          activePick
                            .hsl
                            .l
                        }
                        %
                      </p>

                    </div>

                    <div className="details-val-col">

                      <h5>
                        CMYK
                      </h5>

                      <p>
                        C:{" "}
                        {
                          activePick
                            .cmyk
                            .c
                        }
                        % M:{" "}
                        {
                          activePick
                            .cmyk
                            .m
                        }
                        % Y:{" "}
                        {
                          activePick
                            .cmyk
                            .y
                        }
                        % K:{" "}
                        {
                          activePick
                            .cmyk
                            .k
                        }
                        %
                      </p>

                    </div>

                  </div>

                </div>
              )}

              {/* ==================================================
                  DELTA E COMPARISON
              ================================================== */}

              {picks.length >=
                2 && (
                <div
                  className="comparison-section glass"
                  style={{
                    border:
                      "1px solid var(--accent-border)",
                    background:
                      "rgba(139, 92, 246, 0.03)",
                  }}
                >

                  <div className="comp-header">

                    <h3>
                      Color Difference
                      (Delta E)
                    </h3>

                    {deltaInterpretation && (
                      <span
                        className={`delta-badge ${deltaInterpretation.className}`}
                      >
                        {
                          deltaInterpretation.rating
                        }
                      </span>
                    )}

                  </div>

                  {/* SELECTORS */}

                  <div className="selector-grid">

                    <div className="picker-select-wrapper">

                      <label htmlFor="compareA">
                        Color A
                      </label>

                      <select
                        id="compareA"
                        className="color-dropdown"
                        value={
                          compareIdA ||
                          ""
                        }
                        onChange={(
                          e,
                        ) =>
                          setCompareIdA(
                            Number(
                              e.target
                                .value,
                            ),
                          )
                        }
                      >
                        {picks.map(
                          (p) => (
                            <option
                              key={
                                p.id
                              }
                              value={
                                p.id
                              }
                              disabled={
                                p.id ===
                                compareIdB
                              }
                            >
                              Pin #
                              {
                                p.id
                              }{" "}
                              (
                              {p.color.toUpperCase()}
                              )
                            </option>
                          ),
                        )}
                      </select>

                    </div>

                    <span className="vs-divider flex-center">
                      VS
                    </span>

                    <div className="picker-select-wrapper">

                      <label htmlFor="compareB">
                        Color B
                      </label>

                      <select
                        id="compareB"
                        className="color-dropdown"
                        value={
                          compareIdB ||
                          ""
                        }
                        onChange={(
                          e,
                        ) =>
                          setCompareIdB(
                            Number(
                              e.target
                                .value,
                            ),
                          )
                        }
                      >
                        {picks.map(
                          (p) => (
                            <option
                              key={
                                p.id
                              }
                              value={
                                p.id
                              }
                              disabled={
                                p.id ===
                                compareIdA
                              }
                            >
                              Pin #
                              {
                                p.id
                              }{" "}
                              (
                              {p.color.toUpperCase()}
                              )
                            </option>
                          ),
                        )}
                      </select>

                    </div>

                  </div>

                  {/* SPLIT SWATCH */}

                  {colorA &&
                    colorB && (
                      <>
                        <div className="comparison-split-card">

                          <div
                            className="split-side side-a"
                            style={{
                              backgroundColor:
                                colorA.color,
                            }}
                          >
                            <span className="split-badge">
                              A (Pin{" "}
                              {
                                colorA.id
                              }
                              )
                            </span>

                            <span className="split-hex">
                              {colorA.color.toUpperCase()}
                            </span>
                          </div>

                          <div
                            className="split-side side-b"
                            style={{
                              backgroundColor:
                                colorB.color,
                            }}
                          >
                            <span className="split-badge">
                              B (Pin{" "}
                              {
                                colorB.id
                              }
                              )
                            </span>

                            <span className="split-hex">
                              {colorB.color.toUpperCase()}
                            </span>
                          </div>

                        </div>

                        <div className="delta-results-grid">

                          <div className="main-delta-box">

                            <div className="score-display">

                              <span className="delta-number">
                                {
                                  delta00Score
                                }
                              </span>

                              <span className="delta-formula-label">
                                ΔE₀₀
                                (CIEDE2000)
                              </span>

                            </div>

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

                            <span>
                              CIE76
                              Difference
                              (ΔE₇₆):
                            </span>

                            <span>
                              {
                                delta76Score
                              }
                            </span>

                          </div>

                        </div>

                        {/* =================================================
                            COLOR ADJUSTMENT GUIDANCE
                        ================================================= */}

                        {adjustmentGuidance && (
                          <div className="adjustment-guidance">

                            <div className="adjustment-guidance-header">
                              <div>
                                <div className="adjustment-guidance-title">
                                  WHAT NEEDS TO CHANGE?
                                </div>

                                <div className="adjustment-guidance-subtitle">
                                  Adjustment needed to make Color B like Color A
                                </div>
                              </div>

                              <div className="adjustment-direction">
                                B → A
                              </div>
                            </div>


                            {/* =========================
                                CMYK
                            ========================= */}

                            <div className="adjustment-section">

                              <div className="adjustment-section-title">
                                CMYK
                              </div>

                              <div className="adjustment-grid">

                                {adjustmentGuidance.cmyk.map(
                                  (item) => (
                                    <div
                                      className={`adjustment-item ${item.className}`}
                                      key={item.key}
                                    >

                                      <div className="adjustment-item-label">
                                        {item.label}
                                      </div>

                                      <div className="adjustment-item-main">

                                        <span className="adjustment-direction-text">
                                          {item.direction}
                                        </span>

                                        {item.difference !== 0 && (
                                          <span className="adjustment-value">
                                            {Math.abs(item.difference).toFixed(1)}%
                                          </span>
                                        )}

                                      </div>

                                      <div className="adjustment-item-values">
                                        {item.valueA.toFixed(1)}%
                                        <span>→</span>
                                        {item.valueB.toFixed(1)}%
                                      </div>

                                    </div>
                                  ),
                                )}

                              </div>

                            </div>


                            {/* =========================
                                LAB
                            ========================= */}

                            <div className="adjustment-section">

                              <div className="adjustment-section-title">
                                LAB
                              </div>

                              <div className="adjustment-grid">

                                {adjustmentGuidance.lab.map(
                                  (item) => (
                                    <div
                                      className={`adjustment-item ${item.className}`}
                                      key={item.key}
                                    >

                                      <div className="adjustment-item-label">
                                        {item.label}
                                      </div>

                                      <div className="adjustment-item-main">

                                        <span className="adjustment-direction-text">
                                          {item.direction}
                                        </span>

                                        {item.difference !== 0 && (
                                          <span className="adjustment-value">
                                            {Math.abs(item.difference).toFixed(1)}
                                          </span>
                                        )}

                                      </div>

                                      <div className="adjustment-item-values">
                                        {item.valueA.toFixed(1)}
                                        <span>→</span>
                                        {item.valueB.toFixed(1)}
                                      </div>

                                    </div>
                                  ),
                                )}

                              </div>

                            </div>

                          </div>
                        )}


                        {/* =================================================
                            COMPARISON TABLE
                        ================================================= */}

                        <div className="comp-table-wrapper">

                          <div className="comp-table-row header">

                            <div className="comp-cell metric">
                              Metric
                            </div>

                            <div className="comp-cell val-a">
                              Pin{" "}
                              {
                                colorA.id
                              }{" "}
                              (A)
                            </div>

                            <div className="comp-cell val-b">
                              Pin{" "}
                              {
                                colorB.id
                              }{" "}
                              (B)
                            </div>

                            <div className="comp-cell diff">
                              Shift
                              (B-A)
                            </div>

                          </div>

                          {/* LAB L */}

                          <div className="comp-table-row">

                            <div className="comp-cell metric">
                              Lightness
                              (L*)
                            </div>

                            <div className="comp-cell val-a">
                              {
                                colorA
                                  .lab
                                  .l
                              }
                            </div>

                            <div className="comp-cell val-b">
                              {
                                colorB
                                  .lab
                                  .l
                              }
                            </div>

                            <div
                              className={`comp-cell diff ${formatDiff(
                                colorA.lab.l,
                                colorB.lab.l,
                              ).className}`}
                            >
                              {
                                formatDiff(
                                  colorA.lab.l,
                                  colorB.lab.l,
                                ).text
                              }
                            </div>

                          </div>

                          {/* LAB A */}

                          <div className="comp-table-row">

                            <div className="comp-cell metric">
                              Red/Green
                              (a*)
                            </div>

                            <div className="comp-cell val-a">
                              {
                                colorA
                                  .lab
                                  .a
                              }
                            </div>

                            <div className="comp-cell val-b">
                              {
                                colorB
                                  .lab
                                  .a
                              }
                            </div>

                            <div
                              className={`comp-cell diff ${formatDiff(
                                colorA.lab.a,
                                colorB.lab.a,
                              ).className}`}
                            >
                              {
                                formatDiff(
                                  colorA.lab.a,
                                  colorB.lab.a,
                                ).text
                              }
                            </div>

                          </div>

                          {/* LAB B */}

                          <div className="comp-table-row">

                            <div className="comp-cell metric">
                              Yellow/Blue
                              (b*)
                            </div>

                            <div className="comp-cell val-a">
                              {
                                colorA
                                  .lab
                                  .b
                              }
                            </div>

                            <div className="comp-cell val-b">
                              {
                                colorB
                                  .lab
                                  .b
                              }
                            </div>

                            <div
                              className={`comp-cell diff ${formatDiff(
                                colorA.lab.b,
                                colorB.lab.b,
                              ).className}`}
                            >
                              {
                                formatDiff(
                                  colorA.lab.b,
                                  colorB.lab.b,
                                ).text
                              }
                            </div>

                          </div>

                          {/* HUE */}

                          <div className="comp-table-row">

                            <div className="comp-cell metric">
                              Hue (H)
                            </div>

                            <div className="comp-cell val-a">
                              {
                                colorA
                                  .hsl
                                  .h
                              }°
                            </div>

                            <div className="comp-cell val-b">
                              {
                                colorB
                                  .hsl
                                  .h
                              }°
                            </div>

                            <div
                              className={`comp-cell diff ${formatDiff(
                                colorA.hsl.h,
                                colorB.hsl.h,
                                "°",
                              ).className}`}
                            >
                              {
                                formatDiff(
                                  colorA.hsl.h,
                                  colorB.hsl.h,
                                  "°",
                                ).text
                              }
                            </div>

                          </div>

                          {/* SATURATION */}

                          <div className="comp-table-row">

                            <div className="comp-cell metric">
                              Saturation
                              (S)
                            </div>

                            <div className="comp-cell val-a">
                              {
                                colorA
                                  .hsl
                                  .s
                              }%
                            </div>

                            <div className="comp-cell val-b">
                              {
                                colorB
                                  .hsl
                                  .s
                              }%
                            </div>

                            <div
                              className={`comp-cell diff ${formatDiff(
                                colorA.hsl.s,
                                colorB.hsl.s,
                                "%",
                              ).className}`}
                            >
                              {
                                formatDiff(
                                  colorA.hsl.s,
                                  colorB.hsl.s,
                                  "%",
                                ).text
                              }
                            </div>

                          </div>

                          {/* HSL LIGHTNESS */}

                          <div className="comp-table-row">

                            <div className="comp-cell metric">
                              Lightness
                              (L)
                            </div>

                            <div className="comp-cell val-a">
                              {
                                colorA
                                  .hsl
                                  .l
                              }%
                            </div>

                            <div className="comp-cell val-b">
                              {
                                colorB
                                  .hsl
                                  .l
                              }%
                            </div>

                            <div
                              className={`comp-cell diff ${formatDiff(
                                colorA.hsl.l,
                                colorB.hsl.l,
                                "%",
                              ).className}`}
                            >
                              {
                                formatDiff(
                                  colorA.hsl.l,
                                  colorB.hsl.l,
                                  "%",
                                ).text
                              }
                            </div>

                          </div>

                          {/* CYAN */}

                          <div className="comp-table-row">

                            <div className="comp-cell metric">
                              Cyan (C)
                            </div>

                            <div className="comp-cell val-a">
                              {
                                colorA
                                  .cmyk
                                  .c
                              }%
                            </div>

                            <div className="comp-cell val-b">
                              {
                                colorB
                                  .cmyk
                                  .c
                              }%
                            </div>

                            <div
                              className={`comp-cell diff ${formatDiff(
                                colorA.cmyk.c,
                                colorB.cmyk.c,
                                "%",
                              ).className}`}
                            >
                              {
                                formatDiff(
                                  colorA.cmyk.c,
                                  colorB.cmyk.c,
                                  "%",
                                ).text
                              }
                            </div>

                          </div>

                          {/* MAGENTA */}

                          <div className="comp-table-row">

                            <div className="comp-cell metric">
                              Magenta
                              (M)
                            </div>

                            <div className="comp-cell val-a">
                              {
                                colorA
                                  .cmyk
                                  .m
                              }%
                            </div>

                            <div className="comp-cell val-b">
                              {
                                colorB
                                  .cmyk
                                  .m
                              }%
                            </div>

                            <div
                              className={`comp-cell diff ${formatDiff(
                                colorA.cmyk.m,
                                colorB.cmyk.m,
                                "%",
                              ).className}`}
                            >
                              {
                                formatDiff(
                                  colorA.cmyk.m,
                                  colorB.cmyk.m,
                                  "%",
                                ).text
                              }
                            </div>

                          </div>

                          {/* YELLOW */}

                          <div className="comp-table-row">

                            <div className="comp-cell metric">
                              Yellow (Y)
                            </div>

                            <div className="comp-cell val-a">
                              {
                                colorA
                                  .cmyk
                                  .y
                              }%
                            </div>

                            <div className="comp-cell val-b">
                              {
                                colorB
                                  .cmyk
                                  .y
                              }%
                            </div>

                            <div
                              className={`comp-cell diff ${formatDiff(
                                colorA.cmyk.y,
                                colorB.cmyk.y,
                                "%",
                              ).className}`}
                            >
                              {
                                formatDiff(
                                  colorA.cmyk.y,
                                  colorB.cmyk.y,
                                  "%",
                                ).text
                              }
                            </div>

                          </div>

                          {/* BLACK */}

                          <div className="comp-table-row">

                            <div className="comp-cell metric">
                              Key (K)
                            </div>

                            <div className="comp-cell val-a">
                              {
                                colorA
                                  .cmyk
                                  .k
                              }%
                            </div>

                            <div className="comp-cell val-b">
                              {
                                colorB
                                  .cmyk
                                  .k
                              }%
                            </div>

                            <div
                              className={`comp-cell diff ${formatDiff(
                                colorA.cmyk.k,
                                colorB.cmyk.k,
                                "%",
                              ).className}`}
                            >
                              {
                                formatDiff(
                                  colorA.cmyk.k,
                                  colorB.cmyk.k,
                                  "%",
                                ).text
                              }
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

      {/* ========================================================
          TOAST
      ======================================================== */}

      {toast && (
        <div
          className={`toast-msg ${toast.type}`}
        >
          {
            toast.message
          }
        </div>
      )}

    </div>
  );
}