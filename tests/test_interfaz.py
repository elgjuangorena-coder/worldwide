"""Aspecto del cuaderno (unidad 007, criterios R1-R3).

Lee los ficheros de la interfaz. No abre el navegador y no toca la red.
"""
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]


def texto(relativo):
    return (RAIZ / relativo).read_text(encoding="utf-8")


class InterfazDelCuaderno(unittest.TestCase):
    def test_el_pellizco_no_esta_bloqueado(self):
        html = texto("index.html")
        self.assertNotIn("maximum-scale", html)

    def test_la_interfaz_usa_la_paleta_del_cuaderno(self):
        css = texto("css/styles.css")
        for color in ("#FFF7ED", "#0F172A", "#0891B2", "#EA580C"):
            self.assertIn(color, css)

    def test_los_controles_caben_en_el_dedo(self):
        css = texto("css/styles.css")
        for selector in (".btn", ".icon-btn", ".ctrl-btn", "#search-input"):
            self.assertIn(selector, css)
        self.assertIn("min-height: 44px", css)
        self.assertIn("gap: 8px", css)

    def test_el_texto_puede_bajar_de_linea(self):
        css = texto("css/styles.css")
        self.assertNotIn("white-space: nowrap", css)

    def test_visitado_es_gris_y_los_chips_se_distinguen(self):
        mapa = texto("js/map.js")
        interfaz = texto("js/ui.js")
        self.assertNotIn("#3ddc84", mapa)
        self.assertIn("#64748B", mapa)
        self.assertIn("chip-ver", interfaz)
        self.assertIn("chip-comer", interfaz)

    def test_el_modo_oscuro_cubre_la_pagina(self):
        css = texto("css/styles.css")
        mapa = texto("js/map.js")
        self.assertIn('[data-theme="dark"]', css)
        self.assertIn("dataset.theme", mapa)
        self.assertIn("applyPageTheme", mapa)

    def test_menos_movimiento_y_foco_visible(self):
        css = texto("css/styles.css")
        self.assertIn("prefers-reduced-motion", css)
        self.assertIn(":focus-visible", css)


if __name__ == "__main__":
    unittest.main()
