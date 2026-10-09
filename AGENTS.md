# AGENTS.md — worldwide

Repo de código de «Worldwide», la página con el mapa y los lugares del viaje. Se orquesta
desde su meta-repo (la carpeta padre; ver `repos.yaml` allí). Aquí solo vive el código de la
aplicación.

## Comandos (literales, probados; los usa el método en cada cierre)

Todos se ejecutan desde la raíz de este repo.

| Para… | Comando |
|---|---|
| Levantar el entorno desde cero | nada que instalar: basta con `python3 --version` y `node --version` (ver abajo) |
| Correr la suite completa | `scripts/ci/full-suite` |
| Correr los linters | `scripts/ci/lint` |
| Lanzar una instancia para que la use el usuario | `python3 -m http.server 8000` → abrir `http://localhost:8000/` |
| Comprobación de seguridad | `scripts/ci/security` |
| Parar / limpiar | `Ctrl+C` en la terminal del servidor; no deja nada que limpiar |

- `scripts/ci/lint`: `node --check` de cada `js/*.js` y que existan los ficheros locales que
  cita `index.html`.
- `scripts/ci/security`: recorre el árbol (sin `.git`) y da rojo si hay un bloque de clave
  privada o un token de GitHub. Nombra el fichero y la línea, nunca imprime el secreto.
- `scripts/ci/full-suite`: lint, security y `python3 -B -m unittest -v tests/test_comprobacion.py`;
  se corta en el primer rojo.

Ninguno usa la red. MapLibre y Turf se cargan desde unpkg solo en el navegador.

## Qué necesita esta máquina

- Python 3.13 (los scripts de `scripts/ci/` y el servidor local).
- Node 26 (solo para `node --check`; no hay `package.json` ni dependencias).

## Estructura

- `index.html` + `css/styles.css`: la página. `js/`: módulos ES (`app.js` arranca; mapa,
  fronteras, lugares, nombres y la ficha viven cada uno en su módulo).
- `data/`: `landmarks.json` (los lugares), fronteras y nombres.
- `scripts/ci/`: los tres comandos de comprobación. `tests/`: sus pruebas (unittest).

## Reglas de este repo

- Los secretos van en `.env` (fuera de git); esta página no necesita ninguno. No hay imagen
  de contenedor.
- No hay dependencias de producción ni de desarrollo que instalar.
- Los tests se escriben antes que el código y no se debilitan para que pase la suite.
- Los tres scripts de `scripts/ci/` usan solo Python y Node de la máquina y propagan
  cualquier rojo. Prohibido `|| true` o dar verde por no encontrar tests.
- La suite, el lint y la seguridad se ejecutan en local antes de fusionar. No hay CI remoto:
  el proyecto no lo pide (`ci_remoto` no está a `sí` en `01-constitucion/bias.md`).
