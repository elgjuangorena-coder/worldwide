"""Comandos de comprobación de la página (unidad 001, criterios R1-R4).

Los casos que tienen que fallar trabajan sobre una copia temporal del repo: la página real
no se toca nunca.
"""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
LINT = "scripts/ci/lint"
SECURITY = "scripts/ci/security"


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


if __name__ == "__main__":
    unittest.main()
