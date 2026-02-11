package ai.openclaw.android.pendant.codecs

import ai.openclaw.android.pendant.PendantProtocol
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Opus codec decoder for Limitless Pendant audio.
 *
 * Opus is a versatile audio codec suitable for both voice and music.
 * The Limitless Pendant uses:
 * - 16 kHz sample rate
 * - Variable frame sizes (20ms typical)
 * - TOC byte at frame start indicates mode
 *
 * Note: This implementation requires either:
 * 1. A native Opus library via JNI (libopus)
 * 2. A pure Java/Kotlin Opus implementation
 * 3. Android's MediaCodec with Opus support (API 21+)
 *
 * For production, consider using:
 * - concentus (pure Java Opus): https://github.com/lostromb/concentus
 * - opus-android JNI bindings
 */
class OpusCodec(
  override val sampleRate: Int = PendantProtocol.LIMITLESS_SAMPLE_RATE,
  override val channels: Int = PendantProtocol.PCM_CHANNELS
) : AudioCodec {

  companion object {
    private const val TAG = "OpusCodec"

    // Valid Opus TOC bytes for pendant audio
    // These indicate SILK/Hybrid modes suitable for voice
    val VALID_TOC_BYTES = setOf(0xb8, 0x78, 0xf8, 0xb0, 0x70, 0xf0)

    // Typical frame sizes for Opus at 16kHz
    const val FRAME_SIZE_20MS = 320 // 16000 * 0.02
    const val FRAME_SIZE_10MS = 160 // 16000 * 0.01
  }

  private var nativeHandle: Long = 0
  private var isInitialized = false

  init {
    initialize()
  }

  private fun initialize() {
    // TODO: Initialize native Opus decoder via JNI
    // nativeHandle = nativeCreateDecoder(sampleRate, channels)
    // if (nativeHandle == 0L) throw IllegalStateException("Failed to create Opus decoder")

    isInitialized = true
  }

  override fun decode(frame: ByteArray): ShortArray {
    if (!isInitialized) {
      throw IllegalStateException("Opus decoder not initialized")
    }

    if (frame.isEmpty()) {
      throw IllegalArgumentException("Empty Opus frame")
    }

    // Validate TOC byte
    val toc = frame[0].toInt() and 0xFF
    if (!isValidTocByte(toc)) {
      // May be a valid frame with different configuration
      // Log warning but attempt decode
    }

    // TODO: Implement actual Opus decoding via JNI
    // return nativeDecode(nativeHandle, frame)

    // Placeholder: Generate silence based on expected frame size
    // In production, this MUST be replaced with actual Opus decoding
    val expectedSamples = estimateFrameSamples(toc)
    return ShortArray(expectedSamples) { 0 }
  }

  override fun reset() {
    // TODO: Reset decoder state for a new stream
    // nativeReset(nativeHandle)
  }

  override fun release() {
    if (nativeHandle != 0L) {
      // TODO: Release native resources
      // nativeDestroy(nativeHandle)
      nativeHandle = 0
    }
    isInitialized = false
  }

  /**
   * Check if a byte is a valid Opus TOC byte for pendant audio.
   */
  fun isValidTocByte(toc: Int): Boolean {
    return toc in VALID_TOC_BYTES
  }

  /**
   * Estimate the number of output samples based on TOC byte.
   */
  private fun estimateFrameSamples(toc: Int): Int {
    // Opus TOC byte encodes frame duration in bits 3-4
    // For pendant audio, typically 20ms frames
    return FRAME_SIZE_20MS
  }

  // JNI native method declarations (to be implemented)
  // private external fun nativeCreateDecoder(sampleRate: Int, channels: Int): Long
  // private external fun nativeDecode(handle: Long, frame: ByteArray): ShortArray
  // private external fun nativeReset(handle: Long)
  // private external fun nativeDestroy(handle: Long)

  // companion object {
  //   init {
  //     System.loadLibrary("opuscodec")
  //   }
  // }
}

/**
 * Opus frame extractor for Limitless Pendant data.
 *
 * The Limitless Pendant sends data using a protobuf-style encoding:
 * - 0x22 marker indicates an Opus frame follows
 * - Varint-encoded length
 * - Opus frame data starting with TOC byte
 */
class OpusFrameExtractor {

  /**
   * Extract Opus frames from raw BLE data buffer.
   *
   * @param data Raw accumulated BLE data
   * @return Pair of (extracted frames, remaining data start position)
   */
  fun extractFrames(data: ByteArray): Pair<List<ByteArray>, Int> {
    val frames = mutableListOf<ByteArray>()
    var pos = 0
    var lastCompleteFrameEnd = 0

    while (pos < data.size - 3) {
      // Look for 0x22 marker
      if (data[pos].toInt() and 0xFF == 0x22) {
        val markerPos = pos
        pos++

        if (pos >= data.size) break

        // Decode length (varint)
        val (length, lengthEndPos) = decodeVarint(data, pos)

        // Validate length
        if (length in 10..200) {
          val frameStartPos = lengthEndPos
          val frameEndPos = frameStartPos + length

          if (frameEndPos <= data.size) {
            val frame = data.copyOfRange(frameStartPos, frameEndPos)

            // Check if first byte is valid Opus TOC
            if (frame.isNotEmpty() && isValidOpusToc(frame[0])) {
              frames.add(frame)
              lastCompleteFrameEnd = frameEndPos
              pos = frameEndPos
              continue
            }
          } else {
            // Incomplete frame, stop here
            break
          }
        }

        // Invalid, skip this marker
        pos = markerPos + 1
      } else {
        pos++
      }
    }

    return Pair(frames, lastCompleteFrameEnd)
  }

  /**
   * Decode a varint from the data buffer.
   *
   * @param data Data buffer
   * @param startPos Starting position
   * @return Pair of (decoded value, position after varint)
   */
  private fun decodeVarint(data: ByteArray, startPos: Int): Pair<Int, Int> {
    var result = 0
    var shift = 0
    var pos = startPos

    while (pos < data.size) {
      val byte = data[pos].toInt() and 0xFF
      pos++
      result = result or ((byte and 0x7F) shl shift)
      if ((byte and 0x80) == 0) break
      shift += 7
    }

    return Pair(result, pos)
  }

  /**
   * Check if a byte is a valid Opus TOC byte.
   */
  private fun isValidOpusToc(byte: Byte): Boolean {
    val value = byte.toInt() and 0xFF
    return value in OpusCodec.VALID_TOC_BYTES
  }
}

/**
 * Limitless Pendant command encoder.
 *
 * Commands use a protobuf-style encoding with:
 * - BLE wrapper with message index and flags
 * - Nested command messages
 * - Request ID for acknowledgment
 */
class LimitlessCommandEncoder {
  private var messageIndex = 0
  private var requestId = 0

  /**
   * Encode a time sync command.
   *
   * @param timestampMs Current time in milliseconds since epoch
   * @return Encoded command bytes
   */
  fun encodeSetCurrentTime(timestampMs: Long): ByteArray {
    val timeMsg = encodeInt64Field(1, timestampMs)
    val cmd = encodeMessage(6, timeMsg) + encodeRequestData()
    return encodeBleWrapper(cmd)
  }

  /**
   * Encode a data stream enable/disable command.
   *
   * @param enable True to enable streaming, false to disable
   * @return Encoded command bytes
   */
  fun encodeEnableDataStream(enable: Boolean = true): ByteArray {
    val msg = encodeField(1, 0, byteArrayOf(0x00)) +
              encodeField(2, 0, byteArrayOf(if (enable) 0x01 else 0x00))
    val cmd = encodeMessage(8, msg) + encodeRequestData()
    return encodeBleWrapper(cmd)
  }

  /**
   * Encode an acknowledgment for processed data.
   *
   * @param upToIndex Index to acknowledge up to
   * @return Encoded command bytes
   */
  fun encodeAcknowledgeProcessedData(upToIndex: Int): ByteArray {
    val ackMsg = encodeInt32Field(1, upToIndex)
    val cmd = encodeMessage(7, ackMsg) + encodeRequestData()
    return encodeBleWrapper(cmd)
  }

  private fun encodeBleWrapper(payload: ByteArray): ByteArray {
    val msg = encodeInt32Field(1, messageIndex) +
              encodeInt32Field(2, 0) +
              encodeInt32Field(3, 1) +
              encodeBytesField(4, payload)
    messageIndex++
    return msg
  }

  private fun encodeRequestData(): ByteArray {
    requestId++
    val msg = encodeInt64Field(1, requestId.toLong()) +
              encodeField(2, 0, byteArrayOf(0x00))
    return encodeMessage(30, msg)
  }

  private fun encodeVarint(value: Long): ByteArray {
    var v = value
    val result = mutableListOf<Byte>()
    while (v > 0x7F) {
      result.add(((v and 0x7F) or 0x80).toByte())
      v = v shr 7
    }
    result.add((v and 0x7F).toByte())
    return if (result.isEmpty()) byteArrayOf(0) else result.toByteArray()
  }

  private fun encodeField(fieldNum: Int, wireType: Int, value: ByteArray): ByteArray {
    val tag = (fieldNum shl 3) or wireType
    return encodeVarint(tag.toLong()) + value
  }

  private fun encodeBytesField(fieldNum: Int, data: ByteArray): ByteArray {
    val length = encodeVarint(data.size.toLong())
    return encodeField(fieldNum, 2, length + data)
  }

  private fun encodeMessage(fieldNum: Int, msgBytes: ByteArray): ByteArray {
    return encodeBytesField(fieldNum, msgBytes)
  }

  private fun encodeInt64Field(fieldNum: Int, value: Long): ByteArray {
    return encodeField(fieldNum, 0, encodeVarint(value))
  }

  private fun encodeInt32Field(fieldNum: Int, value: Int): ByteArray {
    return encodeField(fieldNum, 0, encodeVarint(value.toLong()))
  }

  fun reset() {
    messageIndex = 0
    requestId = 0
  }
}
