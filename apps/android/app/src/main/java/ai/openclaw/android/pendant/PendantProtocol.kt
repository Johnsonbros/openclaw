package ai.openclaw.android.pendant

import java.util.UUID

/**
 * BLE protocol constants for supported pendant devices.
 *
 * Friend Pendant:
 * - Uses LC3 codec at 16 kHz with 10ms frames (30 bytes per frame)
 * - Packets contain 3 frames (90 bytes LC3 data + 5 bytes footer = 95 bytes total)
 *
 * Limitless Pendant:
 * - Uses Opus codec with variable frame sizes
 * - Requires initialization commands (time sync, enable data stream)
 * - Uses protobuf-style encoding for commands
 */
object PendantProtocol {

  // Friend Pendant Service and Characteristics
  val FRIEND_SERVICE_UUID: UUID = UUID.fromString("1a3fd0e7-b1f3-ac9e-2e49-b647b2c4f8da")
  val FRIEND_AUDIO_CHARACTERISTIC_UUID: UUID = UUID.fromString("01000000-1111-1111-1111-111111111111")

  // Limitless Pendant Service and Characteristics
  val LIMITLESS_SERVICE_UUID: UUID = UUID.fromString("632de001-604c-446b-a80f-7963e950f3fb")
  val LIMITLESS_TX_CHARACTERISTIC_UUID: UUID = UUID.fromString("632de002-604c-446b-a80f-7963e950f3fb")
  val LIMITLESS_RX_CHARACTERISTIC_UUID: UUID = UUID.fromString("632de003-604c-446b-a80f-7963e950f3fb")

  // Standard Battery Service
  val BATTERY_SERVICE_UUID: UUID = UUID.fromString("0000180f-0000-1000-8000-00805f9b34fb")
  val BATTERY_LEVEL_CHARACTERISTIC_UUID: UUID = UUID.fromString("00002a19-0000-1000-8000-00805f9b34fb")

  // Device Information Service
  val DEVICE_INFO_SERVICE_UUID: UUID = UUID.fromString("0000180a-0000-1000-8000-00805f9b34fb")
  val MODEL_NUMBER_CHARACTERISTIC_UUID: UUID = UUID.fromString("00002a24-0000-1000-8000-00805f9b34fb")
  val FIRMWARE_REVISION_CHARACTERISTIC_UUID: UUID = UUID.fromString("00002a26-0000-1000-8000-00805f9b34fb")
  val HARDWARE_REVISION_CHARACTERISTIC_UUID: UUID = UUID.fromString("00002a27-0000-1000-8000-00805f9b34fb")
  val MANUFACTURER_NAME_CHARACTERISTIC_UUID: UUID = UUID.fromString("00002a29-0000-1000-8000-00805f9b34fb")

  // Friend Pendant Audio Packet Format
  const val FRIEND_PACKET_SIZE = 95
  const val FRIEND_PACKET_FOOTER_SIZE = 5
  const val FRIEND_LC3_DATA_SIZE = 90 // 3 frames of 30 bytes each
  const val FRIEND_LC3_FRAME_SIZE = 30 // Single LC3 frame size
  const val FRIEND_SAMPLE_RATE = 16000
  const val FRIEND_FRAME_DURATION_MS = 10

  // Limitless Pendant Audio Format
  const val LIMITLESS_SAMPLE_RATE = 16000

  // Audio output format
  const val PCM_BITS_PER_SAMPLE = 16
  const val PCM_CHANNELS = 1
}

/**
 * Supported pendant device types.
 */
enum class PendantType {
  FRIEND,
  LIMITLESS,
  UNKNOWN;

  companion object {
    fun fromDeviceName(name: String?): PendantType {
      val lower = name?.lowercase() ?: return UNKNOWN
      return when {
        lower.startsWith("friend") || lower.contains("friend_") -> FRIEND
        lower.startsWith("limitless") || lower.contains("pendant") -> LIMITLESS
        else -> UNKNOWN
      }
    }

    fun fromServiceUuid(uuid: UUID): PendantType {
      return when (uuid) {
        PendantProtocol.FRIEND_SERVICE_UUID -> FRIEND
        PendantProtocol.LIMITLESS_SERVICE_UUID -> LIMITLESS
        else -> UNKNOWN
      }
    }
  }
}

/**
 * Audio codec types supported by pendants.
 */
enum class PendantAudioCodec {
  LC3,      // Low Complexity Communication Codec (Friend Pendant)
  OPUS,     // Opus codec (Limitless Pendant)
  PCM16;    // Raw 16-bit PCM (decoded output)

  val sampleRate: Int
    get() = when (this) {
      LC3 -> PendantProtocol.FRIEND_SAMPLE_RATE
      OPUS -> PendantProtocol.LIMITLESS_SAMPLE_RATE
      PCM16 -> PendantProtocol.FRIEND_SAMPLE_RATE
    }
}

/**
 * Connection state for pendant devices.
 */
enum class PendantConnectionState {
  DISCONNECTED,
  CONNECTING,
  CONNECTED,
  STREAMING,
  ERROR
}

/**
 * Represents a discovered pendant device.
 */
data class DiscoveredPendant(
  val address: String,
  val name: String?,
  val type: PendantType,
  val rssi: Int,
  val serviceUuids: List<UUID>
) {
  val displayName: String
    get() = name?.takeIf { it.isNotBlank() } ?: "Unknown Pendant"

  val typeDisplayName: String
    get() = when (type) {
      PendantType.FRIEND -> "Friend"
      PendantType.LIMITLESS -> "Limitless"
      PendantType.UNKNOWN -> "Unknown"
    }
}

/**
 * Pendant status information.
 */
data class PendantStatus(
  val address: String,
  val name: String?,
  val type: PendantType,
  val state: PendantConnectionState,
  val batteryLevel: Int?,
  val isStreaming: Boolean,
  val audioCodec: PendantAudioCodec?
)
