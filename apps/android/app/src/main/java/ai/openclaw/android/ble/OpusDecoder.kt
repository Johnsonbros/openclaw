package ai.openclaw.android.ble

import android.media.MediaCodec
import android.media.MediaFormat
import android.util.Log
import java.nio.ByteBuffer

/**
 * Decodes Opus audio frames to PCM 16-bit samples using Android's MediaCodec.
 *
 * Configuration: 16 kHz sample rate, mono, 20 ms frames (320 samples per frame).
 */
class OpusDecoder {
  companion object {
    private const val TAG = "OpusDecoder"
    const val SAMPLE_RATE = 16_000
    const val CHANNELS = 1
    const val FRAME_DURATION_MS = 20
    const val SAMPLES_PER_FRAME = SAMPLE_RATE * FRAME_DURATION_MS / 1000 // 320
    const val PCM_FRAME_SIZE = SAMPLES_PER_FRAME * 2 // 640 bytes (16-bit mono)
    private const val TIMEOUT_US = 10_000L
  }

  private var codec: MediaCodec? = null
  private var isStarted = false

  /**
   * Initialize the Opus decoder. Call before [decode].
   * Returns true on success.
   */
  fun start(): Boolean {
    try {
      val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_OPUS, SAMPLE_RATE, CHANNELS)
      // Opus requires CSD buffers. CSD-0: Opus identification header.
      // Minimal valid Opus ID header (19 bytes):
      // "OpusHead" + version(1) + channels(1) + pre-skip(2) + sampleRate(4) + gain(2) + mappingFamily(1)
      val csd0 = ByteBuffer.wrap(buildOpusIdHeader())
      // CSD-1: pre-skip in nanoseconds (0 for simplicity)
      val csd1 = ByteBuffer.allocate(8)
      csd1.putLong(0)
      csd1.flip()
      // CSD-2: seek pre-roll in nanoseconds (80ms = 80_000_000 ns typical for Opus)
      val csd2 = ByteBuffer.allocate(8)
      csd2.putLong(80_000_000L)
      csd2.flip()

      format.setByteBuffer("csd-0", csd0)
      format.setByteBuffer("csd-1", csd1)
      format.setByteBuffer("csd-2", csd2)

      val mc = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_OPUS)
      mc.configure(format, null, null, 0)
      mc.start()
      codec = mc
      isStarted = true
      Log.d(TAG, "Opus MediaCodec decoder started")
      return true
    } catch (e: Exception) {
      Log.e(TAG, "Failed to start Opus decoder: ${e.message}")
      return false
    }
  }

  /**
   * Decode a single Opus frame to PCM 16-bit samples.
   * Returns the PCM data or null on error.
   */
  fun decode(opusFrame: ByteArray): ShortArray? {
    val mc = codec ?: return null
    if (!isStarted) return null

    try {
      // Queue input
      val inputIndex = mc.dequeueInputBuffer(TIMEOUT_US)
      if (inputIndex < 0) {
        Log.w(TAG, "No input buffer available")
        return null
      }
      val inputBuffer = mc.getInputBuffer(inputIndex) ?: return null
      inputBuffer.clear()
      inputBuffer.put(opusFrame)
      mc.queueInputBuffer(inputIndex, 0, opusFrame.size, 0, 0)

      // Dequeue output
      val info = MediaCodec.BufferInfo()
      val outputIndex = mc.dequeueOutputBuffer(info, TIMEOUT_US)
      if (outputIndex < 0) {
        // Format change or try again — not necessarily an error
        return null
      }

      val outputBuffer = mc.getOutputBuffer(outputIndex) ?: run {
        mc.releaseOutputBuffer(outputIndex, false)
        return null
      }

      val pcmBytes = ByteArray(info.size)
      outputBuffer.get(pcmBytes)
      mc.releaseOutputBuffer(outputIndex, false)

      // Convert bytes to shorts (little-endian)
      val samples = ShortArray(pcmBytes.size / 2)
      for (i in samples.indices) {
        val lo = pcmBytes[i * 2].toInt() and 0xFF
        val hi = pcmBytes[i * 2 + 1].toInt() and 0xFF
        samples[i] = ((hi shl 8) or lo).toShort()
      }
      return samples
    } catch (e: Exception) {
      Log.e(TAG, "Decode error: ${e.message}")
      return null
    }
  }

  /** Stop and release the decoder. */
  fun stop() {
    isStarted = false
    try {
      codec?.stop()
      codec?.release()
    } catch (e: Exception) {
      Log.w(TAG, "Error stopping decoder: ${e.message}")
    }
    codec = null
    Log.d(TAG, "Opus decoder stopped")
  }

  private fun buildOpusIdHeader(): ByteArray {
    // 19-byte Opus identification header
    val header = ByteArray(19)
    // "OpusHead"
    val magic = "OpusHead".toByteArray(Charsets.US_ASCII)
    magic.copyInto(header, 0)
    header[8] = 1 // version
    header[9] = CHANNELS.toByte() // channel count
    // pre-skip: 0 (bytes 10-11, little-endian)
    header[10] = 0
    header[11] = 0
    // sample rate: 16000 (bytes 12-15, little-endian)
    header[12] = (SAMPLE_RATE and 0xFF).toByte()
    header[13] = ((SAMPLE_RATE shr 8) and 0xFF).toByte()
    header[14] = ((SAMPLE_RATE shr 16) and 0xFF).toByte()
    header[15] = ((SAMPLE_RATE shr 24) and 0xFF).toByte()
    // output gain: 0 (bytes 16-17)
    header[16] = 0
    header[17] = 0
    // mapping family: 0 (byte 18)
    header[18] = 0
    return header
  }
}
