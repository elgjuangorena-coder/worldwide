"""Arrastre del bottom sheet en el celular (008, R1-R2).

La ficha se sube y se baja con el dedo en la lista. Arriba del todo el buscador
sigue visible y tapa la zona de arriba; la lista, al inicio, baja la ficha.
"""
import json
import subprocess
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]

CASOS = [
    {
        "nombre": "sube desde la lista",
        "dy": 48,
        "atFull": False,
        "scrollTop": 0,
        "scrolling": True,
        "onList": True,
        "esperado": "sheet",
    },
    {
        "nombre": "baja desde la lista con el buscador encima",
        "dy": -48,
        "atFull": True,
        "scrollTop": 0,
        "scrolling": True,
        "onList": True,
        "esperado": "sheet",
    },
    {
        "nombre": "la lista se desplaza si ya está arriba y hay más",
        "dy": 48,
        "atFull": True,
        "scrollTop": 0,
        "scrolling": True,
        "onList": True,
        "esperado": "scroll",
    },
    {
        "nombre": "bajar con la lista ya movida desplaza la lista",
        "dy": -48,
        "atFull": True,
        "scrollTop": 24,
        "scrolling": True,
        "onList": True,
        "esperado": "scroll",
    },
    {
        "nombre": "un toque corto no arrastra",
        "dy": 3,
        "atFull": False,
        "scrollTop": 0,
        "scrolling": True,
        "onList": True,
        "esperado": "tap",
    },
    {
        "nombre": "la barra de arriba sigue arrastrando la ficha",
        "dy": -40,
        "atFull": False,
        "scrollTop": 0,
        "scrolling": True,
        "onList": False,
        "esperado": "sheet",
    },
]


class BottomSheet(unittest.TestCase):
    def test_el_dedo_en_la_lista_decide_ficha_o_scroll(self):
        script = """
import { gestureMode } from './js/ui.js';
const casos = %s;
const mal = [];
for (const caso of casos) {
  const { esperado, nombre, ...entrada } = caso;
  const visto = gestureMode(entrada);
  if (visto !== esperado) mal.push({ nombre, esperado, visto });
}
if (mal.length) {
  console.error(JSON.stringify(mal));
  process.exit(1);
}
""" % json.dumps(CASOS)
        result = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            cwd=RAIZ,
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            result.returncode,
            0,
            result.stdout + result.stderr,
        )

    def test_el_arrastre_empieza_en_la_ficha(self):
        ui = (RAIZ / "js/ui.js").read_text(encoding="utf-8")
        self.assertIn("sheet.addEventListener('pointerdown'", ui)
        self.assertIn("gestureMode(", ui)
        self.assertNotIn("e.target.closest('button')", ui)

    def test_el_buscador_sigue_por_encima(self):
        css = (RAIZ / "css/styles.css").read_text(encoding="utf-8")
        movil = css.split("@media (max-width: 767px)", 1)[1]
        self.assertIn("z-index: 20", movil)
        self.assertIn("z-index: 15", movil)


if __name__ == "__main__":
    unittest.main()
