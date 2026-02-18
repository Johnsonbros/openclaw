package ai.openclaw.android.ble

import android.util.Log
import ai.openclaw.android.gateway.GatewaySession
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * Bridges pendant BLE audio to the OpenClaw gateway.
 *
 * Collects decoded PCM audio from the pendant, buffers it into segments,
 * and sends it to the gateway as voice input via the node event system.
 * When a pendant is connected, it takes priority over the phone microphone.
 */
class PendantAudioBridge(
  private val scope: CoroutineScope,
  private val bleManager: PendantBleManager,
  private val getSession: () -> GatewaySession?,
  private val isConnected: () -> Boolean,
) {
  companion object {
    private const val TAG = "PendantBridge"
    // Buffer PCM for this many ms before sending to gateway
    private const val BUFFER_DURATION_MS = 1000L
    // Max PCM buffer size (1 second of 16kHz mono 16-bit = 32000 bytes)
    private const val MAX_BUFFER_BYTES = 32_000
  }

  private val protocol = PendantProtocol()
  private val decoder = OpusDecoder()
  private val pcmBuffer = ByteArrayOutputStream(MAX_BUFFER_BYTES)
  private var collectJob: Job? = null
  private var flushJob: Job? = null
  private var isRunning = false

  val isPendantAudioActive: Boolean
    get() = isRunning && bleManager.connectionState.value == PendantBleManager.ConnectionState.CONNECTED

  /**
   * Start processing pendant audio. Call when pendant connects.
   */
  fun start() {
    if (isRunning) return
    isRunning = true

    if (!decoder.start()) {
      Log.e(TAG, "Failed to start Opus decoder")
      isRunning = false
      return
    }

    protocol.reset()
    pcmBuffer.reset()

    // Collect raw BLE audio data
    collectJob = scope.launch(Dispatchers.Default) {
      bleManager.audioData.collect { rawData ->
        processRawData(rawData)
      }
    }

    // Periodic flush of PCM buffer to gateway
    flushJob = scope.launch(Dispatchers.IO) {
      while (isRunning) {
        delay(BUFFER_DURATION_MS)
        flushPcmToGateway()
      }
    }

    Log.d(TAG, "Pendant audio bridge started")
  }

  /**
   * Stop processing pendant audio.
   */
  fun stop() {
    isRunning = false
    collectJob?.cancel()
    collectJob = null
    flushJob?.cancel()
    flushJob = null
    decoder.stop()
    protocol.reset()
    synchronized(pcmBuffer) { pcmBuffer.reset() }
    Log.d(TAG, "Pendant audio bridge stopped")
  }

  private fun processRawData(data: ByteArray) {
    val opusFrames = protocol.onData(data)
    for (frame in opusFrames) {
      val pcm = decoder.decode(frame) ?: continue
      val bytes = shortsToBytes(pcm)
      synchronized(pcmBuffer) {
        if (pcmBuffer.size() + bytes.size <= MAX_BUFFER_BYTES * 2) {
          pcmBuffer.write(bytes)
        }
      }
    }
  }

  private fun flushPcmToGateway() {
    val data: ByteArray
    synchronized(pcmBuffer) {
      if (pcmBuffer.size() == 0) return
      data = pcmBuffer.toByteArray()
      pcmBuffer.reset()
    }

    val session = getSession() ?: return
    if (!isConnected()) return

    // Send PCM audio to gateway as a node event with base64-encoded audio
    scope.launch(Dispatchers.IO) {
      try {
        val b64 = android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP)
        val payload = """{"source":"pendant","format":"pcm_16000","channels":1,"encoding":"base64","data":"$b64"}"""
        session.sendNodeEvent("audio.input", payload)
      } catch (e: Exception) {
        Log.w(TAG, "Failed to send pendant audio: ${e.message}")
      }
    }
  }

  private fun shortsToBytes(samples: ShortArray): ByteArray {
    val bytes = ByteArray(samples.size * 2)
    for (i in samples.indices) {
      val s = samples[i].toInt()
      bytes[i * 2] = (s and 0xFF).toByte()
      bytes[i * 2 + 1] = ((s shr 8) and 0xFF).toByte()
    }
    return bytes
  }
}
