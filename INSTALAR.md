# Instalación en el servidor de producción

Guía completa desde cero. Los pasos 1 a 6 toman unos 20 minutos, casi todo
esperando la carga del padrón.

---

## 1. Verificar Node.js

**Obligatorio Node 22 o superior**: el servicio usa `node:sqlite`, que no
existe en versiones anteriores.

```cmd
node -v
```

Si sale `v22.x` o mayor, sigue al paso 2.

Si no está instalado o es menor, descarga la versión **LTS** de
https://nodejs.org e instálala (acepta las opciones por defecto). Después
**cierra y vuelve a abrir la terminal** para que tome el PATH.

Comprueba también Git:

```cmd
git --version
```

Si falta, instálalo de https://git-scm.com/download/win

---

## 2. Revisar el espacio en disco

Hacen falta **3 GB libres**: la base ocupa 2,4 GB y durante la actualización
diaria hay un momento con dos copias en disco.

---

## 3. Clonar el proyecto

```cmd
cd C:\
git clone https://github.com/yersey20037/consulta-ruc-dni.git
cd consulta-ruc-dni
```

Queda en `C:\consulta-ruc-dni`. Evita rutas con espacios o tildes.

---

## 4. Configurar

```cmd
copy .env.ejemplo .env
notepad .env
```

Lo que conviene revisar:

| Variable | Qué hace |
|---|---|
| `PORT=8080` | Puerto donde escucha. Cámbialo si el 8080 está ocupado. |
| `HORA_ACTUALIZACION=03:00` | A qué hora baja el padrón cada día. |
| `API_TOKEN=` | Déjalo vacío en red interna. |

Guarda y cierra.

---

## 5. Probar que el código está sano

```cmd
npm test
```

No toca la red ni la base. Debe terminar en `TODAS LAS PRUEBAS PASARON`.

---

## 6. Cargar el padrón (solo la primera vez)

```cmd
npm run actualizar-padron
```

Descarga ~390 MB de SUNAT y arma la base SQLite. **Tarda unos 12 minutos.**

No cierres la ventana hasta ver:

```
Listo: 18,352,428 filas
Base: 2402 MB | 18,352,428 filas
```

Si la descarga falla por la red, vuelve a lanzar el mismo comando.

---

## 7. Probar que funciona

```cmd
npm start
```

En **otra** ventana de terminal:

```cmd
curl http://localhost:8080/ping
curl http://localhost:8080/ruc/20131312955
```

El primero debe decir `"cargado": true` con el número de filas. El segundo
debe devolver los datos de SUNAT.

Corta el servidor con `Ctrl+C`: en el paso 8 queda como servicio permanente.

---

## 8. Dejarlo corriendo siempre

```cmd
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
```

Comprobar que está arriba:

```cmd
pm2 status
```

### Que arranque solo al prender el servidor

Esto es importante: sin este paso, el servicio no vuelve tras un reinicio.

En Windows `pm2 startup` **no funciona**, y `pm2-windows-startup` usa la
carpeta de Inicio, que exige que alguien inicie sesión. Para un servicio
real que arranque sin login, usa **pm2-installer**:

```cmd
cd C:\
git clone https://github.com/jessety/pm2-installer.git
cd pm2-installer
npm run configure
npm run configure-policy
npm run setup
```

Vuelve al proyecto y registra la app:

```cmd
cd C:\consulta-ruc-dni
pm2 start ecosystem.config.js
pm2 save
```

Verifica que quedó el servicio de Windows:

```cmd
sc query pm2.exe
```

**La prueba que importa:** reinicia el servidor, **no inicies sesión**, y
desde otra máquina abre `http://IP_DEL_SERVIDOR:8080/ping`. Si responde,
está bien instalado.

---

## 9. Abrir el puerto en el firewall

Sin esto el servicio solo responde en `localhost`, no desde otras máquinas.

Abre CMD **como Administrador** (clic derecho → Ejecutar como administrador):

```cmd
netsh advfirewall firewall add rule name="Consulta RUC 8080" dir=in action=allow protocol=TCP localport=8080
```

Averigua la IP del servidor:

```cmd
ipconfig
```

Busca la línea `Dirección IPv4` del adaptador que uses (Ethernet o Wi-Fi).

Prueba desde otra PC de la red:

```
http://IP_DEL_SERVIDOR:8080/ping
```

---

## Ya está

El servicio actualiza el padrón solo, todos los días a la hora configurada,
y recarga la base sin cortar las consultas.

### Comandos del día a día

```cmd
pm2 logs consulta-ruc-dni        :: ver qué está pasando
pm2 status                       :: ver si está arriba
pm2 restart consulta-ruc-dni     :: reiniciar (tras cambiar el .env)
pm2 stop consulta-ruc-dni        :: detener
curl http://localhost:8080/ping  :: estado y fecha del padrón
```

### Actualizar el código a una versión nueva

```cmd
cd C:\consulta-ruc-dni
git pull
npm test
pm2 restart consulta-ruc-dni
```

El `.env` y la base no se tocan: `git pull` solo trae el código.

---

## Si algo falla

**`503` o "el padron no esta cargado"**
Falta el paso 6. Ejecuta `npm run actualizar-padron`.

**Responde en `localhost` pero no por IP**
Falta el paso 9 (firewall).

**Error `node:sqlite` al arrancar**
La versión de Node es menor a 22. Ver paso 1.

**El puerto ya está en uso**
Otro programa ocupa el 8080. Cambia `PORT` en el `.env` y
`pm2 restart consulta-ruc-dni`. Para ver quién lo usa:
`netstat -ano | findstr :8080`

**La actualización automática falló**
Se ve en `pm2 logs`. La base anterior queda intacta y el servicio sigue
respondiendo con los datos del día previo; se reintenta al día siguiente.
Para forzarla ahora: `curl http://localhost:8080/actualizar`

**Comprobar qué tan viejos son los datos**

```cmd
curl http://localhost:8080/ping
```

El campo `actualizado_en` dice cuándo se cargó el padrón por última vez.

**El servicio no volvió tras reiniciar el servidor**
Falta registrar PM2 como servicio de Windows (paso 8, pm2-installer).
Comprueba con `sc query pm2.exe`.
