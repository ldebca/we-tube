# we-tube

Alternativa 100% local y autoalojada a YouTube. Muestra el contenido (video,
audio e imagenes) que tengas en un directorio de tu servidor, te permite
descargar videos con [yt-dlp](https://github.com/yt-dlp/yt-dlp), subir tus
propios archivos, y soporta múltiples usuarios con catálogos separados y un
modo incógnito que borra todo al cerrar sesión.

## Stack

- **Backend:** Node.js + Express
- **Base de datos:** PostgreSQL
- **Frontend:** HTML5 + Tailwind CSS (via CDN) + JavaScript vanilla
- **Descargas:** [yt-dlp](https://github.com/yt-dlp/yt-dlp) (binario externo)

## Requisitos previos

1. **Node.js 18+**
2. **PostgreSQL** accesible (por defecto se usa `172.18.0.2:5432`, configurable en `.env`)
3. **yt-dlp** instalado en el servidor. Puedes indicar su ruta completa en
  `.env` con `YTDLP_PATH` (esta variable tiene prioridad sobre
  `config/properties.json -> ytdlp.binaryPath`):
   ```bash
  YTDLP_PATH=/opt/yt-dlp/yt-dlp

   # Instalacion recomendada por el propio proyecto (siempre la ultima version):
   sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
   sudo chmod a+rx /usr/local/bin/yt-dlp
   ```
   `we-tube` valida al arrancar si `yt-dlp` esta disponible y lo muestra como
   advertencia en el panel de Descargas si no lo encuentra.

## Instalacion

```bash
git clone <este-repositorio> we-tube
cd we-tube
npm install
cp .env.example .env    # y edita host/usuario/password/db de PostgreSQL
npm run init-db         # crea las tablas (idempotente, se puede correr de nuevo)
npm start                # arranca en http://localhost:4000
```

En desarrollo puedes usar `npm run dev` (usa `node --watch`, recarga al guardar).

## Configuracion (`config/properties.json`)

Todo el comportamiento funcional se controla desde este archivo (tambien
editable por un usuario administrador desde **Configuracion** en la web):

| Seccion | Campo | Descripcion |
|---|---|---|
| `server` | `port` | Puerto HTTP (tambien puede fijarse con `PORT` en `.env`) |
| `media` | `rootDir` | Directorio local donde vive/se guarda todo el contenido. Puede ser absoluto o relativo al proyecto |
| `media` | `allowed*Ext` | Extensiones aceptadas por tipo |
| `media` | `maxUploadSizeMB` | Limite de subida manual |
| `cleanup` | `enabled`, `maxAgeDays`, `cronSchedule` | Borrado automatico de archivos viejos (los marcados como favoritos se conservan) |
| `ytdlp` | `binaryPath`, `defaultFormat`, `cookiesFile`, `rateLimit`, `concurrentFragments` | Parametros por defecto de las descargas; `YTDLP_PATH` en `.env` tiene prioridad para la ruta del binario |
| `channels` | `checkIntervalCron` | Frecuencia de revision de canales suscritos |
| `auth` | `jwtSecret`, `jwtExpiresIn`, `allowRegistration` | Autenticacion. **Cambia `jwtSecret` en produccion** (o usa `JWT_SECRET` en `.env`, tiene prioridad) |

Los secretos de infraestructura (credenciales de PostgreSQL, `JWT_SECRET`,
`PORT`) van en `.env`; el comportamiento de producto va en `properties.json`.

## Estructura del directorio de medios

Cada usuario tiene su propia subcarpeta dentro de `media/` (aislamiento de
contenido, requisito de "no mezclar" catalogos):

```
media/
  johndoe/            <- descargas y subidas del usuario "johndoe"
  janedoe/
  _incognito/
    <session-uuid>/   <- sesiones incognito, se borran al cerrar sesion
```

Puedes copiar archivos manualmente a la carpeta de un usuario; `we-tube` los
detecta y registra automaticamente en el catalogo la siguiente vez que ese
usuario abra la web (ver `server/services/mediaScanner.js`).

## Funcionalidades

- **Catalogo tipo YouTube** con miniaturas, busqueda y filtros por tipo (video/audio/imagen).
- **Reproduccion en streaming** con soporte de `HTTP Range requests` (seek fluido en videos grandes).
- **Descargas con yt-dlp**: formulario simple (URL, calidad, audio/video) + un
  panel de "opciones avanzadas" (subtitulos, proxy, límite de velocidad,
  cookies) + un campo de **argumentos crudos** para usar *cualquier* flag
  soportado por yt-dlp sin que la UI tenga que anticiparlos todos.
- **Metadata preservada**: al descargar, se usa `--write-info-json` y se
  extraen canal, vistas, likes y fecha de publicacion hacia la base de datos.
- **Listas de reproduccion** (`--yes-playlist`, selección de items) y
  **canales monitoreados** (revision periodica automatica de nuevos videos).
- **Subida de archivos** (drag & drop) de video/audio/imagen.
- **Eliminacion** de archivos desde la web (borra archivo + `.info.json` + registro en DB).
- **Trabajo en segundo plano**: las descargas/subidas usan una cola async; el
  progreso se consulta por polling (`GET /api/downloads/:id`) sin bloquear la
  navegacion.
- **Multiusuario** con registro/login (JWT en cookie httpOnly) y **modo
  incognito** (sesion sin cuenta; su contenido se borra al hacer logout).
- **Modo claro/oscuro** persistente (`localStorage`).
- **Limpieza automatica** programada (cron) por antiguedad configurable.

## Limitaciones y decisiones de diseño conocidas

- El formulario de descarga cubre las opciones de yt-dlp mas usadas; el campo
  "argumentos extra" da acceso al resto (yt-dlp tiene cientos de flags,
  replicar cada uno como control de UI no era práctico).
- La deteccion de "videos nuevos" en canales usa `--flat-playlist` sobre los
  ultimos elementos listados (yt-dlp no expone fecha exacta sin costo extra
  por video); es una heuristica razonable para uso domestico, no garantiza
  deteccion perfecta en canales con muchas subidas simultaneas.
- El aislamiento entre usuarios se hace a nivel de aplicacion (carpetas y
  filtros en cada consulta), no con permisos de sistema de archivos por SO.
  Es adecuado para uso domestico/LAN; no se recomienda exponer el servidor
  directamente a internet sin una capa adicional (reverse proxy + HTTPS).

## Tests

```bash
npm test
```

Se incluyen pruebas unitarias (Node.js `node:test`, sin dependencias externas
de testing) para la logica pura del backend: construccion de argumentos de
yt-dlp, clasificacion de archivos por tipo, resolucion de almacenamiento por
usuario (normal/incognito) y resolucion de tipos MIME. No requieren conexion
a PostgreSQL para ejecutarse.

## Arranque automatico con el sistema (systemd)

Se incluye `we-tube.service`. Para instalarlo:

```bash
sudo useradd -r -s /bin/false wetube          # usuario de servicio (opcional)
sudo mkdir -p /opt/we-tube
sudo cp -r . /opt/we-tube
sudo chown -R wetube:wetube /opt/we-tube
sudo cp /opt/we-tube/we-tube.service /etc/systemd/system/we-tube.service
sudo systemctl daemon-reload
sudo systemctl enable --now we-tube
sudo systemctl status we-tube
journalctl -u we-tube -f      # ver logs en vivo
```

## Monitoreo

El servidor registra en consola (y por tanto en `journalctl` bajo systemd):

- Cada peticion HTTP con metodo, ruta, status y duracion (`[http] ...`).
- Estado de la conexion a PostgreSQL y disponibilidad de `yt-dlp` al arrancar (`[startup] ...`).
- Resultado de cada job de descarga y de las tareas cron de limpieza/canales (`[jobs]`, `[cleanup]`, `[channels]`).
- Errores no controlados de rutas y del pool de PostgreSQL (`[error]`, `[db]`).

## Crear un usuario administrador

Por defecto todo usuario registrado es una cuenta normal. Para que alguien
pueda editar `properties.json` desde la pestaña **Configuracion**, marcalo
como administrador directamente en PostgreSQL despues de que se registre:

```sql
UPDATE users SET is_admin = TRUE WHERE username = 'tu_usuario';
```

Debera volver a iniciar sesion para que el cambio tome efecto (el permiso
viaja dentro del JWT de la sesion).

## Notas de seguridad para produccion

- Cambia `jwtSecret`/`JWT_SECRET` por un valor aleatorio largo.
- Sirve la app detras de HTTPS (reverse proxy como nginx/Caddy) y activa
  `secure: true` en las cookies (`server/routes/auth.js`).
- Restringe el acceso de red a PostgreSQL solo al servidor de la app.
- Considera desactivar `auth.allowRegistration` tras crear las cuentas de tu
  hogar, para que nadie mas pueda registrarse si el servidor queda expuesto
  accidentalmente.
