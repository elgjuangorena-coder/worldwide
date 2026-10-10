"""Comandos de comprobación de la página (unidad 001, criterios R1-R4).

Los casos que tienen que fallar trabajan sobre una copia temporal del repo: la página real
no se toca nunca.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
LINT = "scripts/ci/lint"
SECURITY = "scripts/ci/security"
HOSTS_POLITICA = frozenset({
    "unpkg.com",
    "tiles.openfreemap.org",
    "www.geoboundaries.org",
    "media.githubusercontent.com",
    "raw.githubusercontent.com",
})
LUGARES_DE_PRUEBA = (
    "Akihabara",
    "Museo Ghibli",
    "Palacio Imperial",
    "Shinjuku Gyoen",
)
CATEGORIAS_LUGAR = frozenset({"Para ver", "Para comer"})
SCRIPT_FRONTERAS = r"""
import vm from 'node:vm';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const raiz = process.argv[2];
if (!raiz) {
  console.error('R1: falta la ruta del repositorio');
  process.exit(1);
}

vm.runInThisContext('var window = globalThis;');
const modulo = pathToFileURL(path.join(raiz, 'js', 'boundaries.js')).href;
const ns = await import(modulo);

function fallo(mensaje) {
  console.error(`R1: ${mensaje}`);
  process.exit(1);
}

if (typeof ns.candidateUrls !== 'function') {
  fallo('candidateUrls no está exportada');
}

const vacias = [
  'https://evil.example/geo.json',
  'http://127.0.0.1/',
  'https://169.254.169.254/',
];
for (const url of vacias) {
  const lista = ns.candidateUrls(url);
  if (!Array.isArray(lista) || lista.length !== 0) {
    fallo(`${url} no devuelve lista vacía`);
  }
}

const mexico = 'https://github.com/wmgeolab/geoBoundaries/raw/90a1d52/releaseData/gbOpen/MEX/ADM1/geoBoundaries-MEX-ADM1_simplified.geojson';
const esperada = [
  'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/90a1d52/releaseData/gbOpen/MEX/ADM1/geoBoundaries-MEX-ADM1_simplified.geojson',
  'https://raw.githubusercontent.com/wmgeolab/geoBoundaries/90a1d52/releaseData/gbOpen/MEX/ADM1/geoBoundaries-MEX-ADM1_simplified.geojson',
];
const obtenida = ns.candidateUrls(mexico);
if (obtenida.length !== esperada.length || esperada.some((url, i) => obtenida[i] !== url)) {
  fallo('la URL real de México no se reescribe a media y luego a raw');
}

const llamadas = [];
globalThis.fetch = async (url) => {
  llamadas.push(String(url));
  return new Response(JSON.stringify({
    simplifiedGeometryGeoJSON: 'https://evil.example/geo.json',
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

try {
  await ns.loadBoundaries('ZZZ', 'ADM1');
} catch {
  // Sin lista no hay frontera que bajar.
}

const meta = 'https://www.geoboundaries.org/';
if (!llamadas.some((url) => url.startsWith(meta))) {
  fallo('la prueba no llegó a pedir el metadato');
}
const fuera = llamadas.filter((url) => !url.startsWith(meta));
if (fuera.length !== 0) {
  fallo(`fetchBoundaries llamó a fetch con la lista vacía: ${fuera.join(' ')}`);
}
"""


def junta(*trozos):
    # Los secretos de prueba se montan al ejecutar: escritos enteros (o como constantes que
    # Python pliega al compilar) harían saltar a security sobre el propio repo.
    return "".join(trozos)


def correr(raiz, script):
    return subprocess.run(
        [str(raiz / script)], cwd=raiz, capture_output=True, text=True, timeout=120
    )


class ComprobacionTest(unittest.TestCase):
    def assertEjecutable(self, raiz, script, criterio):
        ruta = raiz / script
        self.assertTrue(
            ruta.is_file() and os.access(ruta, os.X_OK),
            f"{criterio}: {script} no existe o no es ejecutable",
        )

    def copia(self):
        destino = Path(tempfile.mkdtemp(prefix="worldwide-comprobacion-")) / "repo"
        self.addCleanup(shutil.rmtree, destino.parent)
        shutil.copytree(RAIZ, destino, ignore=shutil.ignore_patterns(".git", "__pycache__"))
        return destino

    def test_r1_pagina_actual_en_verde(self):
        for script in (LINT, SECURITY):
            with self.subTest(script=script):
                self.assertEjecutable(RAIZ, script, "R1")
                resultado = correr(RAIZ, script)
                self.assertEqual(
                    resultado.returncode, 0,
                    f"R1: {script} da rojo sobre la página actual:\n"
                    f"{resultado.stdout}{resultado.stderr}",
                )

    def test_r2_sin_hoja_de_estilo_lint_en_rojo(self):
        self.assertEjecutable(RAIZ, LINT, "R2")
        repo = self.copia()
        (repo / "css" / "styles.css").unlink()
        resultado = correr(repo, LINT)
        self.assertNotEqual(resultado.returncode, 0, "R2: lint da verde sin css/styles.css")
        self.assertIn("css/styles.css", resultado.stdout + resultado.stderr,
                      "R2: el rojo de lint no nombra css/styles.css")

    def test_r3_js_ilegible_lint_en_rojo(self):
        self.assertEjecutable(RAIZ, LINT, "R3")
        repo = self.copia()
        with open(repo / "js" / "ui.js", "a", encoding="utf-8") as fichero:
            fichero.write("\nexport const = ;\n")
        resultado = correr(repo, LINT)
        self.assertNotEqual(resultado.returncode, 0, "R3: lint da verde con js/ui.js roto")
        self.assertIn("js/ui.js", resultado.stdout + resultado.stderr,
                      "R3: el rojo de lint no nombra js/ui.js")

    def test_r4_secreto_colado_security_en_rojo(self):
        self.assertEjecutable(RAIZ, SECURITY, "R4")
        clave = junta("-----BEGIN ", "RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n",
                      "-----END ", "RSA PRIVATE KEY-----\n")
        token = junta("gh", "p_", "a1B2c3D4e5" * 3, "f6G7h8")
        casos = (
            ("clave privada", Path("data") / "clave.pem", clave),
            ("token de GitHub", Path("js") / "config.js", f"export const TOKEN = '{token}';\n"),
        )
        for nombre, relativa, contenido in casos:
            with self.subTest(caso=nombre):
                repo = self.copia()
                (repo / relativa).write_text(contenido, encoding="utf-8")
                resultado = correr(repo, SECURITY)
                salida = resultado.stdout + resultado.stderr
                self.assertNotEqual(resultado.returncode, 0,
                                    f"R4: security da verde con un {nombre} en {relativa}")
                self.assertIn(relativa.as_posix(), salida,
                              f"R4: el rojo de security no nombra {relativa}")
                self.assertNotIn(token, salida, "R4: security imprime el secreto que encontró")

    def test_fronteras_r1_solo_raw_de_github(self):
        fd, ruta = tempfile.mkstemp(prefix="fronteras-r1-", suffix=".mjs")
        os.close(fd)
        self.addCleanup(os.unlink, ruta)
        Path(ruta).write_text(SCRIPT_FRONTERAS, encoding="utf-8")
        resultado = subprocess.run(
            ["node", ruta, str(RAIZ)],
            cwd=RAIZ,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(
            resultado.returncode, 0,
            "R1: las fronteras se piden fuera de un raw de github.com:\n"
            f"{resultado.stdout}{resultado.stderr}",
        )

    def test_estilos_r2_guardados_en_el_repositorio(self):
        mapa = (RAIZ / "js" / "map.js").read_text(encoding="utf-8")
        self.assertNotIn(
            "tiles.openfreemap.org/styles", mapa,
            "R2: el estilo sigue saliendo de tiles.openfreemap.org/styles",
        )
        self.assertIn("data/styles/liberty.json", mapa, "R2: falta el estilo claro")
        self.assertIn("data/styles/dark.json", mapa, "R2: falta el estilo oscuro")
        for nombre in ("liberty.json", "dark.json"):
            ruta = RAIZ / "data" / "styles" / nombre
            self.assertTrue(ruta.is_file(), f"R2: falta data/styles/{nombre}")
            estilo = json.loads(ruta.read_text(encoding="utf-8"))
            self.assertIsInstance(estilo, dict, f"R2: data/styles/{nombre} no es el estilo guardado")

    def test_politica_r3_solo_los_hosts_del_mapa(self):
        html = (RAIZ / "index.html").read_text(encoding="utf-8")
        self.assertIn(
            '<meta http-equiv="Content-Security-Policy"', html,
            "R3: index.html no declara la política de contenidos",
        )
        encontrada = re.search(
            r'<meta http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"',
            html,
        )
        self.assertIsNotNone(encontrada, "R3: la política no trae content")
        hosts = set(re.findall(r"[a-z][a-z0-9+.-]*://([A-Za-z0-9.-]+)", encontrada.group(1), re.I))
        self.assertEqual(hosts, HOSTS_POLITICA, f"R3: la política nombra otros hosts: {hosts}")

    def test_secreto_r4_github_pat_en_fichero(self):
        self.assertEjecutable(RAIZ, SECURITY, "R4")
        token = junta("github", "_pat_", "a1B2c3", "D4e5F6", "g7H8i9", "J0kLmN")
        repo = self.copia()
        relativa = Path("js") / "pat.js"
        (repo / relativa).write_text(f"export const PAT = '{token}';\n", encoding="utf-8")
        resultado = correr(repo, SECURITY)
        salida = resultado.stdout + resultado.stderr
        self.assertNotEqual(
            resultado.returncode, 0,
            "R4: security da verde con un token github_pat_ en un fichero",
        )
        self.assertIn(relativa.as_posix(), salida, "R4: el rojo de security no nombra js/pat.js")
        self.assertNotIn(token, salida, "R4: security imprime el secreto que encontró")

    def git(self, repo, *args):
        hooks = repo / ".vacio-hooks"
        hooks.mkdir(exist_ok=True)
        resultado = subprocess.run(
            [
                "git",
                "-c", "user.email=prueba@example.com",
                "-c", "user.name=Prueba",
                "-c", "commit.gpgsign=false",
                "-c", f"core.hooksPath={hooks}",
                *args,
            ],
            cwd=repo,
            capture_output=True,
            text=True,
            timeout=60,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        )
        aviso = ""
        if resultado.stderr.strip():
            aviso = resultado.stderr.strip().splitlines()[-1]
        self.assertEqual(
            resultado.returncode, 0,
            f"R4: git {' '.join(args)} terminó en {resultado.returncode}: {aviso}",
        )
        return resultado

    def test_secreto_r4_token_borrado_sigue_en_historial(self):
        self.assertEjecutable(RAIZ, SECURITY, "R4")
        token = junta("gh", "p_", "a1B2c3D4e5" * 3, "f6G7h8")
        repo = self.copia()
        self.git(repo, "init", "-b", "main")
        self.git(repo, "add", "--", ".")
        self.git(repo, "commit", "-m", "base")
        notas = repo / "notas.txt"
        notas.write_text(token + "\n", encoding="utf-8")
        self.git(repo, "add", "--", "notas.txt")
        self.git(repo, "commit", "-m", "colado")
        self.git(repo, "rm", "--", "notas.txt")
        self.git(repo, "commit", "-m", "borrado")
        self.assertFalse(notas.exists(), "R4: el token sigue en el árbol")
        resultado = correr(repo, SECURITY)
        salida = resultado.stdout + resultado.stderr
        self.assertNotEqual(
            resultado.returncode, 0,
            "R4: security da verde con un token que solo vive en el historial",
        )
        self.assertNotIn(token, salida, "R4: security imprime el secreto que encontró")
        self.assertRegex(salida, r"[0-9a-f]{7,40}", "R4: el rojo no nombra el commit")

    def test_lugares_del_cuaderno(self):
        lugares = json.loads((RAIZ / "data" / "landmarks.json").read_text(encoding="utf-8"))
        self.assertEqual(len(lugares), 46, "R1: no están los 46 lugares del cuaderno")
        nombres = [lugar.get("name") for lugar in lugares]
        for nombre in LUGARES_DE_PRUEBA:
            self.assertNotIn(nombre, nombres, f"R1: sigue el lugar de prueba {nombre}")
        senso = [
            lugar for lugar in lugares
            if lugar.get("name") == "Senso-ji y la calle Nakamise"
        ]
        self.assertEqual(len(senso), 1, "R1: falta Senso-ji y la calle Nakamise")
        self.assertEqual(
            senso[0].get("category"), "Para ver",
            "R1: Senso-ji y la calle Nakamise no está como Para ver",
        )
        ids = []
        for lugar in lugares:
            nombre = lugar.get("name")
            self.assertTrue(isinstance(nombre, str) and nombre.strip(), "R2: un lugar no tiene name")
            barrio = lugar.get("neighborhood")
            self.assertTrue(
                isinstance(barrio, str) and barrio.strip(),
                f"R2: {nombre} no tiene neighborhood",
            )
            self.assertIn(
                lugar.get("category"), CATEGORIAS_LUGAR,
                f"R2: {nombre} no es Para ver ni Para comer",
            )
            descripcion = lugar.get("description")
            self.assertTrue(
                isinstance(descripcion, str) and descripcion.strip(),
                f"R2: {nombre} no tiene description",
            )
            lat = lugar.get("lat")
            lng = lugar.get("lng")
            self.assertTrue(
                isinstance(lat, (int, float)) and not isinstance(lat, bool),
                f"R2: {nombre} no tiene lat numérica",
            )
            self.assertTrue(
                isinstance(lng, (int, float)) and not isinstance(lng, bool),
                f"R2: {nombre} no tiene lng numérica",
            )
            self.assertGreaterEqual(lat, 24, f"R2: {nombre} tiene lat fuera de Japón")
            self.assertLessEqual(lat, 46, f"R2: {nombre} tiene lat fuera de Japón")
            self.assertGreaterEqual(lng, 122, f"R2: {nombre} tiene lng fuera de Japón")
            self.assertLessEqual(lng, 154, f"R2: {nombre} tiene lng fuera de Japón")
            enlace = lugar.get("googleMapsUrl")
            self.assertTrue(
                isinstance(enlace, str) and enlace.startswith("http"),
                f"R2: {nombre} no tiene googleMapsUrl",
            )
            ident = lugar.get("id")
            self.assertTrue(isinstance(ident, str) and ident.strip(), f"R3: {nombre} no tiene id")
            ids.append(ident)
        self.assertEqual(len(set(ids)), len(ids), "R3: hay id repetidos")
        self.assertEqual(len(set(nombres)), len(nombres), "R3: hay name repetidos")


if __name__ == "__main__":
    unittest.main()
