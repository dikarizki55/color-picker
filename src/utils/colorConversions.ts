export interface LAB {
  l: number;
  a: number;
  b: number;
}

export interface HSL {
  h: number;
  s: number;
  l: number;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface CMYK {
  c: number;
  m: number;
  y: number;
  k: number;
}

// Convert Hex string to RGB object
export function hexToRgb(hex: string): RGB | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

// Convert RGB to Hex string
export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (val: number) => Math.max(0, Math.min(255, Math.round(val)));
  return (
    "#" +
    [clamp(r), clamp(g), clamp(b)]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("")
  );
}

// Convert RGB to HSL
export function rgbToHsl(r: number, g: number, b: number): HSL {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

// Convert RGB to XYZ (D65 white point)
export function rgbToXyz(r: number, g: number, b: number) {
  let rL = r / 255;
  let gL = g / 255;
  let bL = b / 255;

  rL = rL > 0.04045 ? Math.pow((rL + 0.055) / 1.055, 2.4) : rL / 12.92;
  gL = gL > 0.04045 ? Math.pow((gL + 0.055) / 1.055, 2.4) : gL / 12.92;
  bL = bL > 0.04045 ? Math.pow((bL + 0.055) / 1.055, 2.4) : bL / 12.92;

  rL *= 100;
  gL *= 100;
  bL *= 100;

  // Reference D65 Matrix conversion
  const x = rL * 0.4124 + gL * 0.3576 + bL * 0.1805;
  const y = rL * 0.2126 + gL * 0.7152 + bL * 0.0722;
  const z = rL * 0.0193 + gL * 0.1192 + bL * 0.9505;

  return { x, y, z };
}

// Convert XYZ to CIE L*a*b*
export function xyzToLab(x: number, y: number, z: number): LAB {
  // D65 Standard Illuminant Reference White points
  const xRef = 95.047;
  const yRef = 100.0;
  const zRef = 108.883;

  let xN = x / xRef;
  let yN = y / yRef;
  let zN = z / zRef;

  const f = (t: number) => {
    return t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116;
  };

  const fx = f(xN);
  const fy = f(yN);
  const fz = f(zN);

  const l = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const b = 200 * (fy - fz);

  return {
    l: parseFloat(l.toFixed(2)),
    a: parseFloat(a.toFixed(2)),
    b: parseFloat(b.toFixed(2)),
  };
}

// Convert RGB to CIE L*a*b* directly
export function rgbToLab(r: number, g: number, b: number): LAB {
  const { x, y, z } = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

// Convert RGB to CMYK
export function rgbToCmyk(r: number, g: number, b: number): CMYK {
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;

  const k = 1 - Math.max(rN, gN, bN);

  if (k === 1) {
    return { c: 0, m: 0, y: 0, k: 100 };
  }

  return {
    c: parseFloat((((1 - rN - k) / (1 - k)) * 100).toFixed(1)),
    m: parseFloat((((1 - gN - k) / (1 - k)) * 100).toFixed(1)),
    y: parseFloat((((1 - bN - k) / (1 - k)) * 100).toFixed(1)),
    k: parseFloat((k * 100).toFixed(1)),
  };
}

// Calculate CIE76 color difference (Euclidean distance in L*a*b* space)
export function deltaE76(lab1: LAB, lab2: LAB): number {
  const dL = lab1.l - lab2.l;
  const da = lab1.a - lab2.a;
  const db = lab1.b - lab2.b;
  return parseFloat(Math.sqrt(dL * dL + da * da + db * db).toFixed(2));
}

// Calculate CIEDE2000 color difference (accurate formula)
export function deltaE00(lab1: LAB, lab2: LAB): number {
  const L1 = lab1.l;
  const a1 = lab1.a;
  const b1 = lab1.b;
  const L2 = lab2.l;
  const a2 = lab2.a;
  const b2 = lab2.b;

  const kL = 1;
  const kC = 1;
  const kH = 1;

  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);

  const CBar = (C1 + C2) / 2;

  const cPow7 = Math.pow(CBar, 7);
  const g = 0.5 * (1 - Math.sqrt(cPow7 / (cPow7 + Math.pow(25, 7))));

  const a1Prime = (1 + g) * a1;
  const a2Prime = (1 + g) * a2;

  const C1Prime = Math.sqrt(a1Prime * a1Prime + b1 * b1);
  const C2Prime = Math.sqrt(a2Prime * a2Prime + b2 * b2);

  const CBarPrime = (C1Prime + C2Prime) / 2;

  const h1Prime =
    Math.atan2(b1, a1Prime) >= 0
      ? (Math.atan2(b1, a1Prime) * 180) / Math.PI
      : (Math.atan2(b1, a1Prime) * 180) / Math.PI + 360;

  const h2Prime =
    Math.atan2(b2, a2Prime) >= 0
      ? (Math.atan2(b2, a2Prime) * 180) / Math.PI
      : (Math.atan2(b2, a2Prime) * 180) / Math.PI + 360;

  const deltaLPrime = L2 - L1;
  const deltaCPrime = C2Prime - C1Prime;

  let deltahPrime = 0;
  if (C1Prime * C2Prime !== 0) {
    if (Math.abs(h2Prime - h1Prime) <= 180) {
      deltahPrime = h2Prime - h1Prime;
    } else if (h2Prime - h1Prime > 180) {
      deltahPrime = h2Prime - h1Prime - 360;
    } else if (h2Prime - h1Prime < -180) {
      deltahPrime = h2Prime - h1Prime + 360;
    }
  }

  const deltaHPrime =
    2 *
    Math.sqrt(C1Prime * C2Prime) *
    Math.sin(((deltahPrime / 2) * Math.PI) / 180);

  const LBar = (L1 + L2) / 2;

  let hBarPrime = 0;
  if (C1Prime * C2Prime !== 0) {
    if (Math.abs(h1Prime - h2Prime) <= 180) {
      hBarPrime = (h1Prime + h2Prime) / 2;
    } else if (Math.abs(h1Prime - h2Prime) > 180 && h1Prime + h2Prime < 360) {
      hBarPrime = (h1Prime + h2Prime + 360) / 2;
    } else if (Math.abs(h1Prime - h2Prime) > 180 && h1Prime + h2Prime >= 360) {
      hBarPrime = (h1Prime + h2Prime - 360) / 2;
    }
  }

  const T =
    1 -
    0.17 * Math.cos(((hBarPrime - 30) * Math.PI) / 180) +
    0.24 * Math.cos(((2 * hBarPrime) * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hBarPrime + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hBarPrime - 63) * Math.PI) / 180);

  const deltaTheta = 30 * Math.exp(-Math.pow((hBarPrime - 275) / 25, 2));

  const cBarPrimePow7 = Math.pow(CBarPrime, 7);
  const RC =
    2 * Math.sqrt(cBarPrimePow7 / (cBarPrimePow7 + Math.pow(25, 7)));

  const RT = -RC * Math.sin(((2 * deltaTheta) * Math.PI) / 180);

  const SL =
    1 +
    (0.015 * Math.pow(LBar - 50, 2)) / Math.sqrt(20 + Math.pow(LBar - 50, 2));
  const SC = 1 + 0.045 * CBarPrime;
  const SH = 1 + 0.015 * CBarPrime * T;

  const deltaE = Math.sqrt(
    Math.pow(deltaLPrime / (kL * SL), 2) +
      Math.pow(deltaCPrime / (kC * SC), 2) +
      Math.pow(deltaHPrime / (kH * SH), 2) +
      RT * (deltaCPrime / (kC * SC)) * (deltaHPrime / (kH * SH))
  );

  return parseFloat(deltaE.toFixed(2));
}

// User-friendly interpretation of Delta E
export interface DeltaInterpretation {
  rating: string;
  description: string;
  className: string;
  percent: number; // For rendering gauge [0, 100]
}

export function getDeltaEInterpretation(deltaE: number): DeltaInterpretation {
  if (deltaE <= 1.0) {
    return {
      rating: "Imperceptible",
      description: "Difference is not perceptible by the human eye.",
      className: "delta-imperceptible",
      percent: Math.min(100, deltaE * 20), // 0 to 1 -> 0 to 20%
    };
  } else if (deltaE <= 2.0) {
    return {
      rating: "Slightly Perceptible",
      description: "Perceptible through close observation only.",
      className: "delta-slight",
      percent: 20 + (deltaE - 1.0) * 20, // 1 to 2 -> 20 to 40%
    };
  } else if (deltaE <= 10.0) {
    return {
      rating: "Noticeable",
      description: "Perceptible at a glance by an untrained observer.",
      className: "delta-noticeable",
      percent: 40 + ((deltaE - 2.0) / 8.0) * 30, // 2 to 10 -> 40 to 70%
    };
  } else if (deltaE <= 49.0) {
    return {
      rating: "Clearly Distinguishable",
      description: "Colors are distinct, but share similar color category characteristics.",
      className: "delta-distinguishable",
      percent: 70 + ((deltaE - 10.0) / 39.0) * 20, // 10 to 49 -> 70 to 90%
    };
  } else {
    return {
      rating: "Completely Different",
      description: "Opposite or contrasting colors (exact opposites or high contrast).",
      className: "delta-different",
      percent: 90 + Math.min(10, ((deltaE - 49.0) / 51.0) * 10), // 49 to 100+ -> 90 to 100%
    };
  }
}
