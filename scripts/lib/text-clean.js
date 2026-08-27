// Some metodeblad PDFs encode Greek letters, math operators and symbols
// with the Adobe "Symbol" (and Wingdings) font instead of real Unicode, so
// pdfplumber extracts them as Private-Use-Area code points (U+E000–U+F8FF):
// e.g. "µmol/L" comes out as "mol/L", which renders as "mol/L"
// (no glyph) or is stripped entirely.
//
// `desymbolize()` maps the known Symbol-font PUA points (they sit at
// U+F000 + the font's byte value) back to real Unicode, then drops any
// remaining PUA point (list bullets / arrows that carry no meaning once
// the font mapping is gone).

// keyed by the code point's low byte (Symbol-font encoding)
const SYMBOL_LOW_BYTE = {
  // Greek lowercase 0x61–0x7A
  0x61: 'α', 0x62: 'β', 0x63: 'χ', 0x64: 'δ', 0x65: 'ε',
  0x66: 'φ', 0x67: 'γ', 0x68: 'η', 0x69: 'ι', 0x6a: 'φ',
  0x6b: 'κ', 0x6c: 'λ', 0x6d: 'µ', 0x6e: 'ν', 0x6f: 'ο',
  0x70: 'π', 0x71: 'θ', 0x72: 'ρ', 0x73: 'σ', 0x74: 'τ',
  0x75: 'υ', 0x77: 'ω', 0x78: 'ξ', 0x79: 'ψ', 0x7a: 'ζ',
  // Greek uppercase that turn up in units / analyte names
  0x44: 'Δ', 0x53: 'Σ', 0x57: 'Ω',
  // relations / operators
  0x3c: '<', 0x3d: '=', 0x3e: '>',
  0xa3: '≤', 0xb0: '°', 0xb1: '±', 0xb2: '″', 0xb3: '≥',
  0xb4: '×', 0xb7: '·', 0xb8: '÷', 0xb9: '≠',
  0xac: '←', 0xae: '→', 0xab: '↔',
  // marks
  0xd2: '®', 0xd3: '©', 0xd4: '™'
};

const PUA_RE = /[-]/g;

export function desymbolize(text) {
  if (typeof text !== 'string' || !text) return text;
  return text.replace(PUA_RE, (ch) => {
    const cp = ch.charCodeAt(0);
    if (cp >= 0xf000 && cp <= 0xf0ff) {
      const mapped = SYMBOL_LOW_BYTE[cp - 0xf000];
      if (mapped) return mapped;
    }
    return '';
  });
}
