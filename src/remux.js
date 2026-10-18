// Lossless `moov`-to-front rewrite, in process.
//
// This is the same transform the sibling dsh-boot-animation ships: it moves a
// clip's index table before the media data so the browser can start painting
// almost immediately. The refusal rules are kept identical — equal length, the
// media payload bit-identical after `moov` is stripped out, the chunk-offset
// tables shifted by exactly the layout's shift, and the result asserted to
// actually place `moov` before `mdat`.
//
// Nothing here runs unless the user presses the card's 优化 button. The plugin
// never rewrites a clip on its own.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'

/**
 * Ceiling for an in-place rewrite, in bytes.
 *
 * `remux` holds the whole file in memory and then builds a second buffer of the
 * same size, so the peak cost is about twice the clip. 100MB keeps that bounded
 * in a process that is also serving the UI.
 */
export const MAX_OPTIMIZE_BYTES = 100 * 1024 * 1024

/** A refusal the route reports as a plain sentence rather than a crash. */
function refusal(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

/**
 * Walk the top-level box list of an mp4.
 * @param buffer - whole file.
 * @returns boxes in file order.
 */
function topLevelBoxes(buffer) {
  const boxes = []
  let offset = 0
  while (offset + 8 <= buffer.length) {
    let size = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    let header = 8
    if (size === 1) {
      if (offset + 16 > buffer.length) break
      const high = buffer.readUInt32BE(offset + 8)
      const low = buffer.readUInt32BE(offset + 12)
      size = high * 2 ** 32 + low
      header = 16
    } else if (size === 0) {
      size = buffer.length - offset
    }
    if (size < header || offset + size > buffer.length) {
      throw new Error(`malformed box ${type} at ${String(offset)} (size ${String(size)})`)
    }
    boxes.push({ type, start: offset, size, header, payload: offset + header })
    offset += size
  }
  if (offset !== buffer.length) {
    throw new Error(`trailing bytes: parsed ${String(offset)} of ${String(buffer.length)}`)
  }
  return boxes
}

/**
 * Locate every chunk-offset table inside the movie box.
 *
 * The scan is confined to `moov` because `stco` as a byte sequence can also
 * occur inside compressed `mdat` payload by chance; restricting it and then
 * checking that the box length matches its own entry count makes a false
 * positive essentially impossible.
 */
function chunkOffsetTables(moov) {
  const tables = []
  const needle = Buffer.from('stco', 'latin1')
  const wide = Buffer.from('co64', 'latin1')
  for (const [marker, width] of [[needle, 4], [wide, 8]]) {
    for (let at = moov.indexOf(marker); at >= 0; at = moov.indexOf(marker, at + 1)) {
      const sizeAt = at - 4
      if (sizeAt < 0) continue
      const declared = moov.readUInt32BE(sizeAt)
      if (at + 8 > moov.length) continue
      const count = moov.readUInt32BE(at + 8)
      if (declared !== 16 + width * count) continue
      if (sizeAt + declared > moov.length) continue
      tables.push({ type: marker.toString('latin1'), dataAt: at + 12, count, width })
    }
  }
  return tables
}

/**
 * Decide the new top-level order and the byte shift applied to chunk offsets.
 */
function plan(boxes) {
  const moovAt = boxes.findIndex(box => box.type === 'moov')
  if (moovAt < 0) throw new Error('no moov box')
  const moov = boxes[moovAt]
  const mdatCount = boxes.filter(box => box.type === 'mdat').length
  if (mdatCount > 1) throw new Error('multiple mdat boxes are not supported')
  const moovIsFirst = moovAt === 0 || boxes.slice(0, moovAt).every(box => box.type !== 'mdat')
  if (moovIsFirst) return { already: true }

  const withoutMoov = boxes.filter(box => box !== moov)
  const insertAt = withoutMoov.findIndex(box => box.type === 'ftyp') + 1
  const ordered = [
    ...withoutMoov.slice(0, insertAt),
    moov,
    ...withoutMoov.slice(insertAt),
  ]
  const mdatAt = ordered.findIndex(box => box.type === 'mdat')
  const moovOrder = ordered.findIndex(box => box.type === 'moov')
  if (mdatAt >= 0 && moovOrder > mdatAt) {
    throw new Error('planned layout leaves moov after mdat; refusing to write')
  }

  let cursor = 0
  const placed = new Map()
  for (const box of ordered) {
    placed.set(box, cursor)
    cursor += box.size
  }
  if (cursor !== boxes.reduce((sum, box) => sum + box.size, 0)) {
    throw new Error('layout does not conserve length')
  }
  const mdat = boxes.find(box => box.type === 'mdat')
  const shift = (placed.get(mdat) + mdat.header) - mdat.payload
  if (mdat !== undefined && shift <= 0) {
    throw new Error(`moov would not move (shift ${String(shift)}); refusing to write`)
  }
  return { already: false, moov, ordered, placed, shift, mdat }
}

/** Apply a byte shift to every entry of every chunk-offset table. */
function patchOffsets(moovBytes, tables, shift) {
  const out = Buffer.from(moovBytes)
  for (const table of tables) {
    for (let index = 0; index < table.count; index += 1) {
      const at = table.dataAt + index * table.width
      let value = table.width === 4 ? out.readUInt32BE(at) : Number(out.readBigUInt64BE(at))
      const moved = value + shift
      if (table.width === 4) {
        if (moved < 0 || moved > 0xffffffff) {
          throw new Error('a 32-bit chunk offset overflowed; the file needs co64, use ffmpeg')
        }
        out.writeUInt32BE(moved, at)
      } else {
        out.writeBigUInt64BE(BigInt(moved), at)
      }
    }
  }
  return out
}

/**
 * Rewrite one file into a staging directory.
 * @param file - absolute path to the source clip.
 * @param target - directory the rewritten copy is written into.
 * @param writeTo - false reports without writing.
 * @returns a human-readable result line.
 */
export function remux(file, target, writeTo) {
  const name = basename(file)
  const buffer = readFileSync(file)
  const boxes = topLevelBoxes(buffer)
  const layout = plan(boxes)
  if (layout.already) return `SKIP  ${name}: moov 已在最前，无需处理`

  const moovBytes = buffer.subarray(layout.moov.start, layout.moov.start + layout.moov.size)
  const tables = chunkOffsetTables(moovBytes)
  if (tables.length === 0) throw new Error('no chunk offset table inside moov')
  const patched = patchOffsets(moovBytes, tables, layout.shift)

  const pieces = []
  for (const box of layout.ordered) {
    if (box === layout.moov) pieces.push(patched)
    else pieces.push(buffer.subarray(box.start, box.start + box.size))
  }
  const output = Buffer.concat(pieces)
  if (output.length !== buffer.length) {
    throw new Error(`length changed: ${String(buffer.length)} -> ${String(output.length)}`)
  }

  // Lossless proof: removing `moov` from both files must leave the same bytes.
  const strip = (bytes, boxList) => {
    const parts = boxList.filter(box => box.type !== 'moov')
      .map(box => bytes.subarray(box.start, box.start + box.size))
    return Buffer.concat(parts)
  }
  const before = strip(buffer, boxes)
  const after = strip(output, topLevelBoxes(output))
  if (!before.equals(after)) throw new Error('media payload changed; refusing to write')

  const outBoxes = topLevelBoxes(output)
  const outMoov = outBoxes.findIndex(box => box.type === 'moov')
  const outMdat = outBoxes.findIndex(box => box.type === 'mdat')
  if (outMoov < 0 || (outMdat >= 0 && outMoov > outMdat)) {
    throw new Error('output still places moov after mdat; refusing to write')
  }

  const moovStart = layout.placed.get(layout.moov)
  const newMoov = output.subarray(moovStart, moovStart + patched.length)
  const newTables = chunkOffsetTables(newMoov)
  if (newTables.length !== tables.length) throw new Error('table count changed')
  for (let index = 0; index < tables.length; index += 1) {
    const oldAt = tables[index].dataAt
    const newAt = newTables[index].dataAt
    for (let entry = 0; entry < tables[index].count; entry += 1) {
      const delta = tables[index].width
      const was = moovBytes.readUInt32BE(oldAt + entry * delta)
      const now = newMoov.readUInt32BE(newAt + entry * delta)
      if (now !== was + layout.shift) throw new Error(`entry ${String(entry)} not shifted correctly`)
    }
  }

  const out = join(target, `${basename(name, extname(name))}.faststart.mp4`)
  const KiB = (layout.moov.size / 1024).toFixed(0)
  const shouldWrite = writeTo === true
  if (!shouldWrite) return `TODO  ${name}: moov 在 ${String(layout.moov.start)}，需要前移 ${KiB}KiB（writeTo 为 false，未写）`
  mkdirSync(target, { recursive: true })
  writeFileSync(out, output)
  return `WROTE ${name} -> ${basename(out)}（moov 前移 ${KiB}KiB，${String(tables.length)} 张偏移表已重写）`
}

/**
 * Whether `moov` precedes `mdat` in the leading part of a file.
 *
 * The same 64 KiB window and the same reasoning as the Host half's manifest read.
 */
export async function leadingBox(file) {
  let handle
  try {
    handle = await open(file, 'r')
    const head = Buffer.alloc(65536)
    const { bytesRead } = await handle.read(head, 0, head.length, 0)
    let offset = 0
    while (offset + 8 <= bytesRead) {
      const type = head.toString('latin1', offset + 4, offset + 8)
      if (type === 'moov') return true
      if (type === 'mdat') return false
      const size = head.readUInt32BE(offset)
      if (size < 8) break
      offset += size
    }
    return undefined
  } catch {
    return undefined
  } finally {
    await handle?.close()
  }
}

/**
 * Move one pool clip's index table to the front, in place.
 *
 * The original is moved into `backupDir` first and the rewritten file is renamed
 * into its place, so the pool path never holds a half-written file.
 */
export async function optimizeInPlace(options) {
  const file = options.file
  const name = basename(file)
  const backupDir = options.backupDir
  const scratchDir = options.scratchDir
  const max = options.maxBytes ?? MAX_OPTIMIZE_BYTES
  const info = statSync(file)

  if (info.size > max) {
    throw refusal('E_TOO_BIG',
      `${name} 有 ${(info.size / 1024 / 1024).toFixed(1)}MB，超过 ${String(Math.round(max / 1024 / 1024))}MB 上限，不处理。`)
  }

  const leading = await leadingBox(file)
  if (leading === true) return { ok: true, status: 'already', name }
  if (leading !== false) {
    throw refusal('E_UNSUPPORTED', `${name} 的文件头里读不到 moov/mdat（可能不是 mp4），不敢动。`)
  }

  const sizeBefore = info.size
  const backup = join(backupDir, name)
  const produced = join(scratchDir, `${basename(name, extname(name))}.faststart.mp4`)
  let staged = false

  try {
    mkdirSync(scratchDir, { recursive: true })
    remux(file, scratchDir, true)
    if (!existsSync(produced)) throw new Error('重排没有产出文件')
    if (statSync(produced).size !== sizeBefore) throw new Error('重排后的长度变了')
    if (await leadingBox(produced) !== true) throw new Error('重排后的文件里 moov 仍在 mdat 之后')

    mkdirSync(backupDir, { recursive: true })
    if (existsSync(backup)) rmSync(backup, { force: true })
    renameSync(file, backup)
    staged = true
  } catch (error) {
    rmSync(scratchDir, { recursive: true, force: true })
    if (staged) {
      if (!existsSync(file) && existsSync(backup)) renameSync(backup, file)
      throw refusal('E_FAILED', `重排失败，原片已留在原地：${error.message}`)
    }
    if (typeof error.code === 'string' && error.code.startsWith('E_')) throw error
    throw refusal('E_FAILED', `重排失败，原片没动：${error.message}`)
  }

  try {
    renameSync(produced, file)
    if (await leadingBox(file) !== true) throw new Error('重排后 moov 仍在 mdat 之后')
    if (statSync(file).size !== sizeBefore) throw new Error('重排后长度变了')
  } catch (error) {
    rmSync(file, { force: true })
    renameSync(backup, file)
    rmSync(scratchDir, { recursive: true, force: true })
    throw refusal('E_FAILED', `重排自检没过，已还原原片：${error.message}`)
  }

  rmSync(scratchDir, { recursive: true, force: true })
  return { ok: true, status: 'done', name, bytes: sizeBefore, backup: basename(backupDir) + '/' + name }
}
