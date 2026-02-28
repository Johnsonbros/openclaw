package ai.openclaw.android.ble

import android.util.Log

/**
 * Reassembles fragmented BLE packets and extracts Opus audio frames.
 *
 * BLE packet header format:
 * ```
 * [index: uint16 LE] [sequence: uint8] [numFragments: uint8] [payload: bytes]
 * ```
 *
 * Packets with the same index are fragments of a single message.
 * Once all fragments for an index arrive, the payloads are concatenated
 * and parsed for Opus frames.
 */
class PendantProtocol {
  companion object {
    private const val TAG = "PendantProto"
    private const val HEADER_SIZE = 4
    private const val MIN_OPUS_FRAME = 3
    private const val MAX_OPUS_FRAME = 400
    // Valid Opus TOC config values: 0-31
    private const val MAX_OPUS_TOC_CONFIG = 31
    private const val MAX_PENDING_GROUPS = 64
    private const val MAX_FRAGMENT_AGE_MS = 5_000L
  }

  private data class FragmentGroup(
    val totalFragments: Int,
    val fragments: MutableMap<Int, ByteArray> = mutableMapOf(),
    val createdAt: Long = System.currentTimeMillis(),
  )

  private val pending = mutableMapOf<Int, FragmentGroup>()

  /**
   * Feed a raw BLE notification payload. Returns extracted Opus frames if a
   * complete packet has been reassembled, or an empty list otherwise.
   */
  fun onData(data: ByteArray): List<ByteArray> {
    if (data.size < HEADER_SIZE) {
      Log.w(TAG, "Packet too short: ${data.size}")
      return emptyList()
    }

    val index = (data[0].toInt() and 0xFF) or ((data[1].toInt() and 0xFF) shl 8)
    val sequence = data[2].toInt() and 0xFF
    val numFragments = data[3].toInt() and 0xFF

    if (numFragments == 0) {
      Log.w(TAG, "numFragments=0 for index=$index")
      return emptyList()
    }

    val payload = data.copyOfRange(HEADER_SIZE, data.size)

    // Single-fragment shortcut
    if (numFragments == 1) {
      pending.remove(index)
      return extractOpusFrames(payload)
    }

    evictStaleFragments()
    val group = pending.getOrPut(index) { FragmentGroup(numFragments) }
    group.fragments[sequence] = payload

    if (group.fragments.size >= group.totalFragments) {
      pending.remove(index)
      val assembled = ByteArray(group.fragments.values.sumOf { it.size })
      var offset = 0
      for (i in 0 until group.totalFragments) {
        val frag = group.fragments[i] ?: continue
        frag.copyInto(assembled, offset)
        offset += frag.size
      }
      return extractOpusFrames(assembled)
    }

    return emptyList()
  }

  /**
   * Extract Opus frames from a reassembled payload.
   *
   * The payload is a simple protobuf-like TLV where audio data fields contain
   * raw Opus frames prefixed by a varint length. We use a heuristic: scan for
   * valid Opus TOC bytes and extract contiguous frame data.
   */
  private fun extractOpusFrames(payload: ByteArray): List<ByteArray> {
    if (payload.isEmpty()) return emptyList()

    val frames = mutableListOf<ByteArray>()

    // Try simple length-prefixed extraction first (varint length + opus frame)
    var offset = 0
    while (offset < payload.size) {
      // Read varint length
      val lenResult = readVarint(payload, offset)
      if (lenResult == null) break
      val (frameLen, bytesRead) = lenResult
      offset += bytesRead

      if (frameLen < MIN_OPUS_FRAME || frameLen > MAX_OPUS_FRAME) {
        // Not a valid frame length — try byte-by-byte scan
        break
      }
      if (offset + frameLen > payload.size) break

      val frame = payload.copyOfRange(offset, offset + frameLen)
      if (isValidOpusFrame(frame)) {
        frames.add(frame)
      }
      offset += frameLen
    }

    // If structured parsing found frames, return them
    if (frames.isNotEmpty()) return frames

    // Fallback: treat entire payload as a single Opus frame if it looks valid
    if (payload.size in MIN_OPUS_FRAME..MAX_OPUS_FRAME && isValidOpusFrame(payload)) {
      return listOf(payload)
    }

    return emptyList()
  }

  /** Read a protobuf-style varint. Returns (value, bytesConsumed) or null. */
  private fun readVarint(data: ByteArray, start: Int): Pair<Int, Int>? {
    var result = 0
    var shift = 0
    var pos = start
    while (pos < data.size && shift < 35) {
      val b = data[pos].toInt() and 0xFF
      result = result or ((b and 0x7F) shl shift)
      pos++
      if (b and 0x80 == 0) return result to (pos - start)
      shift += 7
    }
    return null
  }

  /**
   * Validate an Opus frame by checking the TOC byte.
   * Bits 3-7 encode the config (0-31), bits 0-1 encode the code (0-3).
   */
  private fun isValidOpusFrame(frame: ByteArray): Boolean {
    if (frame.isEmpty()) return false
    val toc = frame[0].toInt() and 0xFF
    val config = toc shr 3
    return config <= MAX_OPUS_TOC_CONFIG
  }

  private fun evictStaleFragments() {
    val now = System.currentTimeMillis()
    val iter = pending.entries.iterator()
    while (iter.hasNext()) {
      val entry = iter.next()
      if (now - entry.value.createdAt > MAX_FRAGMENT_AGE_MS) iter.remove()
    }
    // Hard cap: if too many groups, remove oldest
    if (pending.size > MAX_PENDING_GROUPS) {
      val sortedKeys = pending.entries.sortedBy { it.value.createdAt }.map { it.key }
      val toRemove = sortedKeys.take(pending.size - MAX_PENDING_GROUPS)
      toRemove.forEach { pending.remove(it) }
    }
  }

  /** Clear any buffered fragment state. */
  fun reset() {
    pending.clear()
  }
}
