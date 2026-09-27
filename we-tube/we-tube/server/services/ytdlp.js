// services/ytdlp.js
// Envoltorio sobre el binario yt-dlp (debe estar instalado en el servidor,
// ver https://github.com/yt-dlp/yt-dlp). Construye los argumentos de forma
// segura (spawn con array de args, NUNCA con shell string, para evitar
// inyeccion de comandos) y expone:
//   - buildArgs(): traduce las opciones "amigables" del formulario web a
//     flags reales de yt-dlp, y permite ademas "extraArgs" en crudo para
//     que un usuario avanzado use CUALQUIER flag soportado por yt-dlp.
//   - runDownload(): ejecuta el proceso y reporta progreso via callback.
//   - getVersion(): valida que el binario este disponible.
//   - readInfoJson(): lee el sidecar .info.json que yt-dlp escribe con toda
//     la metadata (canal, vistas, likes, fecha de publicacion, etc.)
'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const cfg = require('../config');

const BIN = cfg.ytdlpPath;

function getVersion() {
  return new Promise((resolve) => {
    const p = spawn(BIN, ['--version']);
    let out = '';
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('error', () => resolve(null));
    p.on('close', (code) => resolve(code === 0 ? out.trim() : null));
  });
}

function classifyVideoKind(video = {}) {
  if (!video || typeof video !== 'object') return 'normal';
  const shortPath = /\/shorts\//i.test(String(video.webpage_url || video.source_url || '')) || String(video.is_short || '').toLowerCase() === 'true';
  if (shortPath) return 'short';

  const liveStatus = String(video.live_status || video.liveStatus || video.status || '').trim().toLowerCase();
  const isLiveFlag = Boolean(video.is_live || video.live || video.isLive);
  const liveAlias = ['is_live', 'was_live', 'is_upcoming', 'was_upcoming', 'live', 'post_live', 'planned_live', 'premiere'];
  if (isLiveFlag || liveAlias.includes(liveStatus) || /live/i.test(String(video.webpage_url || ''))) {
    return 'live';
  }
  return 'normal';
}

/**
 * Traduce opciones amigables (desde el formulario web) a flags de yt-dlp.
 * options soporta:
 *  - url (string, requerido)
 *  - mode: 'video' | 'audio' (audio => --extract-audio)
 *  - quality: 'best' | '2160' | '1440' | '1080' | '720' | '480'
 *  - audioFormat: 'mp3' | 'm4a' | 'opus' (solo si mode=audio)
 *  - isPlaylist: bool (--yes-playlist / --no-playlist)
 *  - playlistItems: string opcional, ej "1-5,8"
 *  - subtitles: bool (--write-subs --write-auto-subs)
 *  - subLangs: string, ej "es,en"
 *  - embedThumbnail: bool
 *  - rateLimit: string ej "2M"
 *  - proxy: string
 *  - cookiesFile: string (ruta)
 *  - extraArgs: string con flags CLI adicionales separados por espacio,
 *    para dar acceso completo a cualquier opcion de yt-dlp no cubierta
 *    por el formulario simplificado.
 */
function buildArgs(options, outputDir) {
  const args = [];

  // Calidad / formato
  if (options.mode === 'audio') {
    args.push('-x', '--audio-format', options.audioFormat || 'mp3');
  } else {
    let fmt;
    if (!options.quality || options.quality === 'best') {
      fmt = cfg.properties.ytdlp.defaultFormat;
    } else {
      const h = options.quality;
      fmt = `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`;
    }
    args.push('-f', fmt, '--merge-output-format', 'mp4');
  }

  // Playlist
  if (options.isPlaylist) {
    args.push('--yes-playlist');
    if (options.playlistItems) args.push('--playlist-items', String(options.playlistItems));
  } else {
    args.push('--no-playlist');
  }

  // Subtitulos
  if (options.subtitles) {
    args.push('--write-subs', '--write-auto-subs', '--sub-langs', options.subLangs || 'es,en');
  }

  // Metadata y miniatura (requisito: preservar canal, vistas, likes, fecha, etc.)
  if (cfg.properties.ytdlp.writeInfoJson) args.push('--write-info-json');
  if (cfg.properties.ytdlp.writeThumbnail || options.embedThumbnail) args.push('--write-thumbnail');
  if (cfg.properties.ytdlp.embedMetadata) args.push('--embed-metadata');
  args.push('--parse-metadata', '%(uploader)s:%(meta_artist)s');

  // Rendimiento / red
  const rate = options.rateLimit || cfg.properties.ytdlp.rateLimit;
  if (rate) args.push('--limit-rate', rate);
  if (options.proxy) args.push('--proxy', options.proxy);
  const concurrency = cfg.properties.ytdlp.concurrentFragments;
  if (concurrency) args.push('--concurrent-fragments', String(concurrency));
  const cookies = options.cookiesFile || cfg.properties.ytdlp.cookiesFile;
  if (cookies) args.push('--cookies', cookies);
  if (cfg.ytdlpJsRuntime) args.push('--js-runtimes', cfg.ytdlpJsRuntime);

  // Progreso parseable en stdout (usado por runDownload para reportar %)
  args.push('--newline', '--progress-template', 'download:PROGRESS %(progress._percent_str)s');

  // Extra args crudos: acceso total a las opciones de yt-dlp para usuarios avanzados
  if (options.extraArgs && options.extraArgs.trim()) {
    args.push(...options.extraArgs.trim().split(/\s+/));
  }

  // Plantilla de salida: se guarda dentro del directorio del usuario
  args.push('-o', path.join(outputDir, '%(title).150B [%(id)s].%(ext)s'));

  args.push(options.url);
  return args;
}

/**
 * Ejecuta la descarga. onProgress(percent:number) se invoca conforme avanza.
 * Devuelve una promesa que resuelve con { code, stdout } o rechaza con Error.
 */
function runDownload(options, outputDir, onProgress, onLog) {
  return new Promise((resolve, reject) => {
    const args = buildArgs(options, outputDir);
    const proc = spawn(BIN, args, { cwd: outputDir });
    let stdoutBuf = '';
    let stderrBuf = '';

    proc.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdoutBuf += text;
      if (onLog) onLog(text);
      const match = text.match(/PROGRESS\s+([\d.]+)%/);
      if (match && onProgress) onProgress(parseFloat(match[1]));
    });

    proc.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
      if (onLog) onLog(chunk.toString());
    });

    proc.on('error', (err) => {
      reject(new Error(`No se pudo ejecutar yt-dlp (¿esta instalado y en PATH?): ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ code, stdout: stdoutBuf });
      } else {
        const details = stderrBuf.slice(-1200);
        if (/Join this channel|members-only content/i.test(details)) {
          reject(new Error(
            'Este video es exclusivo para miembros del canal. Usa un archivo de cookies de una cuenta que sea miembro y vuelve a intentarlo. '
              + details
          ));
        } else if (/No supported JavaScript runtime/i.test(details)) {
          reject(new Error(
            'yt-dlp necesita un runtime JavaScript para este video. Instala Deno o configura YTDLP_JS_RUNTIME en .env. '
              + details
          ));
        } else {
          reject(new Error(`yt-dlp finalizo con codigo ${code}. ${details}`));
        }
      }
    });
  });
}

/** Lista videos de un canal/playlist en modo "flat" (sin descargar), para deteccion de novedades */
function listChannelVideos(channelUrl, limit, start = 1) {
  return new Promise((resolve, reject) => {
    const args = ['--flat-playlist'];
    if (Number.isFinite(limit)) {
      args.push('--playlist-start', String(start), '--playlist-end', String(start + limit - 1));
    }
    args.push(
      '--print',
      '%(id)s|||%(title)s|||%(webpage_url)s|||%(thumbnail)s|||%(uploader)s|||%(availability)s|||%(is_short)s|||%(live_status)s|||%(is_live)s'
    );
    args.push(channelUrl);
    const proc = spawn(BIN, args);
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d.toString()));
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('error', (e) => reject(e));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.slice(-500)));
      const items = out
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [id, title, url, thumbnail, channelName, availability, isShort, liveStatus, isLive] = line.split('|||');
          const normalizedVideo = {
            id,
            title: title === 'NA' ? null : title,
            url,
            thumbnail: thumbnail === 'NA' ? null : thumbnail,
            channelName: channelName === 'NA' ? null : channelName,
            availability: availability === 'NA' ? null : availability,
            is_short: String(isShort || '').toLowerCase() === 'true',
            live_status: liveStatus === 'NA' ? null : liveStatus,
            is_live: String(isLive || '').toLowerCase() === 'true',
          };
          normalizedVideo.video_kind = classifyVideoKind(normalizedVideo);
          return normalizedVideo;
        });
      resolve(items);
    });
  });
}

/** Busca el archivo .info.json mas reciente en outputDir para extraer metadata completa */
function findLatestInfoJson(outputDir) {
  const files = fs
    .readdirSync(outputDir)
    .filter((f) => f.endsWith('.info.json'))
    .map((f) => ({ f, t: fs.statSync(path.join(outputDir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) return null;
  return JSON.parse(fs.readFileSync(path.join(outputDir, files[0].f), 'utf-8'));
}

module.exports = { getVersion, buildArgs, runDownload, listChannelVideos, findLatestInfoJson, classifyVideoKind, BIN };
