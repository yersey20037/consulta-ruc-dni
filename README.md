# Consulta RUC / DNI — Perú

API HTTP para consultar RUC y DNI en Perú. Responde en **microsegundos**
desde una copia local del Padrón Reducido de SUNAT, sin salir a internet.

- **Sin dependencias.** Solo Node.js 22+ (usa `node:sqlite`, integrado).
- **Sin captcha, sin token, sin scraping.** El Padrón Reducido es un
  archivo público que SUNAT publica a diario.
- **Sin límites de consulta.** Es tu base local: consulta lo que quieras.
- **Se actualiza sola.** Descarga y recarga el padrón cada madrugada.

```bash
curl http://localhost:8080/ruc/20131312955
```

```json
{
  "success": true,
  "ruc": "20131312955",
  "nombre_o_razon_social": "SUPERINTENDENCIA NACIONAL DE ADUANAS Y DE ADMINISTRACION TRIBUTARIA",
  "estado_del_contribuyente": "ACTIVO",
  "condicion_de_domicilio": "HABIDO",
  "ubigeo": "150101",
  "distrito": "LIMA",
  "provincia": "LIMA",
  "departamento": "LIMA",
  "direccion": "AV. GARCILASO DE LA VEGA NRO. 1472 - LIMA LIMA LIMA"
}
```

---

## Por qué existe

Las librerías que consultan el portal de SUNAT (`e-consultaruc.sunat.gob.pe`)
dejaron de funcionar: el portal está detrás de un WAF que rechaza las
peticiones automatizadas. Los servicios de terceros funcionan, pero cobran
por consulta o limitan el uso gratuito.

El **Padrón Reducido** es la alternativa oficial y abierta: un ZIP de ~390 MB
con todos los contribuyentes inscritos, que SUNAT actualiza a diario. Este
proyecto lo descarga, lo carga en SQLite y lo expone como API.

La contrapartida es que los datos son de la última descarga, no del momento
exacto de la consulta. Para facturación y validación de clientes suele ser
más que suficiente.

---

## Requisitos

| | |
|---|---|
| Node.js | **22 o superior** (por `node:sqlite`) |
| Disco | ~3 GB (390 MB del ZIP + 2,4 GB de la base) |
| RAM | Poca: SQLite lee por páginas, no carga todo en memoria |

---

## Instalación

```bash
git clone https://github.com/yersey20037/consulta-ruc-dni.git
cd consulta-ruc-dni
cp .env.ejemplo .env
npm test
npm run actualizar-padron
npm start
```

> Para instalar en un servidor de produccion (PM2 como servicio, firewall,
> arranque automatico), ver **[INSTALAR.md](INSTALAR.md)**.

`npm run actualizar-padron` descarga el ZIP y arma la base. **Tarda unos
10-12 minutos** la primera vez, casi todo en la carga a SQLite.

Si ya tienes el ZIP descargado:

```bash
node actualizar-padron.js padron_reducido_ruc.zip
```

Comprueba que responde:

```bash
curl http://localhost:8080/ping
```

---

## Endpoints

| Ruta | Qué hace |
|---|---|
| `GET /ruc/{ruc}` | Consulta un RUC (11 dígitos) |
| `GET /dni/{dni}` | Consulta un DNI (8 dígitos) |
| `GET /ping` | Estado del servicio, del padrón y de la actualización |
| `GET /actualizar` | Lanza la actualización ahora (responde `202`) |
| `GET /recargar` | Reabre la base tras una actualización manual |
| `GET /read.php?ruc=` | Formato compatible con clientes antiguos (ver abajo) |

### Respuesta de RUC

22 campos, siempre en el mismo orden:

```json
{
  "success": true,
  "ruc": "20512963545",
  "nombre_o_razon_social": "ZONA INFORMATICA DIGITAL S.R.L.",
  "estado_del_contribuyente": "BAJA DE OFICIO",
  "condicion_de_domicilio": "HABIDO",
  "ubigeo": "150130",
  "tipo_de_via": "AV.",
  "nombre_de_via": "SAN LUIS",
  "codigo_de_zona": "-",
  "tipo_de_zona": "-",
  "numero": "2076",
  "interior": "-",
  "lote": "-",
  "dpto": "403",
  "manzana": "-",
  "kilometro": "-",
  "distrito": "SAN BORJA",
  "provincia": "LIMA",
  "departamento": "LIMA",
  "direccion_simple": "AV. SAN LUIS NRO. 2076 DPTO. 403",
  "direccion": "AV. SAN LUIS NRO. 2076 DPTO. 403 - LIMA LIMA SAN BORJA",
  "actualizado_en": "2026-08-25 16:11:53"
}
```

La dirección viene desglosada campo por campo (`tipo_de_via`, `numero`,
`manzana`, …) y también armada en `direccion`, para que cada quien use la
forma que necesite. Los campos sin dato traen `-`.

### Respuesta de DNI

```json
{ "success": true, "dni": "43574471", "nombre": "PEREZ GARCIA JUAN CARLOS" }
```

El nombre viene en el orden **apellidos primero**, tal como lo publica SUNAT.

### Formato compatible

Para no tener que modificar clientes que ya consumían una API PHP del estilo
`read.php?ruc=...`, el servicio expone esa misma ruta con el formato que
esos clientes esperan:

```bash
curl "http://localhost:8080/read.php?ruc=20512963545"
```

```json
{
  "data": {
    "tipoPersona": "JURIDICA",
    "numeroDocumento": "20512963545",
    "nombre": "ZONA INFORMATICA DIGITAL S.R.L.",
    "estado": "BAJA DE OFICIO",
    "condicionDomicilio": "HABIDO",
    "tipoVia": "AV.",
    "nombreVia": "SAN LUIS",
    "numero": "2076",
    "codigoZona": "",
    "tipoZona": "",
    "ubigeo": "150130"
  }
}
```

Diferencias con el formato propio: los datos van anidados bajo `data`, los
nombres son camelCase, y cuando no hay resultado devuelve el texto literal
`false` en vez de un JSON de error.

`tipoPersona` no viene en el padrón: se deduce del RUC (los que empiezan en
`10`, `15` o `17` son personas naturales; el resto, jurídicas).

Acepta `?ruc=` o `?dni=`, con o sin la extensión `.php`. Ambos formatos
funcionan a la vez contra la misma base.

### Códigos HTTP

| Código | Significado |
|---|---|
| `200` | Encontrado |
| `400` | Documento con largo inválido, o ruta desconocida |
| `401` | Token inválido (solo si configuraste `API_TOKEN`) |
| `404` | El documento no existe en el padrón |
| `409` | Ya hay una actualización en curso (solo en `/actualizar`) |
| `502` | Error leyendo la base |
| `503` | El padrón no está cargado |

Los errores siempre traen `success: false` y un `message` legible.

Cada respuesta incluye la cabecera `X-Tiempo-Ms` con lo que tardó.

---

## Cómo funciona la consulta de DNI

El padrón no es un registro de personas: es un registro de contribuyentes.
Pero los RUC que empiezan en `10` son personas naturales y **llevan el DNI
embebido en los dígitos 3 al 10**:

```
RUC 10452159428  ->  DNI 45215942
```

El servicio indexa esa columna derivada, así que la consulta por DNI es tan
rápida como la de RUC.

> **Limitación:** solo encuentra personas que tengan RUC. Un DNI sin RUC no
> está en el padrón y devuelve `404`. Si necesitas cobertura total de DNI,
> hace falta acceso a RENIEC (por convenio o mediante un proveedor
> autorizado).

---

## Rendimiento

Medido sobre **18,3 millones de filas**, en un solo hilo:

| Consulta | Promedio | p95 | p99 |
|---|---|---|---|
| RUC (clave primaria) | 0,078 ms | 0,102 ms | 0,134 ms |
| DNI (índice) | 0,073 ms | 0,107 ms | 0,137 ms |
| No encontrado | 0,046 ms | 0,061 ms | 0,089 ms |

**~29.000 consultas por segundo.** No hay periodo de calentamiento: la
primera consulta tras abrir la base ya responde en 0,13 ms.

El tamaño del padrón casi no afecta: SQLite llega a cualquier fila en unos
pocos saltos del índice B-tree.

---

## Actualización automática

El servicio actualiza el padrón **todos los días a las 3:00 AM**, sin cron
ni tareas externas:

```
Actualizacion automatica: todos los dias a las 03:00 (la proxima en 11h 42m)
```

Se configura con `HORA_ACTUALIZACION` en el `.env`. Déjala vacía para
desactivarla.

### Cómo no corta el servicio

La carga tarda ~11 minutos y usa SQLite síncrono, así que bloquearía el
proceso. Por eso se lanza como **proceso hijo aparte**. Mientras trabaja:

- el servicio sigue respondiendo con la base vigente, en 2-3 ms;
- los datos nuevos entran en `padron.db.nuevo`;
- al terminar, el servidor cierra su base, hace el `rename` atómico y la
  reabre.

Ese último paso lo hace el servidor y no el hijo por una razón concreta: en
Windows no se puede renombrar un archivo que otro proceso mantiene abierto.
El intercambio reintenta unos segundos por si hay una consulta en vuelo, y
si algo falla deshace el paso para no dejar al servicio sin base.

Si la descarga o la carga fallan, **la base anterior queda intacta** y se
reintenta al día siguiente. Dos actualizaciones nunca se solapan.

El temporizador no es un `setTimeout` de 24 horas: revisa el reloj cada
minuto, así que si la máquina se suspende y despierta pasada la hora, la
actualización se recupera ese mismo día en vez de perderse.

### A mano

```bash
curl http://localhost:8080/actualizar   # la lanza ahora, responde 202
curl http://localhost:8080/ping         # "corriendo": true mientras dura
```

---

## Configuración

Todo vive en el archivo `.env`:

```ini
PORT=8080
HORA_ACTUALIZACION=03:00
API_TOKEN=
SOLO_ASCII=0
```

| Variable | Por defecto | Para qué |
|---|---|---|
| `PORT` | `8080` | Puerto de escucha |
| `HORA_ACTUALIZACION` | `03:00` | Actualización diaria; vacío la desactiva |
| `API_TOKEN` | vacío | Vacío = sin autenticación |
| `SOLO_ASCII` | `0` | `1` quita tildes y la Ñ de la salida |
| `PADRON_DIR` | `./datos` | Dónde vive `padron.db` |
| `PADRON_URL` | ZIP de SUNAT | Por si cambia la ruta de origen |

Node 22 lee el `.env` de forma nativa: no hace falta `dotenv`.

Las variables del entorno **tienen prioridad** sobre el `.env`, para poder
forzar un valor sin editar el archivo.

### Autenticación

Si defines `API_TOKEN`, el servicio lo exige en cada consulta. Acepta tres
formas:

```bash
curl -H "Authorization: Bearer mi-token" http://localhost:8080/ruc/20131312955
curl -H "X-API-Token: mi-token"          http://localhost:8080/ruc/20131312955
curl "http://localhost:8080/ruc/20131312955?token=mi-token"
```

Con `API_TOKEN` vacío no se pide nada, que es lo cómodo en una red interna.

---

## Despliegue

### Con PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 logs consulta-ruc-dni
```

En Linux, `pm2 startup` deja el servicio arrancando con el sistema.

En **Windows**, `pm2 startup` no funciona y `pm2-windows-startup` usa la
carpeta de Inicio, que exige que alguien inicie sesión. Para un servicio
real que arranque sin login, usa
[pm2-installer](https://github.com/jessety/pm2-installer):

```cmd
git clone https://github.com/jessety/pm2-installer.git
cd pm2-installer
npm run configure
npm run configure-policy
npm run setup
```

Y luego `pm2 start ecosystem.config.js && pm2 save`.

### Firewall

Para acceder desde otras máquinas hay que abrir el puerto.

Windows (como Administrador):

```cmd
netsh advfirewall firewall add rule name="Consulta RUC 8080" dir=in action=allow protocol=TCP localport=8080
```

Linux:

```bash
sudo ufw allow 8080/tcp
```

---

## Saneado de caracteres

Todo el texto pasa por `sanear()` antes de salir, porque el padrón trae
comillas tipográficas, guiones largos y `&` que rompen a muchos
consumidores (XML, SQL, sistemas legados en Windows-1252):

| Entra | Sale |
|---|---|
| `TIENDAS & MAS S.A.C.` | `TIENDAS Y MAS S.A.C.` |
| `COMERCIAL "EL SOL" E.I.R.L.` | `COMERCIAL EL SOL E.I.R.L.` |
| `SERVICIOS 1ª CLASE <TEST>` | `SERVICIOS 1A CLASE TEST` |
| `AGRO INDUSTRIAL – NORTE` | `AGRO INDUSTRIAL - NORTE` |
| tabs y saltos de línea | espacio simple |

Se conservan letras con tildes y Ñ, dígitos y `. , - / # ( ) °`. Con
`SOLO_ASCII=1` también se quitan las tildes y la Ñ.

---

## Detalles del padrón

Cosas que este proyecto ya resuelve y conviene conocer si tocas el código:

**El archivo viene en Latin-1.** Si se lee como UTF-8, la Ñ y las tildes
entran corruptas a la base y ya no hay forma de arreglarlas.

**La columna `DEPARTAMENTO` no es la región.** Es el departamento de la
vivienda (`DPTO. 403`). La ubicación geográfica solo viene como ubigeo.

**El ubigeo se traduce con el catálogo del INEI.** `src/ubigeo.js` lleva
1.892 distritos embebidos y resuelve distrito, provincia y departamento.
Cubre el 99,96% de los RUC; los ubigeos sin entrada (distritos creados
después) resuelven al menos el departamento por los 2 primeros dígitos.

**Algunas razones sociales llevan `|` dentro**, el mismo carácter que separa
las columnas. Eso corre todos los campos una posición y corrompe la fila.
Son poquísimas (3 de 18 millones), pero son empresas reales: el parser usa
el ubigeo como ancla para detectar el desplazamiento y reconstruir el
nombre completo.

---

## Estructura

```
server.js               servidor HTTP, rutas, token
actualizar-padron.js    descarga el ZIP y arma la base
src/config.js           lee el .env
src/padron.js           descarga, carga a SQLite y consulta
src/ubigeo.js           catalogo INEI: ubigeo -> distrito/provincia/depto
src/programador.js      actualizacion diaria automatica
src/formato.js          saneado, parser de direccion, formato de salida
src/compat.js           formato compatible para clientes antiguos
test/test.js            pruebas (no tocan la red ni la base)
datos/padron.db         base SQLite (generada)
```

`npm test` corre sin red y sin base cargada: valida el saneado, el parser de
direcciones, el catálogo de ubigeos, el parser de líneas del padrón y el
programador.

---

## Fuentes

- [Padrón Reducido de SUNAT](http://www2.sunat.gob.pe/padron_reducido_ruc.zip)
- [Catálogo de ubigeos del INEI](https://github.com/RitchieRD/ubigeos-peru-data)

## Licencia

MIT
