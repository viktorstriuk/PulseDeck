'use strict';
const I18n = require("./i18n");

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

function cleanText(value) {
  if (!value) return '';
  return String(value).replace(/\u0000/g, '').replace(/\s+/g, ' ').trim();
}

function syncSafe32(buf, off = 0) {
  return ((buf[off] & 0x7f) << 21) | ((buf[off + 1] & 0x7f) << 14) | ((buf[off + 2] & 0x7f) << 7) | (buf[off + 3] & 0x7f);
}

function decodeUtf16BE(buf) {
  const even = buf.length - (buf.length % 2);
  const swapped = Buffer.allocUnsafe(even);
  for (let i = 0; i < even; i += 2) {
    swapped[i] = buf[i + 1];
    swapped[i + 1] = buf[i];
  }
  return swapped.toString('utf16le');
}

// A surprising amount of older Russian MP3 software wrote Windows-1251 bytes
// into ID3 fields marked as ISO-8859-1. Decode that common real-world case
// without pulling a large encoding dependency into the local-first player.
const CP1251_HIGH = 'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏђ‘’“”•–—�™љ›њќћџ ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї°±Ііґµ¶·ё№є»јЅѕїАБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя';

function decodeCp1251(buf) {
  let out = '';
  for (const byte of buf) out += byte < 0x80 ? String.fromCharCode(byte) : CP1251_HIGH[byte - 0x80];
  return out;
}

function decodeLegacyBytes(data) {
  if (!data?.length) return '';
  const utf8 = data.toString('utf8');
  // If the byte sequence is valid UTF-8 and actually contains non-ASCII text,
  // trust it. Some taggers incorrectly mark UTF-8 strings as Latin-1.
  if (!utf8.includes('�') && Buffer.from(utf8, 'utf8').equals(data) && /[^\x00-\x7f]/.test(utf8)) return utf8;

  const latin = data.toString('latin1');
  const cp = decodeCp1251(data);
  const cyr = (cp.match(/[А-Яа-яЁё]/g) || []).length;
  const letters = (cp.match(/[A-Za-zА-Яа-яЁё]/g) || []).length;
  // Require a meaningful Cyrillic run so names such as “Beyoncé” remain Latin-1.
  if (cyr >= 2 && cyr / Math.max(1, letters) >= 0.32) return cp;
  return latin;
}

function decodeTextPayload(buf) {
  if (!buf || !buf.length) return '';
  const enc = buf[0];
  const data = buf.subarray(1);
  if (enc === 0) return cleanText(decodeLegacyBytes(data));
  if (enc === 3) return cleanText(data.toString('utf8'));
  if (enc === 2) return cleanText(decodeUtf16BE(data));
  if (enc === 1) {
    if (data.length >= 2 && data[0] === 0xfe && data[1] === 0xff) return cleanText(decodeUtf16BE(data.subarray(2)));
    if (data.length >= 2 && data[0] === 0xff && data[1] === 0xfe) return cleanText(data.subarray(2).toString('utf16le'));
    return cleanText(data.toString('utf16le'));
  }
  return cleanText(data.toString('utf8'));
}

function decodeLyricText(encoding, data) {
  let value='';
  if(encoding===1){if(data[0]===0xff&&data[1]===0xfe)value=data.subarray(2).toString('utf16le');else if(data[0]===0xfe&&data[1]===0xff)value=decodeUtf16BE(data.subarray(2));else value=data.toString('utf16le');}
  else if(encoding===2)value=decodeUtf16BE(data);
  else value=encoding===0?decodeLegacyBytes(data):data.toString('utf8');
  return value.replace(/\u0000/g,'').replace(/\r\n?/g,'\n').trim().slice(0,2*1024*1024);
}
function parseUslt(frame){
  if(frame.length<5)return '';
  const encoding=frame[0],start=findTerminator(frame,4,encoding)+(encoding===1||encoding===2?2:1);
  return decodeLyricText(encoding,frame.subarray(start));
}
function findTerminator(buf, start, encoding) {
  if (encoding === 1 || encoding === 2) {
    for (let i = start; i + 1 < buf.length; i += 2) {
      if (buf[i] === 0 && buf[i + 1] === 0) return i;
    }
    return buf.length;
  }
  const idx = buf.indexOf(0, start);
  return idx === -1 ? buf.length : idx;
}

function parseApic(frame) {
  if (!frame || frame.length < 8) return null;
  const encoding = frame[0];
  let pos = 1;
  const mimeEnd = frame.indexOf(0, pos);
  if (mimeEnd < 0) return null;
  const mime = frame.subarray(pos, mimeEnd).toString('latin1').toLowerCase();
  pos = mimeEnd + 1;
  if (pos >= frame.length) return null;
  pos += 1; // picture type
  const descEnd = findTerminator(frame, pos, encoding);
  pos = descEnd + ((encoding === 1 || encoding === 2) ? 2 : 1);
  if (pos >= frame.length) return null;
  return { mime, data: frame.subarray(pos) };
}

function parsePic(frame) {
  // ID3v2.2 uses PIC instead of APIC: encoding + 3-byte image format +
  // picture type + terminated description + image bytes.
  if (!frame || frame.length < 7) return null;
  const encoding = frame[0];
  const format = frame.subarray(1, 4).toString('ascii').toUpperCase();
  let pos = 5; // format + picture type
  const descEnd = findTerminator(frame, pos, encoding);
  pos = descEnd + ((encoding === 1 || encoding === 2) ? 2 : 1);
  if (pos >= frame.length) return null;
  const mime = format === 'PNG' ? 'image/png' : format === 'JPG' || format === 'JPEG' ? 'image/jpeg' : '';
  return { mime, data: frame.subarray(pos) };
}

function inferImageExt(mime, data) {
  const lower = (mime || '').toLowerCase();
  if (lower.includes('png')) return '.png';
  if (lower.includes('webp')) return '.webp';
  if (lower.includes('avif')) return '.avif';
  if (lower.includes('gif')) return '.gif';
  if (lower.includes('jpeg') || lower.includes('jpg')) return '.jpg';
  if (data?.length >= 12) {
    if (data[0] === 0x89 && data.subarray(1, 4).toString('ascii') === 'PNG') return '.png';
    if (data[0] === 0xff && data[1] === 0xd8) return '.jpg';
    if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
    if (data.subarray(4, 12).toString('ascii') === 'ftypavif' || data.subarray(4, 12).toString('ascii') === 'ftypavis') return '.avif';
    if (data.subarray(0, 3).toString('ascii') === 'GIF') return '.gif';
  }
  return '.jpg';
}

async function saveCover(coverDir, seed, mime, data) {
  if (!data || data.length < 16) return '';
  await fsp.mkdir(coverDir, { recursive: true });
  const hash = crypto.createHash('sha1').update(seed).update(String(data.length)).update(data).digest('hex').slice(0, 20);
  const out = path.join(coverDir, `${hash}${inferImageExt(mime, data)}`);
  try {
    await fsp.access(out);
  } catch {
    await fsp.writeFile(out, data);
  }
  return out;
}

async function parseMp3(filePath, coverDir, stat) {
  const fh = await fsp.open(filePath, 'r');
  try {
    const header = Buffer.alloc(10);
    const { bytesRead } = await fh.read(header, 0, 10, 0);
    const out = {};
    if (bytesRead === 10 && header.subarray(0, 3).toString('ascii') === 'ID3') {
      const version = header[3];
      const tagSize = syncSafe32(header, 6);
      const cap = Math.min(tagSize, 24 * 1024 * 1024);
      const tag = Buffer.alloc(cap);
      await fh.read(tag, 0, cap, 10);
      let pos = 0;
      while (pos + (version === 2 ? 6 : 10) <= tag.length) {
        let id, size, frameStart;
        if (version === 2) {
          id = tag.subarray(pos, pos + 3).toString('ascii');
          if (!id.trim()) break;
          size = tag.readUIntBE(pos + 3, 3);
          frameStart = pos + 6;
        } else {
          id = tag.subarray(pos, pos + 4).toString('ascii');
          if (!id.trim() || /^\x00+$/.test(id)) break;
          size = version === 4 ? syncSafe32(tag, pos + 4) : tag.readUInt32BE(pos + 4);
          frameStart = pos + 10;
        }
        if (!size || frameStart + size > tag.length) break;
        const frame = tag.subarray(frameStart, frameStart + size);
        if (id === 'TIT2' || id === 'TT2') out.title = decodeTextPayload(frame);
        else if (id === 'TPE1' || id === 'TP1') out.artist = decodeTextPayload(frame);
        else if (id === 'TALB' || id === 'TAL') out.album = decodeTextPayload(frame);
        else if (id === 'TCON' || id === 'TCO') out.genre = decodeTextPayload(frame);
        else if ((id === 'USLT' || id === 'ULT') && !out.embeddedLyrics) out.embeddedLyrics=parseUslt(frame);
        else if ((id === 'APIC' || id === 'PIC') && !out.coverPath) {
          const pic = id === 'APIC' ? parseApic(frame) : parsePic(frame);
          if (pic) out.coverPath = await saveCover(coverDir, `${filePath}:${stat.mtimeMs}:apic`, pic.mime, pic.data);
        }
        pos = frameStart + size;
      }
    }

    if (!out.title || !out.artist) {
      const tail = Buffer.alloc(128);
      if (stat.size >= 128) {
        await fh.read(tail, 0, 128, stat.size - 128);
        if (tail.subarray(0, 3).toString('ascii') === 'TAG') {
          if (!out.title) out.title = cleanText(decodeLegacyBytes(tail.subarray(3, 33)));
          if (!out.artist) out.artist = cleanText(decodeLegacyBytes(tail.subarray(33, 63)));
          if (!out.album) out.album = cleanText(decodeLegacyBytes(tail.subarray(63, 93)));
        }
      }
    }
    return out;
  } finally {
    await fh.close();
  }
}

function parseVorbisComments(buf, offset = 0) {
  const out = {};
  let pos = offset;
  if (pos + 4 > buf.length) return out;
  const vendorLen = buf.readUInt32LE(pos); pos += 4 + vendorLen;
  if (pos + 4 > buf.length) return out;
  const count = Math.min(buf.readUInt32LE(pos), 10000); pos += 4;
  for (let i = 0; i < count && pos + 4 <= buf.length; i++) {
    const len = buf.readUInt32LE(pos); pos += 4;
    if (len < 0 || pos + len > buf.length) break;
    const line = buf.subarray(pos, pos + len).toString('utf8'); pos += len;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).toUpperCase();
    const value = cleanText(line.slice(eq + 1));
    if (key === 'TITLE' && !out.title) out.title = value;
    else if ((key === 'ARTIST' || key === 'ALBUMARTIST') && !out.artist) out.artist = value;
    else if (key === 'ALBUM' && !out.album) out.album = value;
    else if (key === 'GENRE' && !out.genre) out.genre = value;
    else if (['LYRICS','UNSYNCEDLYRICS','UNSYNCED LYRICS'].includes(key) && !out.embeddedLyrics) out.embeddedLyrics=line.slice(eq+1).replace(/\r\n?/g,'\n').replace(/\u0000/g,'').slice(0,2*1024*1024);
    else if (key === 'METADATA_BLOCK_PICTURE' && !out.pictureBase64) out.pictureBase64 = value;
  }
  return out;
}

function parseFlacPicturePayload(buf) {
  try {
    let pos = 0;
    if (buf.length < 32) return null;
    pos += 4; // type
    const mimeLen = buf.readUInt32BE(pos); pos += 4;
    const mime = buf.subarray(pos, pos + mimeLen).toString('utf8'); pos += mimeLen;
    const descLen = buf.readUInt32BE(pos); pos += 4 + descLen;
    pos += 16; // width/height/depth/colors
    const dataLen = buf.readUInt32BE(pos); pos += 4;
    if (dataLen <= 0 || pos + dataLen > buf.length) return null;
    return { mime, data: buf.subarray(pos, pos + dataLen) };
  } catch {
    return null;
  }
}

async function parseFlac(filePath, coverDir, stat) {
  const fh = await fsp.open(filePath, 'r');
  try {
    const sig = Buffer.alloc(4);
    await fh.read(sig, 0, 4, 0);
    if (sig.toString('ascii') !== 'fLaC') return {};
    let pos = 4;
    const out = {};
    let last = false;
    let blocks = 0;
    while (!last && blocks++ < 128) {
      const h = Buffer.alloc(4);
      const r = await fh.read(h, 0, 4, pos);
      if (r.bytesRead !== 4) break;
      last = !!(h[0] & 0x80);
      const type = h[0] & 0x7f;
      const len = h.readUIntBE(1, 3);
      pos += 4;
      if (len > 32 * 1024 * 1024) { pos += len; continue; }
      const block = Buffer.alloc(len);
      await fh.read(block, 0, len, pos);
      if (type === 0 && len >= 18) {
        const packed = block.readBigUInt64BE(10);
        const sampleRate = Number((packed >> 44n) & 0xfffffn);
        const totalSamples = Number(packed & 0xfffffffffn);
        if (sampleRate > 0 && totalSamples > 0) out.duration = totalSamples / sampleRate;
      } else if (type === 4) {
        Object.assign(out, parseVorbisComments(block));
      } else if (type === 6 && !out.coverPath) {
        const pic = parseFlacPicturePayload(block);
        if (pic) out.coverPath = await saveCover(coverDir, `${filePath}:${stat.mtimeMs}:flacpic`, pic.mime, pic.data);
      }
      pos += len;
    }
    if (!out.coverPath && out.pictureBase64) {
      try {
        const pic = parseFlacPicturePayload(Buffer.from(out.pictureBase64, 'base64'));
        if (pic) out.coverPath = await saveCover(coverDir, `${filePath}:${stat.mtimeMs}:flaccommentpic`, pic.mime, pic.data);
      } catch {}
    }
    delete out.pictureBase64;
    return out;
  } finally {
    await fh.close();
  }
}

async function parseOgg(filePath, coverDir, stat) {
  const max = Math.min(stat.size, 4 * 1024 * 1024);
  const fh = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(max);
    await fh.read(buf, 0, max, 0);
    let off = buf.indexOf(Buffer.from('OpusTags'));
    let comments;
    if (off >= 0) comments = parseVorbisComments(buf, off + 8);
    else {
      const marker = Buffer.from([0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]);
      off = buf.indexOf(marker);
      if (off >= 0) comments = parseVorbisComments(buf, off + marker.length);
    }
    const out = comments || {};
    if (out.pictureBase64) {
      try {
        const pic = parseFlacPicturePayload(Buffer.from(out.pictureBase64, 'base64'));
        if (pic) out.coverPath = await saveCover(coverDir, `${filePath}:${stat.mtimeMs}:oggpic`, pic.mime, pic.data);
      } catch {}
      delete out.pictureBase64;
    }
    return out;
  } finally {
    await fh.close();
  }
}

function readAtomType(buf, off) {
  return buf.subarray(off, off + 4).toString('latin1');
}

async function parseMp4(filePath, coverDir, stat) {
  const fh = await fsp.open(filePath, 'r');
  const out = {};
  const containers = new Set(['moov', 'udta', 'meta', 'ilst']);
  const interestingItems = new Set(['©nam', '©ART', 'aART', '©alb', '©gen', '©lyr', 'covr']);

  async function readAt(position, length) {
    const b = Buffer.alloc(length);
    const r = await fh.read(b, 0, length, position);
    return b.subarray(0, r.bytesRead);
  }

  async function walk(start, end, parent = '', depth = 0) {
    if (depth > 8) return;
    let pos = start;
    let guard = 0;
    while (pos + 8 <= end && guard++ < 100000) {
      const h = await readAt(pos, 16);
      if (h.length < 8) break;
      let size = h.readUInt32BE(0);
      const type = readAtomType(h, 4);
      let headerSize = 8;
      if (size === 1) {
        if (h.length < 16) break;
        const big = h.readBigUInt64BE(8);
        if (big > BigInt(Number.MAX_SAFE_INTEGER)) break;
        size = Number(big);
        headerSize = 16;
      } else if (size === 0) {
        size = end - pos;
      }
      if (size < headerSize || pos + size > end + 1) break;
      let contentStart = pos + headerSize;
      const contentEnd = pos + size;

      if (type === 'mvhd') {
        const data = await readAt(contentStart, Math.min(40, contentEnd - contentStart));
        if (data.length >= 20) {
          const version = data[0];
          try {
            if (version === 1 && data.length >= 32) {
              const timescale = data.readUInt32BE(20);
              const duration = Number(data.readBigUInt64BE(24));
              if (timescale) out.duration = duration / timescale;
            } else {
              const timescale = data.readUInt32BE(12);
              const duration = data.readUInt32BE(16);
              if (timescale) out.duration = duration / timescale;
            }
          } catch {}
        }
      }

      const inIlst = parent.endsWith('/ilst');
      if (inIlst && interestingItems.has(type)) {
        let childPos = contentStart;
        while (childPos + 8 <= contentEnd) {
          const ch = await readAt(childPos, 16);
          if (ch.length < 8) break;
          let childSize = ch.readUInt32BE(0);
          let childHeader = 8;
          if (childSize === 1 && ch.length >= 16) { childSize = Number(ch.readBigUInt64BE(8)); childHeader = 16; }
          if (childSize < childHeader || childPos + childSize > contentEnd) break;
          const childType = readAtomType(ch, 4);
          if (childType === 'data') {
            const payloadStart = childPos + childHeader + 8;
            const payloadLen = childPos + childSize - payloadStart;
            if (payloadLen > 0 && payloadLen < 32 * 1024 * 1024) {
              const payload = await readAt(payloadStart, payloadLen);
              if (type === 'covr' && !out.coverPath) {
                out.coverPath = await saveCover(coverDir, `${filePath}:${stat.mtimeMs}:mp4covr`, '', payload);
              } else {
                const text = cleanText(payload.toString('utf8'));
                if (type === '©nam') out.title = text;
                else if ((type === '©ART' || type === 'aART') && !out.artist) out.artist = text;
                else if (type === '©alb') out.album = text;
                else if (type === '©gen') out.genre = text;
                else if(type==='©lyr')out.embeddedLyrics=decodeLyricText(3,payload);
              }
            }
          }
          childPos += childSize;
        }
      }

      if (containers.has(type) || (inIlst && !interestingItems.has(type))) {
        if (type === 'meta') contentStart += 4;
        if (contentStart < contentEnd) await walk(contentStart, contentEnd, `${parent}/${type}`, depth + 1);
      }
      pos += size;
    }
  }

  try {
    await walk(0, stat.size, '', 0);
    return out;
  } finally {
    await fh.close();
  }
}

function filenameFallback(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  const normalized = base.replace(/\s*\[[\w-]{5,}\]\s*$/, '').trim();
  const m = normalized.match(/^(.{1,100}?)\s[-–—]\s(.{1,180})$/);
  if (m) return { artist: cleanText(m[1]), title: cleanText(m[2]) };
  return { title: cleanText(normalized) || path.basename(filePath), artist: '' };
}

async function readSidecar(filePath) {
  const candidates = [
    `${filePath}.pulse.json`,
    `${filePath}.info.json`,
    path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}.info.json`),
  ];
  for (const p of candidates) {
    try {
      const raw = JSON.parse(await fsp.readFile(p, 'utf8'));
      if (p.endsWith('.pulse.json')) return raw;
      return {
        title: raw.track || raw.title,
        artist: raw.artist || raw.creator || raw.uploader || raw.channel,
        album: raw.album,
        duration: raw.duration,
        sourceUrl: raw.webpage_url || raw.original_url,
        thumbnail: raw.thumbnail,
        downloaded: true,
      };
    } catch {}
  }
  return null;
}


async function findLocalCover(filePath) {
  const dir = path.dirname(filePath);
  const stem = path.basename(filePath, path.extname(filePath));
  const names = [
    `${stem}.jpg`, `${stem}.jpeg`, `${stem}.png`, `${stem}.webp`, `${stem}.avif`,
    'cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'cover.avif',
    'folder.jpg', 'folder.jpeg', 'folder.png', 'folder.webp', 'folder.avif',
    'front.jpg', 'front.jpeg', 'front.png', 'front.webp', 'front.avif',
  ];
  for (const name of names) {
    const candidate = path.join(dir, name);
    try {
      const stat = await fsp.stat(candidate);
      if (stat.isFile() && stat.size >= 64 && stat.size <= 20 * 1024 * 1024) return candidate;
    } catch {}
  }
  return '';
}

async function extractMetadata(filePath, coverDir, stat) {
  const ext = path.extname(filePath).toLowerCase();
  const fallback = filenameFallback(filePath);
  let parsed = {};
  try {
    if (ext === '.mp3') parsed = await parseMp3(filePath, coverDir, stat);
    else if (ext === '.flac') parsed = await parseFlac(filePath, coverDir, stat);
    else if (['.m4a', '.mp4', '.m4b', '.mov'].includes(ext)) parsed = await parseMp4(filePath, coverDir, stat);
    else if (['.ogg', '.opus'].includes(ext)) parsed = await parseOgg(filePath, coverDir, stat);
  } catch {}

  const sidecar = await readSidecar(filePath);
  const merged = { ...fallback, ...parsed };
  if (sidecar) {
    for (const [k, v] of Object.entries(sidecar)) if (v !== undefined && v !== null && v !== '') merged[k] = v;
  }
  merged.title = cleanText(merged.title) || fallback.title;
  merged.artist = cleanText(merged.artist);
  merged.album = cleanText(merged.album || '');
  merged.genre = cleanText(merged.genre || '');
  // Sidecars point at cached artwork for fast startup. If the whole portable
  // PulseDeck directory was moved, recover that cover by basename in data/covers.
  if (merged.coverPath) {
    try { await fsp.access(merged.coverPath); }
    catch {
      const relocated = path.join(coverDir, path.basename(String(merged.coverPath)));
      try { await fsp.access(relocated); merged.coverPath = relocated; } catch { merged.coverPath = ''; }
    }
  }
  if (!merged.coverPath) merged.coverPath = await findLocalCover(filePath);
  return merged;
}

module.exports = { extractMetadata, saveCover, inferImageExt, parseUslt, parseVorbisComments };
