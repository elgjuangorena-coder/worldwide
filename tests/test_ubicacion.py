"""Botón «mi ubicación» con punto azul (unidad 009, criterios R1-R6).

Lee los ficheros de la interfaz, como test_interfaz.py. No abre el navegador, no pide
ninguna ubicación y no toca la red: el permiso real, el vuelo y el punto los prueba Luis
en la app corriendo.
"""
import re
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]


def texto(relativo):
    return (RAIZ / relativo).read_text(encoding="utf-8")


def cuerpo_de_funcion(fuente, nombre):
    """Devuelve el cuerpo (entre llaves) de `function nombre(`, o None si no está."""
    encontrada = re.search(r"function\s+" + re.escape(nombre) + r"\s*\(", fuente)
    if not encontrada:
        return None
    inicio = fuente.index("{", encontrada.end())
    nivel = 0
    for i in range(inicio, len(fuente)):
        if fuente[i] == "{":
            nivel += 1
        elif fuente[i] == "}":
            nivel -= 1
            if nivel == 0:
                return fuente[inicio + 1:i]
    return None


def regla_css(css, selector):
    encontrada = re.search(re.escape(selector) + r"\s*\{([^}]*)\}", css)
    return encontrada.group(1) if encontrada else None


def boton(html, ident):
    encontrada = re.search(r'<button\b[^>]*\bid="' + re.escape(ident) + r'"[^>]*>', html)
    return encontrada.group(0) if encontrada else None


class Caso(unittest.TestCase):
    def busca(self, fuente, patron, mensaje):
        """Como assertRegex, pero sin volcar el fichero entero en el rojo."""
        self.assertIsNotNone(re.search(patron, fuente), mensaje)

    def no_busca(self, fuente, patron, mensaje):
        """Como assertNotRegex, pero sin volcar el fichero entero en el rojo."""
        self.assertIsNone(re.search(patron, fuente), mensaje)


class BotonDeUbicacion(Caso):
    """R1: el botón vive en la columna de controles, debajo de la luna, a 44 px y con nombre."""

    def test_r1_boton_debajo_de_la_luna_con_nombre(self):
        html = texto("index.html")
        etiqueta = boton(html, "locate-btn")
        self.assertIsNotNone(etiqueta, "R1: no hay botón #locate-btn en index.html")
        self.assertIn('class="ctrl-btn"', etiqueta, "R1: #locate-btn no usa la clase ctrl-btn")
        self.busca(etiqueta, r'aria-label="[^"]+"', "R1: #locate-btn sin nombre para lectores")
        self.busca(etiqueta, r'title="[^"]+"', "R1: #locate-btn sin title")

        controles = re.search(r'<div class="map-controls">(.*?)</div>', html, re.S)
        self.assertIsNotNone(controles, "R1: falta la columna .map-controls")
        bloque = controles.group(1)
        self.assertIn('id="locate-btn"', bloque, "R1: #locate-btn está fuera de .map-controls")
        orden = re.findall(r'<button\b[^>]*\bid="([^"]+)"', bloque)
        self.assertIn("style-btn", orden, "R1: la luna ya no está en .map-controls")
        self.assertEqual(
            orden.index("locate-btn"), orden.index("style-btn") + 1,
            f"R1: #locate-btn no va justo debajo de la luna: {orden}",
        )

        css = texto("css/styles.css")
        regla = regla_css(css, ".ctrl-btn")
        self.assertIsNotNone(regla, "R1: falta la regla .ctrl-btn")
        self.assertIn("min-height: 44px", regla, "R1: .ctrl-btn ya no mide 44 px")


class PosicionDada(Caso):
    """R2 (portante): con la posición, el mapa vuela a zoom de calle y aparece el punto."""

    def test_r2_con_posicion_vuela_a_zoom_de_calle_y_pone_el_punto(self):
        app = texto("js/app.js")
        mapa = texto("js/map.js")

        self.busca(
            app,
            r"M\.showMyLocation\(\s*\[\s*\w+\.coords\.longitude\s*,\s*\w+\.coords\.latitude\s*\]\s*\)",
            "R2: app.js no pasa [longitud, latitud] a M.showMyLocation",
        )
        self.busca(mapa, r"export\s+function\s+showMyLocation\s*\(",
                         "R2: map.js no exporta showMyLocation")
        cuerpo = cuerpo_de_funcion(mapa, "showMyLocation")
        self.assertIsNotNone(cuerpo, "R2: showMyLocation no tiene cuerpo")
        self.assertIn("new maplibregl.Marker", cuerpo, "R2: showMyLocation no crea el punto")
        self.assertIn("me-dot", cuerpo, "R2: el punto no usa el elemento .me-dot")
        self.assertIn("setLngLat(", cuerpo, "R2: el punto no se coloca en la posición")
        self.assertIn(".addTo(map)", cuerpo, "R2: el punto no se añade al mapa")
        vuelo = re.search(r"\bflyTo\(\s*\w+\s*,\s*(\d+)\s*\)", cuerpo)
        self.assertIsNotNone(vuelo, "R2: showMyLocation no vuela a la posición con flyTo")
        self.assertGreaterEqual(int(vuelo.group(1)), 16, "R2: el vuelo no llega a zoom de calle (16)")

    def test_r2_la_politica_no_bloquea_la_ubicacion(self):
        html = texto("index.html")
        self.no_busca(html, r"(?i)geolocation\s*=?\s*\(\s*\)",
                            "R2: una política de permisos bloquea la geolocalización")
        self.assertNotIn("Permissions-Policy", html, "R2: index.html declara una Permissions-Policy")


class SinPosicion(Caso):
    """R3: sin permiso, sin señal, tarde o sin soporte → aviso corto y el mapa no se mueve."""

    def test_r3_un_aviso_por_cada_caso_y_el_mapa_no_se_mueve(self):
        app = texto("js/app.js")
        cuerpo = cuerpo_de_funcion(app, "locateMe")
        self.assertIsNotNone(cuerpo, "R3: app.js no tiene locateMe()")

        sin_soporte = re.search(r"if\s*\(\s*!\s*navigator\.geolocation\s*\)\s*\{(.*?)\}", cuerpo, re.S)
        self.assertIsNotNone(sin_soporte, "R3: no se mira si el navegador sabe de ubicación")
        self.assertIn("UI.toast(", sin_soporte.group(1), "R3: sin soporte no sale aviso")
        self.assertIn("return", sin_soporte.group(1), "R3: sin soporte sigue adelante")

        avisos = re.search(r"LOCATE_ERRORS\s*=\s*\{(.*?)\}", app, re.S)
        self.assertIsNotNone(avisos, "R3: no hay un aviso por cada código de error")
        for codigo in ("1", "2", "3"):
            self.busca(avisos.group(1), r"\b" + codigo + r"\s*:\s*'[^']+'",
                             f"R3: falta el aviso del código {codigo}")

        error = re.search(r"\(error\)\s*=>\s*\{(.*?)\}", cuerpo, re.S)
        self.assertIsNotNone(error, "R3: getCurrentPosition no maneja el error")
        self.assertIn("UI.toast(LOCATE_ERRORS[error.code]", error.group(1),
                      "R3: el error no saca su aviso")
        for prohibido in ("showMyLocation", "flyTo", "Marker"):
            self.assertNotIn(prohibido, error.group(1), f"R3: con error se llama a {prohibido}")
        self.assertEqual(app.count("showMyLocation"), 1,
                         "R3: showMyLocation se llama fuera del camino de éxito")

    def test_r3_espera_acotada_y_boton_ocupado(self):
        cuerpo = cuerpo_de_funcion(texto("js/app.js"), "locateMe")
        self.assertIsNotNone(cuerpo, "R3: app.js no tiene locateMe()")
        self.busca(cuerpo, r"timeout:\s*10000", "R3: la espera no tiene tope")
        self.assertIn("aria-busy", cuerpo, "R3: el botón no avisa de que está buscando")


class SoloAlPulsar(Caso):
    """R4, R5, R6: no se pide al abrir; el punto no intercepta toques; nunca hay dos puntos."""

    def test_r4_la_ubicacion_solo_se_pide_al_pulsar(self):
        app = texto("js/app.js")
        for nombre in ("app.js", "map.js", "ui.js", "boundaries.js", "landmarks.js", "names.js", "utils.js"):
            fuente = texto("js/" + nombre)
            self.assertNotIn("watchPosition", fuente, f"R4: {nombre} sigue la posición")
            if nombre != "app.js":
                self.assertNotIn("getCurrentPosition", fuente, f"R4: {nombre} pide la ubicación")
        self.assertEqual(app.count("getCurrentPosition("), 1, "R4: la ubicación no se pide en un único sitio")
        self.assertIn("getCurrentPosition(", cuerpo_de_funcion(app, "locateMe") or "",
                      "R4: la ubicación se pide fuera de locateMe()")
        llamadas = re.findall(r"(?<!function )\blocateMe\(\)", app)
        self.assertEqual(len(llamadas), 1, "R4: locateMe() no se llama desde un único sitio")
        self.busca(
            app,
            r"getElementById\('locate-btn'\)\.addEventListener\('click',\s*\(\)\s*=>\s*locateMe\(\)\)",
            "R4: locateMe() no se llama solo desde el clic del botón",
        )

    def test_r5_el_punto_no_intercepta_toques_y_sobrevive_al_estilo(self):
        css = texto("css/styles.css")
        mapa = texto("js/map.js")
        regla = regla_css(css, ".me-dot")
        self.assertIsNotNone(regla, "R5: falta la regla .me-dot")
        self.assertIn("pointer-events: none", regla, "R5: el punto intercepta los toques")
        self.assertNotIn("white-space: nowrap", css)
        self.no_busca(mapa, r"addLayer\(\{\s*id:\s*'me", "R5: el punto es una capa y se pierde al cambiar de estilo")

    def test_r6_un_solo_punto_que_se_mueve(self):
        mapa = texto("js/map.js")
        self.assertEqual(mapa.count("new maplibregl.Marker"), 1, "R6: no hay un único sitio que crea el punto")
        cuerpo = cuerpo_de_funcion(mapa, "showMyLocation") or ""
        self.busca(cuerpo, r"\w+\s*\?\?=\s*new maplibregl\.Marker",
                         "R6: el punto se crea en cada pulsación en vez de reutilizarse")


if __name__ == "__main__":
    unittest.main()
