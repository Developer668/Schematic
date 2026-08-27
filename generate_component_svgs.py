#!/usr/bin/env python3
"""
Generate high-quality component SVGs matching existing Fritzing-style artwork.
Each SVG is crafted to be accurate for the specific part and optimized for
hardware-part-stage placement (centered, object-fit contain).
"""
import pathlib, os

OUT = pathlib.Path("frontend/public/component-svgs")

# Ensure output exists
OUT.mkdir(parents=True, exist_ok=True)

def write(name, content):
    path = OUT / f"{name}.svg"
    # Don't overwrite existing high-quality files unless it's a placeholder-needed one
    # For our new ones, write if not exists OR if we want to replace
    path.write_text(content, encoding="utf-8")
    print(f"WROTE {name}.svg ({len(content)} bytes)")

# ──────────────────────────────────────────────────────────────────────────────
# Common helpers
# ──────────────────────────────────────────────────────────────────────────────
def svg_header(width, height, viewBox, extra=""):
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<svg width="{width}" height="{height}" viewBox="{viewBox}" xmlns="http://www.w3.org/2000/svg" {extra}>\n'

# Reusable gradients / filters
COMMON_DEFS = """
  <defs>
    <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.22"/>
    </linearGradient>
    <linearGradient id="leadGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#8a8a8a"/>
      <stop offset="50%" stop-color="#e0e0e0"/>
      <stop offset="100%" stop-color="#9a9a9a"/>
    </linearGradient>
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="1.2" stdDeviation="0.8" flood-color="#000" flood-opacity="0.28"/>
    </filter>
  </defs>
"""

# ──────────────────────────────────────────────────────────────────────────────
# Diodes (horizontal axial)
# ──────────────────────────────────────────────────────────────────────────────
def diode_svg(name, title, body="#323232", band="#d4af37", band2=None, glass=False, zener=False, schottky=False):
    # Horizontal body similar to resistor but simpler, with optional glass transparency
    # viewBox 0 0 15.6 3 like resistor
    body_style = f'fill="{body}"' if not glass else f'fill="{body}" fill-opacity="0.85"'
    glass_extra = '<rect x="4.7" y="0.35" width="6.2" height="2.3" rx="0.45" fill="#fff" opacity="0.18"/>' if glass else ''
    zener_mark = '<path d="M11.2 0.42 L11.85 0.42 L11.2 0.75 Z M4.9 2.58 L4.25 2.58 L4.9 2.25 Z" fill="#fff" opacity="0.9"/>' if zener else ''
    schottky_mark = '<path d="M6.9 0.45 H7.3 V2.55 H6.9 M8.8 0.45 H9.2 V2.55 H8.8 M7.3 0.65 L8.8 0.65 M7.3 2.35 L8.8 2.35" stroke="#fff" stroke-width="0.14" opacity="0.85"/>' if schottky else ''
    band_rect = f'<rect x="9.2" y="0" width="0.95" height="3" fill="{band}"/>'
    if band2:
        band_rect += f'<rect x="10.45" y="0" width="0.42" height="3" fill="{band2}" opacity="0.95"/>'
    svg = svg_header("59","11","0 0 15.645 3")
    svg += COMMON_DEFS
    svg += f'<rect y="1.15" width="15.64" height="0.68" fill="url(#leadGrad)" rx="0.1"/>\n'
    # body
    svg += f'<path d="M4.69 0 C3.63 0 2.77 0.675 2.77 1.5 C2.77 2.325 3.63 3 4.69 3 C5.11 3 5.51 2.89 5.82 2.706 H9.92 C10.24 2.89 10.64 3 11.06 3 C12.12 3 12.98 2.325 12.98 1.5 C12.98 0.675 12.12 0 11.06 0 C10.64 0 10.24 0.111 9.92 0.294 H5.82 C5.51 0.111 5.11 0 4.69 0 Z" {body_style} filter="url(#softShadow)"/>\n'
    svg += f'<path d="M4.69 0 C3.63 0 2.77 0.675 2.77 1.5 C2.77 2.325 3.63 3 4.69 3 C5.11 3 5.51 2.89 5.82 2.706 H9.92 C10.24 2.89 10.64 3 11.06 3 C12.12 3 12.98 2.325 12.98 1.5 C12.98 0.675 12.12 0 11.06 0 C10.64 0 10.24 0.111 9.92 0.294 H5.82 C5.51 0.111 5.11 0 4.69 0 Z" fill="url(#bodyGrad)" opacity="0.38"/>\n'
    svg += glass_extra + "\n"
    svg += band_rect + "\n"
    svg += zener_mark + schottky_mark + "\n"
    # small polarity marking
    svg += f'<text x="7.87" y="1.78" text-anchor="middle" font-family="monospace" font-size="0.62" font-weight="700" fill="#fff" opacity="0.9">{title.split()[0][:4]}</text>\n'
    svg += '</svg>\n'
    return svg

# ──────────────────────────────────────────────────────────────────────────────
# Transistors / MOSFETs TO-92 and TO-220
# ──────────────────────────────────────────────────────────────────────────────
def to92_svg(name, title, subtitle=""):
    # TO-92: semicircular black epoxy, 3 leads bent flat
    svg = svg_header("32","44",'0 0 32 44')
    svg += COMMON_DEFS
    svg += """
  <!-- leads -->
  <g fill="#b8b8b8" stroke="#8a8a8a" stroke-width="0.22">
    <rect x="6.5" y="28" width="1.35" height="14" rx="0.4"/>
    <rect x="15.3" y="28" width="1.35" height="14" rx="0.4"/>
    <rect x="24.1" y="28" width="1.35" height="14" rx="0.4"/>
    <!-- bends -->
    <rect x="6.1" y="27.2" width="2.15" height="1.6" rx="0.3" fill="#c2c2c2"/>
    <rect x="14.9" y="27.2" width="2.15" height="1.6" rx="0.3" fill="#c2c2c2"/>
    <rect x="23.7" y="27.2" width="2.15" height="1.6" rx="0.3" fill="#c2c2c2"/>
  </g>
"""
    svg += f"""
  <!-- body -->
  <g filter="url(#softShadow)">
    <path d="M8 14 C8 7.5 12.2 4.2 16 4.2 C19.8 4.2 24 7.5 24 14 V24 H8 Z" fill="#1a1d22" stroke="#0f1115" stroke-width="0.35"/>
    <path d="M8 14 C8 7.5 12.2 4.2 16 4.2 C19.8 4.2 24 7.5 24 14 V24 H8 Z" fill="url(#bodyGrad)" opacity="0.32"/>
    <!-- flat face shading -->
    <rect x="8" y="14" width="16" height="10" rx="0.6" fill="#23262e"/>
    <rect x="9.2" y="15.2" width="13.6" height="1.1" rx="0.35" fill="#2e323d"/>
    <rect x="9.2" y="17.6" width="13.6" height="1.1" rx="0.35" fill="#2e323d"/>
  </g>
  <ellipse cx="16" cy="24" rx="8" ry="1.1" fill="#000" opacity="0.28"/>
  <text x="16" y="11.5" text-anchor="middle" font-family="monospace" font-size="2.1" font-weight="700" fill="#e5e7eb">{title}</text>
  <text x="16" y="19.2" text-anchor="middle" font-family="monospace" font-size="1.45" fill="#9ca3af">{subtitle}</text>
  <text x="11.2" y="40.2" text-anchor="middle" font-family="monospace" font-size="1.45" fill="#374151">E</text>
  <text x="16" y="40.2" text-anchor="middle" font-family="monospace" font-size="1.45" fill="#374151">B</text>
  <text x="20.8" y="40.2" text-anchor="middle" font-family="monospace" font-size="1.45" fill="#374151">C</text>
</svg>
"""
    return svg

def to220_svg(name, title, subtitle="", tab_color="#cbd5e1"):
    svg = svg_header("44","62",'0 0 44 62')
    svg += COMMON_DEFS
    svg += f"""
  <!-- tab / heatsink -->
  <rect x="8" y="4" width="28" height="22" rx="1.2" fill="{tab_color}" stroke="#94a3b8" stroke-width="0.4" filter="url(#softShadow)"/>
  <rect x="11" y="6.5" width="22" height="17" rx="0.6" fill="#e2e8f0" opacity="0.9"/>
  <circle cx="22" cy="9.2" r="2.1" fill="#1e293b" stroke="#64748b" stroke-width="0.35"/>
  <circle cx="22" cy="9.2" r="0.95" fill="#0f172a"/>
  <!-- body -->
  <rect x="6" y="20" width="32" height="24" rx="1.4" fill="#0f1217" stroke="#1e293b" stroke-width="0.45" filter="url(#softShadow)"/>
  <rect x="6" y="20" width="32" height="24" rx="1.4" fill="url(#bodyGrad)" opacity="0.22"/>
  <rect x="9" y="33" width="26" height="5.5" rx="0.5" fill="#1e293b" opacity="0.95"/>
  <!-- leads -->
  <g fill="#d4d4d4" stroke="#8b8b8b" stroke-width="0.32">
    <rect x="10.5" y="44" width="3.2" height="16" rx="0.4"/>
    <rect x="20.4" y="44" width="3.2" height="16" rx="0.4"/>
    <rect x="30.3" y="44" width="3.2" height="16" rx="0.4"/>
  </g>
  <text x="22" y="28.5" text-anchor="middle" font-family="monospace" font-size="2.6" font-weight="700" fill="#f1f5f9">{title}</text>
  <text x="22" y="31.8" text-anchor="middle" font-family="monospace" font-size="1.55" fill="#94a3b8">{subtitle}</text>
  <text x="12.1" y="57.5" text-anchor="middle" font-family="monospace" font-size="1.6" fill="#475569">1</text>
  <text x="22" y="57.5" text-anchor="middle" font-family="monospace" font-size="1.6" fill="#475569">2</text>
  <text x="31.9" y="57.5" text-anchor="middle" font-family="monospace" font-size="1.6" fill="#475569">3</text>
</svg>
"""
    return svg

def to3_svg(title):
    svg = svg_header("56","48",'0 0 56 48')
    svg += COMMON_DEFS
    svg += f"""
  <ellipse cx="28" cy="22" rx="22" ry="14.5" fill="#d1d5db" stroke="#9ca3af" stroke-width="0.6" filter="url(#softShadow)"/>
  <ellipse cx="28" cy="19.5" rx="20" ry="12.2" fill="#e5e7eb" stroke="#6b7280" stroke-width="0.35"/>
  <ellipse cx="28" cy="19.5" rx="16.5" ry="9.2" fill="#111827"/>
  <rect x="26.8" y="2" width="2.4" height="9" rx="0.6" fill="#9ca3af" stroke="#6b7280" stroke-width="0.3"/>
  <rect x="11" y="31" width="2.2" height="13" rx="0.5" fill="#c4c4c4" stroke="#6b7280" stroke-width="0.32"/>
  <rect x="42.8" y="31" width="2.2" height="13" rx="0.5" fill="#c4c4c4" stroke="#6b7280" stroke-width="0.32"/>
  <text x="28" y="21.2" text-anchor="middle" font-family="monospace" font-size="3.2" font-weight="800" fill="#f9fafb">{title}</text>
  <text x="28" y="36" text-anchor="middle" font-family="monospace" font-size="1.9" fill="#4b5563">POWER BJT</text>
</svg>
"""
    return svg

# ──────────────────────────────────────────────────────────────────────────────
# DIP ICs (opamps, logic)
# ──────────────────────────────────────────────────────────────────────────────
def dip_svg(name, title, subtitle="", pins=8, notch=True):
    # width scales with pins
    w = 64
    h = 48 if pins <=8 else 56 if pins <=14 else 62
    view = f"0 0 {w} {h}"
    # body width
    body_w = 28 if pins <=8 else 34 if pins <=14 else 42
    body_h = 18 if pins <=8 else 32 if pins <=14 else 42
    bx = (w - body_w)/2
    by = (h - body_h)/2
    # pins
    pins_per_side = pins//2
    pitch = body_h / (pins_per_side + 1) if pins_per_side else 6
    pins_svg = ""
    for i in range(pins_per_side):
        y = by + (i+1)*pitch -2
        pins_svg += f'<rect x="{bx-6}" y="{y}" width="6" height="3.2" rx="0.5" fill="#c8c8c8" stroke="#8a8a8a" stroke-width="0.28"/>\n'
        pins_svg += f'<rect x="{bx+body_w}" y="{y}" width="6" height="3.2" rx="0.5" fill="#c8c8c8" stroke="#8a8a8a" stroke-width="0.28"/>\n'
    notch_svg = f'<path d="M{bx+body_w/2-3} {by} A3 3 0 0 0 {bx+body_w/2+3} {by} Z" fill="#0f172a" opacity="0.95"/>\n<circle cx="{bx+3.2}" cy="{by+3.2}" r="0.9" fill="#e5e7eb" opacity="0.95"/>' if notch else ''
    svg = svg_header(str(w), str(h), view)
    svg += COMMON_DEFS
    svg += f"""
  <g filter="url(#softShadow)">
    <rect x="{bx}" y="{by}" width="{body_w}" height="{body_h}" rx="1.6" fill="#0f1115" stroke="#1f2937" stroke-width="0.5"/>
    <rect x="{bx}" y="{by}" width="{body_w}" height="{body_h}" rx="1.6" fill="url(#bodyGrad)" opacity="0.18"/>
    <rect x="{bx+1.2}" y="{by+1.8}" width="{body_w-2.4}" height="1.2" rx="0.4" fill="#1f2937" opacity="0.9"/>
  </g>
  {pins_svg}
  {notch_svg}
  <text x="{w/2}" y="{by+body_h/2-1}" text-anchor="middle" font-family="monospace" font-size="3.2" font-weight="700" fill="#f3f4f6">{title}</text>
  <text x="{w/2}" y="{by+body_h/2+4.5}" text-anchor="middle" font-family="monospace" font-size="1.7" fill="#9ca3af">{subtitle}</text>
</svg>
"""
    return svg

def dip_switch_svg():
    svg = svg_header("64","36",'0 0 64 36')
    svg += COMMON_DEFS
    svg += """
  <rect x="6" y="10" width="52" height="16" rx="1.4" fill="#dc2626" stroke="#7f1d1d" stroke-width="0.45" filter="url(#softShadow)"/>
  <rect x="6" y="10" width="52" height="16" rx="1.4" fill="url(#bodyGrad)" opacity="0.18"/>
"""
    for i in range(8):
        x = 9 + i*6.1
        svg += f'<rect x="{x}" y="13" width="3.8" height="10" rx="0.5" fill="#f8fafc" stroke="#334155" stroke-width="0.35"/>\n'
        svg += f'<rect x="{x+0.6}" y="14.2" width="2.6" height="3.2" rx="0.35" fill="#e2e8f0"/>\n'
        svg += f'<text x="{x+1.9}" y="30" text-anchor="middle" font-family="monospace" font-size="1.55" fill="#475569">{i+1}</text>\n'
    svg += '<text x="32" y="8.5" text-anchor="middle" font-family="monospace" font-size="1.9" font-weight="700" fill="#1e293b">DIP-8  ON</text>\n'
    # leads bottom
    for i in range(8):
        x = 9.8 + i*6.1
        svg += f'<rect x="{x}" y="26" width="1.8" height="5" rx="0.3" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.28"/>\n'
        x2 = 9.8 + i*6.1
        svg += f'<rect x="{x2}" y="6" width="1.8" height="4" rx="0.3" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.28"/>\n'
    svg += '</svg>\n'
    return svg

# ──────────────────────────────────────────────────────────────────────────────
# Logic gates (single gate symbols as small IC)
# ──────────────────────────────────────────────────────────────────────────────
def logic_gate_svg(name, title, symbol="AND"):
    svg = svg_header("58","42",'0 0 58 42')
    svg += COMMON_DEFS
    # symbol drawing based on type
    symbol_draw = ""
    if symbol == "AND":
        symbol_draw = '<path d="M14 8 H22 C29 8 33 14 33 21 C33 28 29 34 22 34 H14 Z" fill="#f8fafc" stroke="#0f172a" stroke-width="1.1"/>'
    elif symbol == "OR":
        symbol_draw = '<path d="M12 8 C18 8 30 12 33 21 C30 30 18 34 12 34 C14.5 21 14.5 21 12 8 Z" fill="#f8fafc" stroke="#0f172a" stroke-width="1.1"/>'
    elif symbol == "NOT":
        symbol_draw = '<path d="M14 8 L14 34 L28 21 Z" fill="#f8fafc" stroke="#0f172a" stroke-width="1.1"/><circle cx="31.5" cy="21" r="2.8" fill="#f8fafc" stroke="#0f172a" stroke-width="1.1"/>'
    elif symbol == "NAND":
        symbol_draw = '<path d="M14 8 H20 C27 8 31 13.5 31 21 C31 28.5 27 34 20 34 H14 Z" fill="#f8fafc" stroke="#0f172a" stroke-width="1.1"/><circle cx="33.8" cy="21" r="2.6" fill="#f8fafc" stroke="#0f172a" stroke-width="1.1"/>'
    elif symbol == "NOR":
        symbol_draw = '<path d="M12 8 C17 8 28 12 31 21 C28 30 17 34 12 34 C14.2 21 14.2 21 12 8 Z" fill="#f8fafc" stroke="#0f172a" stroke-width="1.1"/><circle cx="33.8" cy="21" r="2.6" fill="#f8fafc" stroke="#0f172a" stroke-width="1.1"/>'
    elif symbol == "XOR":
        symbol_draw = '<path d="M10 8 C12.5 21 12.5 21 10 34 C12 34 13.5 21 10 8" fill="none" stroke="#0f172a" stroke-width="1.1"/><path d="M13.5 8 C18.5 8 29 12 32 21 C29 30 18.5 34 13.5 34 C15.8 21 15.8 21 13.5 8 Z" fill="#f8fafc" stroke="#0f172a" stroke-width="1.1"/>'
    elif symbol == "XNOR":
        symbol_draw = '<path d="M10 8 C12.5 21 12.5 21 10 34" fill="none" stroke="#0f172a" stroke-width="1.1"/><path d="M13.5 8 C18 8 27 12 30 21 C27 30 18 34 13.5 34 C15.5 21 15.5 21 13.5 8 Z" fill="#f8fafc" stroke="#0f172a" stroke-width="1.1"/><circle cx="32.6" cy="21" r="2.4" fill="#f8fafc" stroke="#0f172a" stroke-width="1.0"/>'
    elif symbol == "DFF":
        symbol_draw = '<rect x="12" y="8" width="22" height="26" rx="1" fill="#f8fafc" stroke="#0f172a" stroke-width="1.1"/><text x="23" y="18" text-anchor="middle" font-family="monospace" font-size="3" font-weight="700" fill="#0f172a">D</text><text x="23" y="28" text-anchor="middle" font-family="monospace" font-size="2.2" fill="#475569">CLK</text>'
    elif symbol == "JK":
        symbol_draw = '<rect x="12" y="8" width="22" height="26" rx="1" fill="#f8fafc" stroke="#0f172a" stroke-width="1.1"/><text x="17" y="18" text-anchor="middle" font-family="monospace" font-size="2.8" font-weight="700" fill="#0f172a">J</text><text x="29" y="18" text-anchor="middle" font-family="monospace" font-size="2.8" font-weight="700" fill="#0f172a">K</text>'
    elif symbol == "T":
        symbol_draw = '<rect x="12" y="8" width="22" height="26" rx="1" fill="#f8fafc" stroke="#0f172a" stroke-width="1.1"/><text x="23" y="22" text-anchor="middle" font-family="monospace" font-size="4.5" font-weight="700" fill="#0f172a">T</text>'
    else:
        symbol_draw = '<rect x="14" y="8" width="20" height="26" rx="1" fill="#f8fafc" stroke="#0f172a" stroke-width="1.1"/>'
    svg += f"""
  <rect x="2" y="2" width="54" height="38" rx="3" fill="#ffffff" stroke="#e2e8f0" stroke-width="0.6" filter="url(#softShadow)"/>
  <g transform="translate(6 4)">
    {symbol_draw}
    <!-- pins -->
    <rect x="0" y="10" width="4" height="1.6" rx="0.5" fill="#9ca3af"/>
    <rect x="0" y="20" width="4" height="1.6" rx="0.5" fill="#9ca3af"/>
    <rect x="0" y="30" width="4" height="1.6" rx="0.5" fill="#9ca3af"/>
    <rect x="39" y="20" width="4" height="1.6" rx="0.5" fill="#9ca3af"/>
  </g>
  <text x="29" y="39" text-anchor="middle" font-family="monospace" font-size="1.65" font-weight="600" fill="#334155">{title}</text>
</svg>
"""
    return svg

# ──────────────────────────────────────────────────────────────────────────────
# Batteries
# ──────────────────────────────────────────────────────────────────────────────
def battery_9v_svg():
    svg = svg_header("48","62",'0 0 48 62')
    svg += COMMON_DEFS
    svg += """
  <rect x="8" y="8" width="32" height="42" rx="2.2" fill="#1a1a1a" stroke="#000" stroke-width="0.5" filter="url(#softShadow)"/>
  <rect x="8" y="8" width="32" height="42" rx="2.2" fill="url(#bodyGrad)" opacity="0.25"/>
  <rect x="10" y="12" width="28" height="30" rx="1" fill="#2a2a2a"/>
  <rect x="12" y="16" width="24" height="9" rx="0.6" fill="#facc15" opacity="0.95"/>
  <text x="24" y="22.2" text-anchor="middle" font-family="monospace" font-size="3.2" font-weight="800" fill="#111">9V</text>
  <text x="24" y="27" text-anchor="middle" font-family="monospace" font-size="1.55" font-weight="600" fill="#facc15">ALKALINE</text>
  <text x="24" y="35.5" text-anchor="middle" font-family="monospace" font-size="1.4" fill="#e5e7eb">Energizer</text>
  <!-- terminals -->
  <rect x="14" y="4.5" width="6" height="6" rx="0.9" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.35"/>
  <rect x="28" y="4.5" width="6" height="6" rx="0.9" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.35"/>
  <circle cx="17" cy="7.2" r="1.1" fill="#4b5563"/>
  <circle cx="31" cy="7.2" r="2.0" fill="none" stroke="#4b5563" stroke-width="0.35"/>
  <circle cx="31" cy="7.2" r="0.8" fill="#4b5563"/>
  <!-- side lines -->
  <rect x="9" y="43" width="30" height="1.1" rx="0.4" fill="#111"/>
  <rect x="30" y="50" width="6" height="8" rx="0.7" fill="#b45309"/>
</svg>
"""
    return svg

def battery_aa_svg():
    svg = svg_header("64","28",'0 0 64 28')
    svg += COMMON_DEFS
    svg += """
  <rect x="4" y="6" width="52" height="16" rx="7" fill="#0ea5e9" stroke="#0284c7" stroke-width="0.45" filter="url(#softShadow)"/>
  <rect x="4" y="6" width="52" height="16" rx="7" fill="url(#bodyGrad)" opacity="0.22"/>
  <rect x="6" y="8.5" width="48" height="11" rx="5.5" fill="#38bdf8" opacity="0.35"/>
  <rect x="56" y="10.5" width="4.5" height="7" rx="0.7" fill="#e5e7eb" stroke="#94a3b8" stroke-width="0.35"/>
  <text x="30" y="16.2" text-anchor="middle" font-family="monospace" font-size="3.8" font-weight="800" fill="#fff">AA 1.5V</text>
  <!-- terminal rings -->
  <ellipse cx="4" cy="14" rx="1.2" ry="5.5" fill="#94a3b8"/>
  <ellipse cx="60.5" cy="14" rx="0.9" ry="3.2" fill="#cbd5e1"/>
</svg>
"""
    return svg

def battery_coin_svg():
    svg = svg_header("48","28",'0 0 48 28')
    svg += COMMON_DEFS
    svg += """
  <ellipse cx="24" cy="16" rx="18" ry="8.5" fill="#e5e7eb" stroke="#94a3b8" stroke-width="0.5" filter="url(#softShadow)"/>
  <ellipse cx="24" cy="13.5" rx="18" ry="8.5" fill="#f8fafc" stroke="#cbd5e1" stroke-width="0.4"/>
  <ellipse cx="24" cy="13.5" rx="14" ry="5.8" fill="#ffffff" stroke="#e2e8f0" stroke-width="0.35"/>
  <text x="24" y="15.2" text-anchor="middle" font-family="monospace" font-size="3.2" font-weight="800" fill="#0f172a">CR2032</text>
  <text x="24" y="24" text-anchor="middle" font-family="monospace" font-size="1.35" fill="#475569">3V LITHIUM</text>
  <!-- holder legs -->
  <rect x="18" y="21.5" width="2.2" height="4" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
  <rect x="27.8" y="21.5" width="2.2" height="4" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
</svg>
"""
    return svg

# ──────────────────────────────────────────────────────────────────────────────
# OpAmp ideal triangle
# ──────────────────────────────────────────────────────────────────────────────
def opamp_ideal_svg():
    svg = svg_header("64","48",'0 0 64 48')
    svg += COMMON_DEFS
    svg += """
  <rect x="2" y="4" width="60" height="40" rx="3" fill="#fff" stroke="#e2e8f0" stroke-width="0.6" filter="url(#softShadow)"/>
  <!-- triangle -->
  <path d="M20 10 L20 38 L48 24 Z" fill="#fef3c7" stroke="#92400e" stroke-width="0.9"/>
  <text x="31" y="26.5" text-anchor="middle" font-family="monospace" font-size="5.5" font-weight="700" fill="#92400e">▷</text>
  <!-- pins -->
  <rect x="12" y="13.5" width="8" height="1.8" rx="0.5" fill="#9ca3af"/>
  <rect x="12" y="32.5" width="8" height="1.8" rx="0.5" fill="#9ca3af"/>
  <rect x="48" y="23.1" width="8" height="1.8" rx="0.5" fill="#9ca3af"/>
  <text x="8" y="15" font-family="monospace" font-size="1.9" fill="#374151">−</text>
  <text x="8" y="34" font-family="monospace" font-size="1.9" fill="#374151">+</text>
  <text x="57" y="25.2" font-family="monospace" font-size="1.7" fill="#374151">OUT</text>
  <text x="32" y="43" text-anchor="middle" font-family="monospace" font-size="1.45" fill="#6b7280">IDEAL OPAMP</text>
</svg>
"""
    return svg

# ──────────────────────────────────────────────────────────────────────────────
# Power supply bench (similar to signal generator but PSU)
# ──────────────────────────────────────────────────────────────────────────────
def power_supply_svg():
    svg = svg_header("64","40",'0 0 64 40')
    svg += COMMON_DEFS
    svg += """
  <rect x="4" y="6" width="56" height="28" rx="2.2" fill="#0f172a" stroke="#1e293b" stroke-width="0.6" filter="url(#softShadow)"/>
  <rect x="6" y="8" width="52" height="24" rx="1.4" fill="#1e293b"/>
  <!-- display -->
  <rect x="8" y="10" width="32" height="16" rx="1" fill="#000"/>
  <rect x="9" y="11" width="30" height="14" rx="0.6" fill="#0c4a6e"/>
  <text x="24" y="17.5" text-anchor="middle" font-family="monospace" font-size="3.8" font-weight="700" fill="#22d3ee">5.00V</text>
  <text x="24" y="22.2" text-anchor="middle" font-family="monospace" font-size="2.4" font-weight="600" fill="#facc15">1.00A</text>
  <!-- knobs -->
  <circle cx="48" cy="15" r="3.2" fill="#334155" stroke="#475569" stroke-width="0.35"/>
  <circle cx="48" cy="15" r="1" fill="#e2e8f0"/>
  <rect x="47.6" y="11" width="0.8" height="1.8" rx="0.3" fill="#f1f5f9"/>
  <circle cx="48" cy="24" r="3.2" fill="#334155" stroke="#475569" stroke-width="0.35"/>
  <circle cx="48" cy="24" r="1" fill="#e2e8f0"/>
  <rect x="47.6" y="20" width="0.8" height="1.8" rx="0.3" fill="#f1f5f9" transform="rotate(45 48 24)"/>
  <!-- terminals -->
  <circle cx="14" cy="32.5" r="2.2" fill="#dc2626" stroke="#7f1d1d" stroke-width="0.35"/>
  <circle cx="14" cy="32.5" r="0.7" fill="#fca5a5"/>
  <circle cx="22" cy="32.5" r="2.2" fill="#111" stroke="#374151" stroke-width="0.35"/>
  <circle cx="30" cy="32.5" r="2.2" fill="#dc2626" stroke="#7f1d1d" stroke-width="0.35"/>
  <text x="14" y="38" text-anchor="middle" font-family="monospace" font-size="1.3" fill="#e2e8f0">V+</text>
  <text x="22" y="38" text-anchor="middle" font-family="monospace" font-size="1.3" fill="#e2e8f0">GND</text>
  <text x="30" y="38" text-anchor="middle" font-family="monospace" font-size="1.3" fill="#e2e8f0">V−</text>
</svg>
"""
    return svg

def signal_generator_svg():
    svg = svg_header("64","40",'0 0 64 40')
    svg += COMMON_DEFS
    svg += """
  <rect x="4" y="6" width="56" height="28" rx="2.2" fill="#111827" stroke="#1f2937" stroke-width="0.6" filter="url(#softShadow)"/>
  <rect x="6" y="8" width="52" height="24" rx="1.4" fill="#1f2937"/>
  <rect x="8" y="10" width="28" height="14" rx="1" fill="#000"/>
  <path d="M10 18 C12 12 14 22 16 18 C18 14 20 22 22 18 C24 14 26 22 28 18 C30 14 32 22 34 18" fill="none" stroke="#22c55e" stroke-width="0.65" stroke-linecap="round"/>
  <circle cx="46" cy="15" r="3.4" fill="#374151" stroke="#4b5563" stroke-width="0.35"/>
  <circle cx="46" cy="15" r="0.9" fill="#e5e7eb"/>
  <rect x="45.6" y="11.2" width="0.8" height="2" rx="0.3" fill="#f1f5f9"/>
  <text x="46" y="28.5" text-anchor="middle" font-family="monospace" font-size="1.7" font-weight="600" fill="#e5e7eb">FREQ</text>
  <circle cx="18" cy="31.5" r="1.8" fill="#e5e7eb" stroke="#6b7280" stroke-width="0.3"/>
  <circle cx="26" cy="31.5" r="1.8" fill="#111" stroke="#374151" stroke-width="0.3"/>
  <text x="18" y="36.5" text-anchor="middle" font-family="monospace" font-size="1.25" fill="#e2e8f0">OUT</text>
  <text x="26" y="36.5" text-anchor="middle" font-family="monospace" font-size="1.25" fill="#e2e8f0">SYNC</text>
</svg>
"""
    return svg

# ──────────────────────────────────────────────────────────────────────────────
# Displays
# ──────────────────────────────────────────────────────────────────────────────
def lcd_svg(columns, rows, i2c=False, title="16×2"):
    w, h = 78, 44
    svg = svg_header(str(w),str(h),f'0 0 {w} {h}')
    svg += COMMON_DEFS
    # frame
    svg += f'<rect x="2" y="4" width="74" height="36" rx="1.6" fill="#0f172a" stroke="#1e293b" stroke-width="0.6" filter="url(#softShadow)"/>\n'
    # pcb
    svg += f'<rect x="4" y="6" width="70" height="32" rx="1" fill="#0c4a10"/>\n'
    # screen
    svg += f'<rect x="7" y="11" width="64" height="18" rx="0.8" fill="#1a2e0a" stroke="#000" stroke-width="0.3"/>\n'
    svg += f'<rect x="8.5" y="12.5" width="61" height="15" rx="0.5" fill="#84cc16"/>\n'
    # text simulation
    if rows==2:
        svg += f'<text x="39" y="18.5" text-anchor="middle" font-family="monospace" font-size="3" font-weight="700" fill="#0f1f00">Hello World!</text>\n'
        svg += f'<text x="39" y="23.8" text-anchor="middle" font-family="monospace" font-size="2.4" fill="#0f1f00">I2C 0x27 OK</text>\n' if i2c else f'<text x="39" y="23.8" text-anchor="middle" font-family="monospace" font-size="2.4" fill="#0f1f00">Schematic</text>\n'
    else:
        svg += f'<text x="39" y="16" text-anchor="middle" font-family="monospace" font-size="2.2" fill="#0f1f00">LCD 20x4</text>\n'
        svg += f'<text x="39" y="20" text-anchor="middle" font-family="monospace" font-size="1.8" fill="#0f1f00">I2C address 0x27</text>\n'
        svg += f'<text x="39" y="23.2" text-anchor="middle" font-family="monospace" font-size="1.7" fill="#0f1f00">Lines 3 &amp; 4 text</text>\n'
        svg += f'<text x="39" y="26.2" text-anchor="middle" font-family="monospace" font-size="1.7" fill="#0f1f00">bottom row</text>\n'
    # contrast pot
    svg += f'<circle cx="68" cy="32" r="2.3" fill="#60a5fa" stroke="#1e40af" stroke-width="0.35"/>\n'
    svg += f'<circle cx="68" cy="32" r="0.7" fill="#fff"/>\n'
    # i2c backpack vs parallel pins
    if i2c:
        svg += f'<rect x="8" y="34" width="18" height="3" rx="0.4" fill="#1e293b"/>\n'
        for i in range(4):
            svg += f'<rect x="{10+i*4}" y="34.6" width="1.8" height="1.8" rx="0.2" fill="#facc15"/>\n'
        svg += f'<text x="32" y="36.8" font-family="monospace" font-size="1.55" fill="#e2e8f0">GND VCC SDA SCL</text>\n'
    else:
        svg += f'<rect x="8" y="33.5" width="36" height="3.2" rx="0.4" fill="#1e293b"/>\n'
        for i in range(16):
            svg += f'<rect x="{9+i*2.1}" y="34" width="1" height="2.2" rx="0.2" fill="#facc15"/>\n'
    return svg + '</svg>\n'

def epaper_svg(size, bw=True, bwr=False, seven_color=False):
    w, h = 64, 48
    svg = svg_header(str(w),str(h),f'0 0 {w} {h}')
    svg += COMMON_DEFS
    inner_w = 52
    inner_h = 34
    svg += f'<rect x="4" y="6" width="56" height="36" rx="1.6" fill="#e8e2d4" stroke="#a89a80" stroke-width="0.6" filter="url(#softShadow)"/>\n'
    svg += f'<rect x="7" y="9" width="50" height="30" rx="0.8" fill="#f4f1e8" stroke="#a89a80" stroke-width="0.35"/>\n'
    if seven_color:
        svg += f'<circle cx="14" cy="17" r="2" fill="#202020"/><circle cx="20" cy="17" r="2" fill="#c01010"/><circle cx="26" cy="17" r="2" fill="#20a040"/><circle cx="32" cy="17" r="2" fill="#3060c0"/><circle cx="38" cy="17" r="2" fill="#e0c830"/><circle cx="44" cy="17" r="2" fill="#e08020"/>\n'
        svg += f'<text x="32" y="31" text-anchor="middle" font-family="monospace" font-size="3.2" font-weight="700" fill="#5a5040">5.65" ACeP</text>\n'
        svg += f'<text x="32" y="35" text-anchor="middle" font-family="monospace" font-size="1.6" fill="#8a7a60">7-COLOR</text>\n'
    elif bwr:
        svg += f'<circle cx="14" cy="18" r="2.2" fill="#c01818"/>\n'
        svg += f'<text x="34" y="22" text-anchor="middle" font-family="monospace" font-size="2.4" fill="#5a5040">{size}</text>\n'
        svg += f'<text x="34" y="26.5" text-anchor="middle" font-family="monospace" font-size="1.7" fill="#c01818">B/W/R</text>\n'
    else:
        svg += f'<text x="32" y="24" text-anchor="middle" font-family="monospace" font-size="3.4" font-weight="700" fill="#5a5040">{size}</text>\n'
        svg += f'<text x="32" y="28.5" text-anchor="middle" font-family="monospace" font-size="1.5" fill="#8a7a60">e-PAPER</text>\n'
    # connector
    svg += f'<rect x="26" y="42" width="12" height="3.2" rx="0.4" fill="#d49a3c"/>\n'
    for i in range(8):
        svg += f'<rect x="{27+i*1.25}" y="42.6" width="0.7" height="2" rx="0.15" fill="#facc15"/>\n'
    return svg + '</svg>\n'

# ──────────────────────────────────────────────────────────────────────────────
# Breadboard, caps, inductor, franzininho, etc
# ──────────────────────────────────────────────────────────────────────────────
def breadboard_svg(mini=False):
    w, h = 64, 36 if mini else 44
    svg = svg_header(str(w),str(h),f'0 0 {w} {h}')
    svg += COMMON_DEFS
    board_h = 28 if not mini else 22
    svg += f'<rect x="2" y="6" width="60" height="{board_h}" rx="2" fill="#f4f1e8" stroke="#c9b896" stroke-width="0.6" filter="url(#softShadow)"/>\n'
    # rows of holes
    cols = 30 if not mini else 17
    for row in [10, 17, 23, 30] if not mini else [11, 18, 24]:
        for col in range(cols):
            x = 4 + col*1.9
            y = row -2 if not mini else row-1
            svg += f'<circle cx="{x}" cy="{y}" r="0.55" fill="#1a2332" opacity="0.95"/>\n'
            svg += f'<circle cx="{x}" cy="{y}" r="0.28" fill="#000"/>\n'
    # power rails
    svg += f'<rect x="3" y="7" width="58" height="1.2" rx="0.4" fill="#dc2626" opacity="0.85"/>\n'
    svg += f'<rect x="3" y="32" width="58" height="1.2" rx="0.4" fill="#2563eb" opacity="0.85"/>\n' if not mini else f'<rect x="3" y="26" width="58" height="1" rx="0.35" fill="#2563eb" opacity="0.85"/>\n'
    return svg + '</svg>\n'

def cap_ceramic_svg(value="100n"):
    svg = svg_header("52","28",'0 0 52 28')
    svg += COMMON_DEFS
    svg += f"""
  <rect y="13" width="52" height="1.2" fill="url(#leadGrad)" rx="0.3"/>
  <ellipse cx="26" cy="14" rx="12" ry="11" fill="#facc15" stroke="#a16207" stroke-width="0.5" filter="url(#softShadow)"/>
  <ellipse cx="26" cy="14" rx="12" ry="11" fill="url(#bodyGrad)" opacity="0.22"/>
  <ellipse cx="22" cy="10.5" rx="1.2" ry="0.9" fill="#fff" opacity="0.28"/>
  <text x="26" y="15.2" text-anchor="middle" font-family="monospace" font-size="2.8" font-weight="700" fill="#7c2d12">{value}</text>
  <text x="26" y="18.5" text-anchor="middle" font-family="monospace" font-size="1.4" fill="#92400e">104</text>
</svg>
"""
    return svg

def cap_electrolytic_svg(value="100u"):
    svg = svg_header("36","52",'0 0 36 52')
    svg += COMMON_DEFS
    svg += f"""
  <rect x="17" y="28" width="2" height="18" fill="url(#leadGrad)"/>
  <rect x="17" y="6" width="2" height="8" fill="url(#leadGrad)"/>
  <rect x="8" y="10" width="20" height="28" rx="9" fill="#1e293b" stroke="#0f172a" stroke-width="0.5" filter="url(#softShadow)"/>
  <rect x="8" y="10" width="20" height="28" rx="9" fill="url(#bodyGrad)" opacity="0.2"/>
  <rect x="13" y="12" width="1.6" height="24" rx="0.5" fill="#e2e8f0" opacity="0.95"/>
  <rect x="18.5" y="12" width="6" height="24" rx="0.5" fill="#334155" opacity="0.9"/>
  <text x="18" y="25" text-anchor="middle" font-family="monospace" font-size="2.6" font-weight="800" fill="#f8fafc" transform="rotate(-90 18 25)">{value}</text>
  <text x="9.5" y="18" font-family="monospace" font-size="1.6" fill="#f1f5f9">−</text>
  <text x="9.5" y="26" font-family="monospace" font-size="1.6" fill="#f1f5f9">−</text>
  <text x="9.5" y="34" font-family="monospace" font-size="1.6" fill="#f1f5f9">−</text>
</svg>
"""
    return svg

def inductor_svg(value="100u"):
    svg = svg_header("52","28",'0 0 52 28')
    svg += COMMON_DEFS
    svg += f"""
  <rect y="13.5" width="12" height="1.4" fill="url(#leadGrad)" rx="0.3"/>
  <rect x="40" y="13.5" width="12" height="1.4" fill="url(#leadGrad)" rx="0.3"/>
  <g fill="none" stroke="#0f766e" stroke-width="3.2" stroke-linecap="round" filter="url(#softShadow)">
    <path d="M12 14 C14 6 18 6 20 14 C22 22 26 22 28 14 C30 6 34 6 36 14 C38 22 40 14 40 14"/>
  </g>
  <g fill="none" stroke="#14b8a6" stroke-width="0.55" opacity="0.55">
    <path d="M12 14 C14 6 18 6 20 14 C22 22 26 22 28 14 C30 6 34 6 36 14"/>
  </g>
  <text x="26" y="26" text-anchor="middle" font-family="monospace" font-size="1.7" fill="#0f766e">{value}</text>
</svg>
"""
    return svg

def franzininho_svg():
    svg = svg_header("64","48",'0 0 64 48')
    svg += COMMON_DEFS
    svg += """
  <rect x="6" y="8" width="52" height="32" rx="1.4" fill="#1e40af" stroke="#1e3a8a" stroke-width="0.5" filter="url(#softShadow)"/>
  <rect x="6" y="8" width="52" height="32" rx="1.4" fill="url(#bodyGrad)" opacity="0.18"/>
  <rect x="10" y="30" width="44" height="4" rx="0.4" fill="#000" opacity="0.15"/>
  <rect x="14" y="12" width="10" height="8" rx="0.5" fill="#111827" stroke="#374151" stroke-width="0.35"/>
  <rect x="36" y="12" width="14" height="8" rx="0.5" fill="#e5e7eb" stroke="#9ca3af" stroke-width="0.35"/>
  <text x="19" y="16.5" text-anchor="middle" font-family="monospace" font-size="1.55" fill="#f8fafc">MCU</text>
  <text x="43" y="16.5" text-anchor="middle" font-family="monospace" font-size="1.35" fill="#1f2937">USB-C</text>
  <circle cx="18" cy="36" r="1.2" fill="#22c55e"/><circle cx="26" cy="36" r="1.2" fill="#22c55e"/>
  <text x="32" y="42" text-anchor="middle" font-family="monospace" font-size="1.7" font-weight="600" fill="#111827">FRANZININHO</text>
  <!-- pins -->
  <rect x="7" y="40" width="26" height="1.8" rx="0.4" fill="#facc15" opacity="0.95"/>
  <rect x="31" y="40" width="26" height="1.8" rx="0.4" fill="#facc15" opacity="0.95"/>
</svg>
"""
    return svg

def relay_svg():
    svg = svg_header("48","44",'0 0 48 44')
    svg += COMMON_DEFS
    svg += """
  <rect x="8" y="8" width="32" height="24" rx="1.6" fill="#3b82f6" stroke="#1e40af" stroke-width="0.5" filter="url(#softShadow)"/>
  <rect x="8" y="8" width="32" height="24" rx="1.6" fill="url(#bodyGrad)" opacity="0.2"/>
  <rect x="11" y="11" width="26" height="16" rx="0.6" fill="#1e3a8a"/>
  <text x="24" y="18.5" text-anchor="middle" font-family="monospace" font-size="2.6" font-weight="700" fill="#bfdbfe">SRD-05V</text>
  <text x="24" y="22.5" text-anchor="middle" font-family="monospace" font-size="1.55" fill="#93c5fd">10A 250VAC</text>
  <!-- leads -->
  <rect x="12" y="32" width="2.2" height="8" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
  <rect x="18.5" y="32" width="2.2" height="8" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
  <rect x="27.3" y="32" width="2.2" height="8" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
  <rect x="33.8" y="32" width="2.2" height="8" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
</svg>
"""
    return svg

def motor_driver_svg():
    svg = svg_header("64","48",'0 0 64 48')
    svg += COMMON_DEFS
    svg += """
  <rect x="8" y="6" width="48" height="32" rx="1.4" fill="#16a34a" stroke="#14532d" stroke-width="0.5" filter="url(#softShadow)"/>
  <rect x="8" y="6" width="48" height="32" rx="1.4" fill="url(#bodyGrad)" opacity="0.18"/>
  <rect x="12" y="10" width="40" height="22" rx="0.6" fill="#052e16"/>
  <rect x="14" y="12" width="16" height="12" rx="0.6" fill="#111827" stroke="#374151" stroke-width="0.4"/>
  <text x="22" y="19.5" text-anchor="middle" font-family="monospace" font-size="2" font-weight="700" fill="#f3f4f6">L293D</text>
  <rect x="34" y="16" width="14" height="6" rx="0.4" fill="#dc2626"/>
  <text x="41" y="19.8" text-anchor="middle" font-family="monospace" font-size="1.35" fill="#fff">HEAT</text>
  <text x="32" y="35" text-anchor="middle" font-family="monospace" font-size="1.45" fill="#dcfce7">MOTOR DRIVER</text>
  <!-- pins both sides -->
"""
    for i in range(8):
        y = 10 + i*3.2
        svg += f'<rect x="5.5" y="{y}" width="2.5" height="1.2" rx="0.3" fill="#facc15"/>\n'
        svg += f'<rect x="56" y="{y}" width="2.5" height="1.2" rx="0.3" fill="#facc15"/>\n'
    svg += '</svg>\n'
    return svg

def a4988_svg():
    svg = svg_header("56","48",'0 0 56 48')
    svg += COMMON_DEFS
    svg += """
  <rect x="8" y="6" width="40" height="32" rx="1.4" fill="#7c3aed" stroke="#4c1d95" stroke-width="0.5" filter="url(#softShadow)"/>
  <rect x="8" y="6" width="40" height="32" rx="1.4" fill="url(#bodyGrad)" opacity="0.18"/>
  <rect x="12" y="10" width="32" height="12" rx="0.6" fill="#111827"/>
  <text x="28" y="17.5" text-anchor="middle" font-family="monospace" font-size="2.4" font-weight="700" fill="#ddd6fe">A4988</text>
  <rect x="14" y="24" width="10" height="5" rx="0.4" fill="#4c1d95"/>
  <text x="19" y="27.2" text-anchor="middle" font-family="monospace" font-size="1.35" fill="#ddd6fe">POT</text>
  <rect x="32" y="24" width="10" height="5" rx="0.4" fill="#1f2937"/>
  <text x="37" y="27.2" text-anchor="middle" font-family="monospace" font-size="1.15" fill="#9ca3af">MS1</text>
  <text x="28" y="35" text-anchor="middle" font-family="monospace" font-size="1.45" fill="#ede9fe">STEPPER DRIVER</text>
"""
    for i in range(8):
        y = 10 + i*3.2
        svg += f'<rect x="5.5" y="{y}" width="2.5" height="1.2" rx="0.3" fill="#111827"/>\n'
        svg += f'<rect x="48" y="{y}" width="2.5" height="1.2" rx="0.3" fill="#111827"/>\n'
    svg += '</svg>\n'
    return svg

def stepper_motor_svg():
    svg = svg_header("64","48",'0 0 64 48')
    svg += COMMON_DEFS
    svg += """
  <!-- 28BYJ-48 stepper -->
  <ellipse cx="24" cy="20" rx="14" ry="12" fill="#9ca3af" stroke="#6b7280" stroke-width="0.5" filter="url(#softShadow)"/>
  <ellipse cx="24" cy="18" rx="14" ry="12" fill="#d1d5db" stroke="#9ca3af" stroke-width="0.45"/>
  <ellipse cx="24" cy="18" rx="8" ry="6" fill="#6b7280"/>
  <circle cx="24" cy="18" r="2.2" fill="#e5e7eb" stroke="#4b5563" stroke-width="0.3"/>
  <rect x="16" y="30" width="16" height="8" rx="1" fill="#1f2937"/>
  <rect x="38" y="16" width="14" height="4" rx="0.6" fill="#facc15"/>
  <rect x="52" y="14" width="6" height="8" rx="0.7" fill="#fff" stroke="#9ca3af" stroke-width="0.35"/>
  <text x="24" y="36" text-anchor="middle" font-family="monospace" font-size="1.35" fill="#111827">28BYJ-48</text>
  <text x="52" y="32" text-anchor="middle" font-family="monospace" font-size="1.25" fill="#374151">5V</text>
</svg>
"""
    return svg

def generic_sensor_svg(title, icon, color="#0ea5e9", pcb="#0f766e"):
    svg = svg_header("56","48",'0 0 56 48')
    svg += COMMON_DEFS
    svg += f"""
  <rect x="6" y="6" width="44" height="32" rx="1.4" fill="{pcb}" stroke="#064e3b" stroke-width="0.5" filter="url(#softShadow)"/>
  <rect x="6" y="6" width="44" height="32" rx="1.4" fill="url(#bodyGrad)" opacity="0.18"/>
  <circle cx="18" cy="18" r="6" fill="#111827" stroke="#374151" stroke-width="0.35"/>
  <text x="18" y="20.2" text-anchor="middle" font-family="monospace" font-size="4.5" fill="{color}">{icon}</text>
  <rect x="28" y="12" width="14" height="8" rx="0.5" fill="#111827"/>
  <text x="35" y="17.2" text-anchor="middle" font-family="monospace" font-size="1.5" fill="#e5e7eb">OUT</text>
  <rect x="28" y="22" width="14" height="5" rx="0.4" fill="#facc15"/>
  <text x="35" y="25.3" text-anchor="middle" font-family="monospace" font-size="1.15" fill="#422006">VCC GND</text>
  <text x="28" y="34" text-anchor="middle" font-family="monospace" font-size="1.55" font-weight="600" fill="#ecfdf5">{title}</text>
  <!-- pins -->
  <rect x="12" y="38" width="3" height="5" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
  <rect x="26.5" y="38" width="3" height="5" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
  <rect x="41" y="38" width="3" height="5" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
</svg>
"""
    return svg

def ky040_svg():
    svg = svg_header("48","56",'0 0 48 56')
    svg += COMMON_DEFS
    svg += """
  <rect x="8" y="18" width="32" height="22" rx="1.2" fill="#1f2937" stroke="#111827" stroke-width="0.5" filter="url(#softShadow)"/>
  <rect x="8" y="18" width="32" height="22" rx="1.2" fill="url(#bodyGrad)" opacity="0.18"/>
  <circle cx="24" cy="14" r="9" fill="#111827" stroke="#374151" stroke-width="0.6"/>
  <circle cx="24" cy="14" r="7" fill="#374151"/>
  <circle cx="24" cy="14" r="5.5" fill="#4b5563"/>
  <rect x="22.5" y="5" width="3" height="7" rx="0.6" fill="#9ca3af" stroke="#6b7280" stroke-width="0.3"/>
  <text x="24" y="30" text-anchor="middle" font-family="monospace" font-size="1.5" fill="#9ca3af">KY-040</text>
  <text x="24" y="34" text-anchor="middle" font-family="monospace" font-size="1.25" fill="#6b7280">ROTARY</text>
  <rect x="12" y="40" width="3" height="8" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
  <rect x="22" y="40" width="3" height="8" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
  <rect x="32" y="40" width="3" height="8" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
</svg>
"""
    return svg

def membrane_keypad_svg():
    svg = svg_header("64","48",'0 0 64 48')
    svg += COMMON_DEFS
    svg += """
  <rect x="6" y="6" width="52" height="36" rx="1.6" fill="#1f2937" stroke="#111827" stroke-width="0.5" filter="url(#softShadow)"/>
  <rect x="6" y="6" width="52" height="36" rx="1.6" fill="url(#bodyGrad)" opacity="0.18"/>
"""
    keys = ["1","2","3","A","4","5","6","B","7","8","9","C","*","0","#","D"]
    for i, k in enumerate(keys):
        r = i//4
        c = i%4
        x = 11 + c*12
        y = 9 + r*8.2
        svg += f'<rect x="{x}" y="{y}" width="10" height="6.5" rx="0.6" fill="#f8fafc" stroke="#cbd5e1" stroke-width="0.35"/>\n'
        svg += f'<text x="{x+5}" y="{y+4.2}" text-anchor="middle" font-family="monospace" font-size="2.4" font-weight="700" fill="#0f172a">{k}</text>\n'
    svg += '<rect x="20" y="42" width="24" height="2.5" rx="0.6" fill="#facc15"/>\n'
    for i in range(8):
        svg += f'<rect x="{21+i*2.7}" y="42.7" width="1.2" height="1.1" rx="0.2" fill="#92400e"/>\n'
    svg += '</svg>\n'
    return svg

def slide_switch_svg():
    svg = svg_header("48","32",'0 0 48 32')
    svg += COMMON_DEFS
    svg += """
  <rect x="4" y="8" width="40" height="16" rx="1.4" fill="#374151" stroke="#1f2937" stroke-width="0.5" filter="url(#softShadow)"/>
  <rect x="6" y="11" width="36" height="10" rx="0.7" fill="#111827"/>
  <rect x="10" y="12.5" width="14" height="7" rx="0.5" fill="#e5e7eb" stroke="#9ca3af" stroke-width="0.3"/>
  <circle cx="17" cy="16" r="1.2" fill="#6b7280"/>
  <text x="34" y="17.2" text-anchor="middle" font-family="monospace" font-size="1.6" fill="#9ca3af">ON OFF</text>
  <rect x="8" y="24" width="3" height="6" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
  <rect x="22" y="24" width="3" height="6" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
  <rect x="36" y="24" width="3" height="6" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
</svg>
"""
    return svg

def led_bar_svg():
    svg = svg_header("64","32",'0 0 64 32')
    svg += COMMON_DEFS
    svg += '<rect x="4" y="8" width="56" height="16" rx="1.2" fill="#111827" stroke="#1f2937" stroke-width="0.5" filter="url(#softShadow)"/>\n'
    svg += '<rect x="4" y="8" width="56" height="16" rx="1.2" fill="url(#bodyGrad)" opacity="0.18"/>\n'
    colors = ["#22c55e","#22c55e","#eab308","#eab308","#ef4444","#ef4444","#22c55e","#eab308","#ef4444","#22c55e"]
    for i, c in enumerate(colors):
        x = 7 + i*5.3
        svg += f'<rect x="{x}" y="11" width="3.6" height="10" rx="0.5" fill="{c}" stroke="#000" stroke-width="0.25" opacity="0.88"/>\n'
        svg += f'<rect x="{x}" y="11" width="3.6" height="3" rx="0.25" fill="#fff" opacity="0.22"/>\n'
    for i in range(10):
        x = 8.2 + i*5.3
        svg += f'<rect x="{x}" y="24" width="1.2" height="5" rx="0.3" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.28"/>\n'
    svg += '</svg>\n'
    return svg

def hx711_svg():
    svg = svg_header("56","40",'0 0 56 40')
    svg += COMMON_DEFS
    svg += """
  <rect x="6" y="10" width="44" height="22" rx="1.4" fill="#16a34a" stroke="#14532d" stroke-width="0.5" filter="url(#softShadow)"/>
  <rect x="6" y="10" width="44" height="22" rx="1.4" fill="url(#bodyGrad)" opacity="0.18"/>
  <rect x="10" y="14" width="36" height="10" rx="0.6" fill="#052e16"/>
  <rect x="14" y="16" width="12" height="6" rx="0.4" fill="#111827" stroke="#374151" stroke-width="0.3"/>
  <text x="20" y="19.8" text-anchor="middle" font-family="monospace" font-size="1.6" fill="#22c55e">HX711</text>
  <rect x="32" y="16" width="10" height="6" rx="0.4" fill="#dcfce7"/>
  <text x="37" y="19.8" text-anchor="middle" font-family="monospace" font-size="1.25" fill="#14532d">AMP</text>
"""
    for i in range(4):
        y = 12 + i*3.5
        svg += f'<rect x="3.2" y="{y}" width="2.8" height="1.2" rx="0.3" fill="#facc15"/>\n'
        svg += f'<rect x="50" y="{y}" width="2.8" height="1.2" rx="0.3" fill="#facc15"/>\n'
    svg += '</svg>\n'
    return svg

def microsd_svg():
    svg = svg_header("48","36",'0 0 48 36')
    svg += COMMON_DEFS
    svg += """
  <rect x="8" y="6" width="32" height="24" rx="1.2" fill="#3b82f6" stroke="#1e40af" stroke-width="0.5" filter="url(#softShadow)"/>
  <rect x="8" y="6" width="32" height="24" rx="1.2" fill="url(#bodyGrad)" opacity="0.18"/>
  <rect x="14" y="12" width="20" height="12" rx="0.4" fill="#111827"/>
  <rect x="16" y="14" width="16" height="8" rx="0.2" fill="#000"/>
  <rect x="12" y="26" width="24" height="2" rx="0.4" fill="#facc15"/>
  <text x="24" y="10.5" text-anchor="middle" font-family="monospace" font-size="1.35" fill="#dbeafe">MICRO SD</text>
  <text x="24" y="32.5" text-anchor="middle" font-family="monospace" font-size="1.25" fill="#1e3a8a">SPI</text>
"""
    for i in range(6):
        svg += f'<rect x="{12+i*3.7}" y="26.7" width="1.1" height="0.6" rx="0.15" fill="#92400e"/>\n'
    svg += '</svg>\n'
    return svg

def ir_receiver_svg():
    svg = svg_header("36","44",'0 0 36 44')
    svg += COMMON_DEFS
    svg += """
  <rect x="8" y="8" width="20" height="18" rx="1" fill="#111827" stroke="#1f2937" stroke-width="0.5" filter="url(#softShadow)"/>
  <circle cx="18" cy="14" r="5" fill="#1f2937" stroke="#374151" stroke-width="0.3"/>
  <circle cx="18" cy="14" r="3.2" fill="#020617"/>
  <circle cx="18" cy="14" r="1.5" fill="#7c3aed" opacity="0.7"/>
  <text x="18" y="23" text-anchor="middle" font-family="monospace" font-size="1.45" fill="#9ca3af">VS1838</text>
  <rect x="11" y="26" width="2" height="12" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
  <rect x="17" y="26" width="2" height="12" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
  <rect x="23" y="26" width="2" height="12" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
  <text x="12" y="41" text-anchor="middle" font-family="monospace" font-size="1.3" fill="#475569">OUT</text>
  <text x="18" y="41" text-anchor="middle" font-family="monospace" font-size="1.3" fill="#475569">GND</text>
  <text x="24" y="41" text-anchor="middle" font-family="monospace" font-size="1.3" fill="#475569">VCC</text>
</svg>
"""
    return svg

def ir_remote_svg():
    svg = svg_header("36","64",'0 0 36 64')
    svg += COMMON_DEFS
    svg += """
  <rect x="6" y="4" width="24" height="56" rx="3" fill="#1f2937" stroke="#111827" stroke-width="0.5" filter="url(#softShadow)"/>
  <rect x="6" y="4" width="24" height="56" rx="3" fill="url(#bodyGrad)" opacity="0.2"/>
  <circle cx="18" cy="12" r="4.5" fill="#374151" stroke="#4b5563" stroke-width="0.35"/>
  <circle cx="18" cy="12" r="2.8" fill="#dc2626"/>
  <circle cx="18" cy="12" r="1.2" fill="#fca5a5"/>
"""
    for r in range(4):
        for c in range(3):
            x = 9 + c*6
            y = 20 + r*8
            svg += f'<circle cx="{x+3}" cy="{y+3}" r="1.8" fill="#374151" stroke="#4b5563" stroke-width="0.25"/>\n'
            svg += f'<circle cx="{x+3}" cy="{y+3}" r="0.7" fill="#9ca3af"/>\n'
    svg += '<text x="18" y="58" text-anchor="middle" font-family="monospace" font-size="1.25" fill="#9ca3af">IR REMOTE</text>\n</svg>\n'
    return svg

def gps_svg():
    svg = svg_header("56","48",'0 0 56 48')
    svg += COMMON_DEFS
    svg += """
  <rect x="6" y="8" width="44" height="30" rx="1.4" fill="#1e40af" stroke="#1e3a8a" stroke-width="0.5" filter="url(#softShadow)"/>
  <rect x="6" y="8" width="44" height="30" rx="1.4" fill="url(#bodyGrad)" opacity="0.18"/>
  <rect x="10" y="12" width="36" height="18" rx="0.6" fill="#111827"/>
  <rect x="14" y="15" width="10" height="8" rx="0.4" fill="#0f172a" stroke="#334155" stroke-width="0.35"/>
  <text x="19" y="19.8" text-anchor="middle" font-family="monospace" font-size="1.35" fill="#22d3ee">NEO-6M</text>
  <circle cx="36" cy="19" r="3" fill="#e5e7eb" stroke="#94a3b8" stroke-width="0.3"/>
  <path d="M36 16.5 L36 21.5 M33.5 19 L38.5 19" stroke="#475569" stroke-width="0.35"/>
  <text x="28" y="32" text-anchor="middle" font-family="monospace" font-size="1.45" fill="#bfdbfe">GPS u-blox</text>
  <rect x="10" y="34" width="36" height="2" rx="0.4" fill="#facc15"/>
"""
    for i in range(4):
        svg += f'<rect x="{13+i*9}" y="34.6" width="1.4" height="0.8" rx="0.2" fill="#92400e"/>\n'
        svg += f'<rect x="{13+i*9}" y="8.6" width="1.4" height="1.5" rx="0.2" fill="#cbd5e1"/>\n'
    svg += '</svg>\n'
    return svg

def photodiode_svg():
    svg = svg_header("40","36",'0 0 40 36')
    svg += COMMON_DEFS
    svg += """
  <ellipse cx="20" cy="16" rx="10" ry="10" fill="#e0f2fe" stroke="#0284c7" stroke-width="0.5" filter="url(#softShadow)"/>
  <ellipse cx="20" cy="16" rx="10" ry="10" fill="url(#bodyGrad)" opacity="0.18"/>
  <circle cx="20" cy="16" r="5.5" fill="#0c4a6e" stroke="#082f49" stroke-width="0.35"/>
  <circle cx="20" cy="16" r="3" fill="#000"/>
  <!-- light arrows -->
  <g stroke="#f59e0b" stroke-width="0.7" fill="none" marker-end="none">
    <path d="M8 6 L12 10"/><path d="M11 4 L15 8"/><path d="M15 3 L19 7"/>
  </g>
  <rect x="19" y="26" width="2" height="8" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
  <rect x="12" y="26" width="2" height="6" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
  <text x="20" y="34" text-anchor="middle" font-family="monospace" font-size="1.4" fill="#0c4a6e">PHOTODIODE</text>
</svg>
"""
    return svg

def slide_pot_svg():
    svg = svg_header("64","28",'0 0 64 28')
    svg += COMMON_DEFS
    svg += """
  <rect x="4" y="8" width="56" height="12" rx="1.2" fill="#374151" stroke="#1f2937" stroke-width="0.5" filter="url(#softShadow)"/>
  <rect x="6" y="10" width="52" height="8" rx="0.6" fill="#111827"/>
  <rect x="8" y="13" width="48" height="2" rx="0.6" fill="#4b5563"/>
  <rect x="30" y="9" width="8" height="10" rx="0.5" fill="#e5e7eb" stroke="#9ca3af" stroke-width="0.35"/>
  <circle cx="34" cy="14" r="1" fill="#6b7280"/>
  <rect x="8" y="20" width="3" height="5" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
  <rect x="30.5" y="20" width="3" height="5" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
  <rect x="53" y="20" width="3" height="5" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
</svg>
"""
    return svg

def tilt_switch_svg():
    svg = svg_header("52","28",'0 0 52 28')
    svg += COMMON_DEFS
    svg += """
  <rect y="13" width="52" height="1.4" fill="url(#leadGrad)" rx="0.3"/>
  <rect x="10" y="6" width="32" height="16" rx="8" fill="#e5e7eb" stroke="#94a3b8" stroke-width="0.5" filter="url(#softShadow)"/>
  <rect x="10" y="6" width="32" height="16" rx="8" fill="url(#bodyGrad)" opacity="0.15"/>
  <circle cx="32" cy="14" r="3.2" fill="#1f2937" stroke="#111827" stroke-width="0.35"/>
  <circle cx="32" cy="14" r="1.4" fill="#4b5563"/>
  <text x="26" y="26" text-anchor="middle" font-family="monospace" font-size="1.4" fill="#475569">TILT BALL</text>
</svg>
"""
    return svg

def rotary_dialer_svg():
    svg = svg_header("48","48",'0 0 48 48')
    svg += COMMON_DEFS
    svg += """
  <circle cx="24" cy="22" r="16" fill="#f1f5f9" stroke="#94a3b8" stroke-width="0.6" filter="url(#softShadow)"/>
  <circle cx="24" cy="22" r="16" fill="url(#bodyGrad)" opacity="0.12"/>
  <circle cx="24" cy="22" r="3" fill="#1f2937"/>
  <circle cx="24" cy="22" r="1.2" fill="#fff"/>
"""
    for i in range(10):
        ang = -70 + i*32
        import math
        rad = math.radians(ang)
        x = 24 + math.cos(rad)*11
        y = 22 + math.sin(rad)*11
        svg += f'<circle cx="{x:.1f}" cy="{y:.1f}" r="1.6" fill="#334155" stroke="#1e293b" stroke-width="0.25"/>\n'
        svg += f'<text x="{x:.1f}" y="{y+0.5:.1f}" text-anchor="middle" font-family="monospace" font-size="1.25" font-weight="600" fill="#fff">{i}</text>\n'
    svg += '<text x="24" y="44" text-anchor="middle" font-family="monospace" font-size="1.35" fill="#475569">ROTARY</text>\n</svg>\n'
    return svg

# ──────────────────────────────────────────────────────────────────────────────
# Build all files
# ──────────────────────────────────────────────────────────────────────────────
def build_all():
    # Diodes
    write("diode", diode_svg("diode", "Diode", body="#2b2b2b", band="#c0c0c0"))
    write("diode-1n4007", diode_svg("1N4007", "1N4007", body="#1a1a1a", band="#cbd5e1", band2="#94a3b8"))
    write("diode-1n4148", diode_svg("1N4148", "1N4148", body="#d1c7a5", band="#1f2937", glass=True))
    write("zener-1n4733", diode_svg("Zener 5.1V", "Zener", body="#1e293b", band="#f59e0b", zener=True))
    write("diode-1n5817", diode_svg("Schottky 20V", "1N5817", body="#334155", band="#facc15", schottky=True, glass=True))
    write("diode-1n5819", diode_svg("Schottky 40V", "1N5819", body="#334155", band="#f59e0b", schottky=True, glass=True))

    # Transistors
    write("bjt-2n2222", to92_svg("2N2222", "NPN"))
    write("bjt-2n3906", to92_svg("2N3906", "PNP"))
    write("bjt-bc547", to92_svg("BC547", "NPN"))
    write("bjt-bc557", to92_svg("BC557", "PNP"))
    write("bjt-2n3055", to3_svg("2N3055"))
    write("mosfet-2n7000", to92_svg("2N7000", "MOSFET", "N-CH"))
    write("mosfet-fqp27p06", to220_svg("FQP27P06", "P-MOSFET"))
    write("mosfet-irf540", to220_svg("IRF540", "N-MOSFET", "100V 33A"))
    write("mosfet-irf9540", to220_svg("IRF9540", "P-MOSFET", "100V 19A"))

    # Optocouplers
    write("opto-4n25", dip_svg("4N25", "4N25", "OPTO", pins=6))
    write("opto-pc817", dip_svg("PC817", "PC817", "OPTO", pins=4))

    # Regulators
    write("reg-7805", to220_svg("7805", "+5V REG"))
    write("reg-7812", to220_svg("7812", "+12V REG"))
    write("reg-7905", to220_svg("7905", "−5V REG", tab_color="#fecaca"))
    write("reg-lm317", to220_svg("LM317", "ADJ REG"))

    # Batteries
    write("battery-9v", battery_9v_svg())
    write("battery-aa", battery_aa_svg())
    write("battery-coin-cell", battery_coin_svg())

    # OpAmps
    write("opamp-ideal", opamp_ideal_svg())
    write("opamp-lm324", dip_svg("LM324", "LM324", "QUAD OPAMP", pins=14))
    write("opamp-lm358", dip_svg("LM358", "LM358", "DUAL OPAMP", pins=8))
    write("opamp-lm741", dip_svg("LM741", "LM741", "OPAMP", pins=8))
    write("opamp-tl072", dip_svg("TL072", "TL072", "JFET OPAMP", pins=8))

    # Power / Signal
    write("power-supply", power_supply_svg())
    write("signal-generator", signal_generator_svg())

    # E-paper variants (create distinct per size)
    write("epaper-1in54-bw", epaper_svg('1.54"', bw=True))
    write("epaper-2in13-bw", epaper_svg('2.13"', bw=True))
    write("epaper-2in13-bwr", epaper_svg('2.13"', bwr=True))
    write("epaper-2in9-bw", epaper_svg('2.9"', bw=True))
    write("epaper-2in9-bwr", epaper_svg('2.9"', bwr=True))
    write("epaper-4in2-bw", epaper_svg('4.2"', bw=True))
    write("epaper-5in65-7c", epaper_svg('5.65"', seven_color=True))
    write("epaper-7in5-bw", epaper_svg('7.5"', bw=True))

    # LCDs
    write("lcd1602", lcd_svg(16,2, i2c=False, title="16×2"))
    write("lcd1602-i2c", lcd_svg(16,2, i2c=True))
    write("lcd2004-i2c", lcd_svg(20,4, i2c=True))
    write("ssd1306-i2c-4pin", svg_header("64","42",'0 0 64 42') + COMMON_DEFS + """
  <rect x="4" y="4" width="56" height="32" rx="1.4" fill="#025CAF" stroke="#0c4a6e" stroke-width="0.5" filter="url(#softShadow)"/>
  <rect x="6" y="6" width="52" height="24" rx="0.6" fill="#111827"/>
  <rect x="8" y="10" width="48" height="16" rx="0.4" fill="#000"/>
  <text x="32" y="17" text-anchor="middle" font-family="monospace" font-size="2.2" fill="#22d3ee">SSD1306 0.96"</text>
  <text x="32" y="21.5" text-anchor="middle" font-family="monospace" font-size="1.55" fill="#e5e7eb">128×64 OLED</text>
  <rect x="10" y="30" width="20" height="2.5" rx="0.4" fill="#1e293b"/>
  <rect x="12" y="31" width="2" height="1" rx="0.2" fill="#facc15"/><rect x="16" y="31" width="2" height="1" rx="0.2" fill="#facc15"/><rect x="20" y="31" width="2" height="1" rx="0.2" fill="#facc15"/><rect x="24" y="31" width="2" height="1" rx="0.2" fill="#facc15"/>
  <text x="32" y="38" text-anchor="middle" font-family="monospace" font-size="1.25" fill="#475569">4-PIN I2C</text>
</svg>
""")

    # Drivers / Relay / Motors
    write("motor-driver-l293d", motor_driver_svg())
    write("relay", relay_svg())
    write("a4988", a4988_svg())
    write("stepper-motor", stepper_motor_svg())
    write("biaxial-stepper", stepper_motor_svg())  # reuse but could differentiate

    # Input modules
    write("dip-switch-8", dip_switch_svg())
    write("ky-040", ky040_svg())
    write("membrane-keypad", membrane_keypad_svg())
    write("slide-switch", slide_switch_svg())
    write("rotary-dialer", rotary_dialer_svg())
    write("slide-potentiometer", slide_pot_svg())
    write("tilt-switch", tilt_switch_svg())

    # Logic ICs DIP
    write("ic-74hc00", dip_svg("74HC00", "74HC00", "QUAD NAND", pins=14))
    write("ic-74hc02", dip_svg("74HC02", "74HC02", "QUAD NOR", pins=14))
    write("ic-74hc04", dip_svg("74HC04", "74HC04", "HEX NOT", pins=14))
    write("ic-74hc08", dip_svg("74HC08", "74HC08", "QUAD AND", pins=14))
    write("ic-74hc14", dip_svg("74HC14", "74HC14", "HEX SCHMITT", pins=14))
    write("ic-74hc32", dip_svg("74HC32", "74HC32", "QUAD OR", pins=14))
    write("ic-74hc86", dip_svg("74HC86", "74HC86", "QUAD XOR", pins=14))

    # Logic gates single
    write("logic-gate-and", logic_gate_svg("AND", "AND", "AND"))
    write("logic-gate-and-3", logic_gate_svg("AND-3", "3-IN AND", "AND"))
    write("logic-gate-and-4", logic_gate_svg("AND-4", "4-IN AND", "AND"))
    write("logic-gate-nand", logic_gate_svg("NAND", "NAND", "NAND"))
    write("logic-gate-nand-3", logic_gate_svg("NAND-3", "3-IN NAND", "NAND"))
    write("logic-gate-nand-4", logic_gate_svg("NAND-4", "4-IN NAND", "NAND"))
    write("logic-gate-nor", logic_gate_svg("NOR", "NOR", "NOR"))
    write("logic-gate-nor-3", logic_gate_svg("NOR-3", "3-IN NOR", "NOR"))
    write("logic-gate-nor-4", logic_gate_svg("NOR-4", "4-IN NOR", "NOR"))
    write("logic-gate-not", logic_gate_svg("NOT", "NOT", "NOT"))
    write("logic-gate-or", logic_gate_svg("OR", "OR", "OR"))
    write("logic-gate-or-3", logic_gate_svg("OR-3", "3-IN OR", "OR"))
    write("logic-gate-or-4", logic_gate_svg("OR-4", "4-IN OR", "OR"))
    write("logic-gate-xor", logic_gate_svg("XOR", "XOR", "XOR"))
    write("logic-gate-xnor", logic_gate_svg("XNOR", "XNOR", "XNOR"))
    write("flip-flop-d", logic_gate_svg("D-FF", "D FLIP-FLOP", "DFF"))
    write("flip-flop-jk", logic_gate_svg("JK-FF", "JK FLIP-FLOP", "JK"))
    write("flip-flop-t", logic_gate_svg("T-FF", "T FLIP-FLOP", "T"))

    # Sensors / modules
    write("big-sound-sensor", generic_sensor_svg("BIG SOUND", "◉", "#ef4444", "#7f1d1d"))
    write("flame-sensor", generic_sensor_svg("FLAME", "🔥", "#f97316", "#7c2d12"))
    write("gas-sensor", generic_sensor_svg("MQ-2 GAS", "◍", "#22c55e", "#14532d"))
    write("heart-beat-sensor", generic_sensor_svg("HEART", "♥", "#ec4899", "#831843"))
    write("hx711", hx711_svg())
    write("ks2e-m-dc5", generic_sensor_svg("KS2E DC5", "▭", "#3b82f6", "#1e3a8a"))
    write("microsd-card", microsd_svg())
    write("small-sound-sensor", generic_sensor_svg("SOUND", "◎", "#a855f7", "#581c87"))
    write("ds3231", dip_svg("DS3231", "DS3231", "RTC I2C", pins=8))  # but better as module
    # Override ds3231 as RTC module similar to ds1307 but distinct
    # We'll redo ds3231 as board module
    write("ds3231", svg_header("56","40",'0 0 56 40') + COMMON_DEFS + """
  <rect x="6" y="8" width="44" height="24" rx="1.4" fill="#7c3aed" stroke="#4c1d95" stroke-width="0.5" filter="url(#softShadow)"/>
  <rect x="6" y="8" width="44" height="24" rx="1.4" fill="url(#bodyGrad)" opacity="0.18"/>
  <rect x="10" y="12" width="18" height="12" rx="5" fill="#e5e7eb" stroke="#94a3b8" stroke-width="0.35"/>
  <text x="19" y="19.2" text-anchor="middle" font-family="monospace" font-size="1.6" fill="#1f2937">CR2032</text>
  <rect x="32" y="14" width="12" height="8" rx="0.4" fill="#111827"/>
  <text x="38" y="18.5" text-anchor="middle" font-family="monospace" font-size="1.35" fill="#22d3ee">DS3231</text>
  <text x="28" y="28" text-anchor="middle" font-family="monospace" font-size="1.45" fill="#ede9fe">RTC HIGH-PRECISION</text>
  <rect x="12" y="32" width="3" height="5" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
  <rect x="26" y="32" width="3" height="5" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
  <rect x="40" y="32" width="3" height="5" rx="0.4" fill="#c8c8c8" stroke="#6b7280" stroke-width="0.3"/>
</svg>
""")
    write("led-bar-graph", led_bar_svg())
    write("breadboard", breadboard_svg(mini=False))
    write("breadboard-mini", breadboard_svg(mini=True))
    # Caps
    write("capacitor", cap_ceramic_svg("100n"))
    write("cap-1n", cap_ceramic_svg("1n"))
    write("cap-1u", cap_ceramic_svg("1u"))
    write("cap-10n", cap_ceramic_svg("10n"))
    write("cap-10p", cap_ceramic_svg("10p"))
    write("cap-100n", cap_ceramic_svg("100n"))
    write("cap-100p", cap_ceramic_svg("100p"))
    write("cap-22p", cap_ceramic_svg("22p"))
    write("cap-elec-1u", cap_electrolytic_svg("1u"))
    write("cap-elec-10u", cap_electrolytic_svg("10u"))
    write("cap-elec-100u", cap_electrolytic_svg("100u"))
    write("cap-elec-1000u", cap_electrolytic_svg("1000u"))
    write("cap-elec-47u", cap_electrolytic_svg("47u"))
    write("cap-elec-470u", cap_electrolytic_svg("470u"))
    write("capacitor-electrolytic", cap_electrolytic_svg("47u"))
    write("franzininho", franzininho_svg())
    write("inductor", inductor_svg("100u"))
    write("ind-1m", inductor_svg("1mH"))
    write("ind-10m", inductor_svg("10mH"))
    write("ind-100u", inductor_svg("100uH"))
    write("ir-receiver", ir_receiver_svg())
    write("ir-remote", ir_remote_svg())
    write("gps-neo6m", gps_svg())
    write("photodiode", photodiode_svg())

if __name__ == "__main__":
    build_all()
    print("All SVGs generated")
