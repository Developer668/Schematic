from app.components.importer import analyze_import, detect

def test_detect_spice():
    assert detect("drv8871.lib")["engine"] == "ngspice"

def test_detect_svd():
    assert detect("stm32.svd")["engine"] == "renode"

def test_analyze():
    a = analyze_import(["a.lib","b.s2p","c.step"])
    assert "ngspice" in a["engines"]
    assert "scikit-rf" in a["engines"]
    assert a["fidelity"]["spice"] is True
