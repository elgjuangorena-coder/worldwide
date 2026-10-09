"""Los tres enlaces de unpkg citan una versión concreta y llevan sello de integridad."""
import re
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
HTML = RAIZ / "index.html"

NOMBRES = ("maplibre-gl.css", "maplibre-gl.js", "turf.min.js")
VERSION = re.compile(r"@\d+\.\d+\.\d+/")
SELLO = re.compile(r"""integrity=["']sha384-[A-Za-z0-9+/=]+["']""")
CRUZADO = re.compile(r"""crossorigin=["']anonymous["']""")


def problemas(html):
    """Devuelve una frase por cada enlace de unpkg que no está fijado."""
    fallos = []
    for nombre in NOMBRES:
        linea = next((n for n in html.splitlines() if nombre in n and "unpkg.com" in n), None)
        if linea is None:
            fallos.append(f"falta el enlace de {nombre}")
            continue
        if not VERSION.search(linea):
            fallos.append(f"{nombre}: la versión no tiene parche")
        if not SELLO.search(linea):
            fallos.append(f"{nombre}: falta el sello de integridad")
        if not CRUZADO.search(linea):
            fallos.append(f"{nombre}: falta crossorigin")
    return fallos


class ScriptsFijosTest(unittest.TestCase):
    def test_r1_los_tres_enlaces_estan_fijados(self):
        fallos = problemas(HTML.read_text(encoding="utf-8"))
        self.assertEqual(fallos, [], "R1: " + "; ".join(fallos))

    def test_r2_sin_sello_la_comprobacion_es_roja(self):
        html = HTML.read_text(encoding="utf-8")
        if not SELLO.search(html):
            html = html.replace(
                "maplibre-gl.css\">",
                'maplibre-gl.css" integrity="sha384-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" crossorigin="anonymous">',
                1,
            )
        roto = SELLO.sub("", html, count=1)
        self.assertNotEqual(html, roto)
        fallos = problemas(roto)
        self.assertTrue(any("sello" in f for f in fallos), "R2: " + "; ".join(fallos))


if __name__ == "__main__":
    unittest.main()
