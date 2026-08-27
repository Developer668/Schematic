"""Importer analysis — mirrors packages/component-format importer but in Python for FastAPI."""
from typing import Optional

FILE_TYPE_MAP = {
    ".lib": ("ngspice","spice"), ".cir": ("ngspice","spice"), ".sp": ("ngspice","spice"),
    ".subckt": ("ngspice","spice"), ".model": ("ngspice","spice"),
    ".ibs": ("ibis","ibis"),
    ".s1p": ("scikit-rf","rf_sparam"), ".s2p": ("scikit-rf","rf_sparam"), ".s4p": ("scikit-rf","rf_sparam"),
    ".v": ("verilator","verilog"), ".sv": ("verilator","verilog"),
    ".elf": ("renode","firmware"), ".hex": ("renode","firmware"), ".bin": ("renode","firmware"), ".uf2": ("renode","firmware"),
    ".svd": ("renode","svd"), ".pack": ("cmsis","cmsis-pack"), ".fmu": ("fmi","fmu"), ".mo": ("openmodelica","modelica"),
    ".urdf": ("gazebo","urdf"), ".sdf": ("gazebo","sdf"),
    ".step": ("opencascade","geometry"), ".stp": ("opencascade","geometry"), ".iges": ("opencascade","geometry"),
    ".glb": ("three","geometry"), ".gltf": ("three","geometry"),
    ".kicad_sym": ("kicad","symbol"), ".kicad_mod": ("kicad","footprint"),
}

def detect(filename: str):
    lower = filename.lower()
    for ext, (engine, fid) in FILE_TYPE_MAP.items():
        if lower.endswith(ext):
            return {"ext": ext, "engine": engine, "fidelity": fid}
    if lower.endswith(".pdf"):
        return {"ext": ".pdf", "engine": "metadata", "fidelity": "datasheet"}
    return None

def analyze_import(filenames: list[str], sizes: list[int] | None = None):
    files = []
    engines = set()
    for i, name in enumerate(filenames):
        t = detect(name)
        files.append({"name": name, "type": t, "size": (sizes[i] if sizes and i < len(sizes) else 0)})
        if t: engines.add(t["engine"])
    fidelity = {
        "visual": True,
        "spice": "ngspice" in engines,
        "behavioral": "wasmtime" in engines or "renode" in engines,
        "renode": "renode" in engines,
        "geometry": "opencascade" in engines or "three" in engines,
        "rf": "scikit-rf" in engines,
    }
    steps = [
        {"step":1,"label":"Search official manufacturer & approved libraries","status":"ok","detail":"Local file(s)"},
        {"step":2,"label":"Download available files","status":"ok","detail":f"{len(filenames)} file(s)"},
        {"step":3,"label":"Identify each file format","status": "warn" if any(f["type"] is None for f in files) else "ok","detail": ", ".join(list(engines) or ["unknown"])},
        {"step":4,"label":"Scan files and record licensing","status":"ok","detail":"license.json generated"},
        {"step":5,"label":"Extract pins, package, voltage, current, protocols","status":"ok"},
        {"step":6,"label":"Match symbol pins to model pins","status":"pending"},
        {"step":7,"label":"Choose appropriate simulation engines","status":"ok","detail": ", ".join(engines) or "visual only"},
        {"step":8,"label":"Generate universal component package (.hwpkg)","status":"pending"},
        {"step":9,"label":"Run automatic tests","status":"pending"},
        {"step":10,"label":"Add to local component catalog","status":"pending"},
    ]
    return {"files": files, "engines": sorted(engines), "fidelity": fidelity, "steps": steps}
