package ai.openclaw.android.pendant.codecs

import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Abstract interface for audio codec decoders.
 * Implementations decode compressed audio frames to PCM samples.
 */
interface AudioCodec {
  /**
   * The sample rate of the decoded audio.
   */
  val sampleRate: Int

  /**
   * Number of audio channels (typically 1 for pendant audio).
   */
  val channels: Int

  /**
   * Decode a single compressed audio frame to PCM samples.
   *
   * @param frame The compressed audio frame bytes
   * @return PCM samples as 16-bit signed integers (little-endian)
   */
  fun decode(frame: ByteArray): ShortArray

  /**
   * Decode multiple frames and return concatenated PCM samples.
   *
   * @param frames List of compressed audio frames
   * @return Concatenated PCM samples as 16-bit signed integers
   */
  fun decodeFrames(frames: List<ByteArray>): ShortArray {
    val allSamples = mutableListOf<Short>()
    for (frame in frames) {
      try {
        allSamples.addAll(decode(frame).toList())
      } catch (e: Exception) {
        // Log and skip corrupted frames
      }
    }
    return allSamples.toShortArray()
  }

  /**
   * Reset the decoder state.
   * Call this when starting a new audio stream.
   */
  fun reset()

  /**
   * Release resources held by the decoder.
   */
  fun release()
}

/**
 * Utility functions for PCM audio conversion.
 */
object PcmUtils {

  /**
   * Convert ShortArray PCM samples to ByteArray (little-endian 16-bit).
   */
  fun shortArrayToByteArray(samples: ShortArray): ByteArray {
    val buffer = ByteBuffer.allocate(samples.size * 2)
    buffer.order(ByteOrder.LITTLE_ENDIAN)
    for (sample in samples) {
      buffer.putShort(sample)
    }
    return buffer.array()
  }

  /**
   * Convert ByteArray (little-endian 16-bit) to ShortArray PCM samples.
   */
  fun byteArrayToShortArray(bytes: ByteArray): ShortArray {
    val buffer = ByteBuffer.wrap(bytes)
    buffer.order(ByteOrder.LITTLE_ENDIAN)
    val samples = ShortArray(bytes.size / 2)
    for (i in samples.indices) {
      samples[i] = buffer.getShort()
    }
    return samples
  }

  /**
   * Create a WAV header for PCM audio data.
   *
   * @param pcmDataLength Length of PCM data in bytes
   * @param sampleRate Sample rate in Hz
   * @param channels Number of audio channels
   * @param bitsPerSample Bits per sample (typically 16)
   * @return WAV file header bytes
   */
  fun createWavHeader(
    pcmDataLength: Int,
    sampleRate: Int,
    channels: Int = 1,
    bitsPerSample: Int = 16
  ): ByteArray {
    val byteRate = sampleRate * channels * bitsPerSample / 8
    val blockAlign = channels * bitsPerSample / 8
    val fileSize = 36 + pcmDataLength

    val buffer = ByteBuffer.allocate(44)
    buffer.order(ByteOrder.LITTLE_ENDIAN)

    // RIFF header
    buffer.put("RIFF".toByteArray())
    buffer.putInt(fileSize)
    buffer.put("WAVE".toByteArray())

    // fmt subchunk
    buffer.put("fmt ".toByteArray())
    buffer.putInt(16) // Subchunk1 size (16 for PCM)
    buffer.putShort(1) // Audio format (1 = PCM)
    buffer.putShort(channels.toShort())
    buffer.putInt(sampleRate)
    buffer.putInt(byteRate)
    buffer.putShort(blockAlign.toShort())
    buffer.putShort(bitsPerSample.toShort())

    // data subchunk
    buffer.put("data".toByteArray())
    buffer.putInt(pcmDataLength)

    return buffer.array()
  }

  /**
   * Wrap PCM data in a complete WAV file.
   *
   * @param pcmData Raw PCM audio data
   * @param sampleRate Sample rate in Hz
   * @param channels Number of audio channels
   * @param bitsPerSample Bits per sample (typically 16)
   * @return Complete WAV file bytes
   */
  fun wrapInWav(
    pcmData: ByteArray,
    sampleRate: Int,
    channels: Int = 1,
    bitsPerSample: Int = 16
  ): ByteArray {
    val header = createWavHeader(pcmData.size, sampleRate, channels, bitsPerSample)
    return header + pcmData
  }
}
