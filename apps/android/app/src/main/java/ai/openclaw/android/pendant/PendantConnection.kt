package ai.openclaw.android.pendant

import android.Manifest
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import ai.openclaw.android.pendant.codecs.Lc3FrameProcessor
import ai.openclaw.android.pendant.codecs.LimitlessCommandEncoder
import ai.openclaw.android.pendant.codecs.OpusCodec
import ai.openclaw.android.pendant.codecs.OpusFrameExtractor
import ai.openclaw.android.pendant.codecs.PcmUtils
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import kotlin.coroutines.resume

/**
 * BLE connection handler for pendant devices.
 *
 * Manages GATT connection, service discovery, and audio streaming
 * for both Friend and Limitless pendants.
 */
class PendantConnection(
  private val context: Context,
  private val scope: CoroutineScope,
  private val pendant: DiscoveredPendant,
  private val onAudioData: ((ByteArray) -> Unit)? = null,
  private val onConnectionStateChanged: ((PendantConnectionState) -> Unit)? = null
) {
  companion object {
    private const val TAG = "PendantConnection"
    private const val CONNECT_TIMEOUT_MS = 15_000L
    private const val SERVICE_DISCOVERY_TIMEOUT_MS = 10_000L

    // Standard CCCD UUID for enabling notifications
    private val CCCD_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
  }

  private val bluetoothManager: BluetoothManager? =
    context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager

  private var bluetoothGatt: BluetoothGatt? = null
  private var audioCharacteristic: BluetoothGattCharacteristic? = null
  private var txCharacteristic: BluetoothGattCharacteristic? = null

  private val _state = MutableStateFlow(PendantConnectionState.DISCONNECTED)
  val state: StateFlow<PendantConnectionState> = _state.asStateFlow()

  private val _batteryLevel = MutableStateFlow<Int?>(null)
  val batteryLevel: StateFlow<Int?> = _batteryLevel.asStateFlow()

  private val _isStreaming = MutableStateFlow(false)
  val isStreaming: StateFlow<Boolean> = _isStreaming.asStateFlow()

  // Audio processing
  private val lc3Processor = Lc3FrameProcessor()
  private val opusCodec = OpusCodec()
  private val opusExtractor = OpusFrameExtractor()
  private val limitlessEncoder = LimitlessCommandEncoder()

  // Limitless-specific state
  private val rawDataBuffer = mutableListOf<Byte>()
  private var limitlessInitialized = false
  private var highestReceivedIndex = -1
  private var lastAcknowledgedIndex = -1
  private var extractionJob: Job? = null

  // GATT operation queue (BLE operations must be serialized)
  private val gattOperationQueue = ConcurrentLinkedQueue<GattOperation>()
  private var isGattOperationPending = false

  private sealed class GattOperation {
    data class WriteCharacteristic(
      val characteristic: BluetoothGattCharacteristic,
      val data: ByteArray
    ) : GattOperation()

    data class ReadCharacteristic(
      val characteristic: BluetoothGattCharacteristic
    ) : GattOperation()

    data class WriteDescriptor(
      val descriptor: BluetoothGattDescriptor,
      val data: ByteArray
    ) : GattOperation()
  }

  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      when (newState) {
        BluetoothProfile.STATE_CONNECTED -> {
          _state.value = PendantConnectionState.CONNECTING
          // Discover services
          try {
            gatt.discoverServices()
          } catch (e: SecurityException) {
            handleDisconnect("Permission denied")
          }
        }
        BluetoothProfile.STATE_DISCONNECTED -> {
          handleDisconnect(if (status == BluetoothGatt.GATT_SUCCESS) null else "Status: $status")
        }
      }
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      if (status != BluetoothGatt.GATT_SUCCESS) {
        handleDisconnect("Service discovery failed")
        return
      }

      scope.launch(Dispatchers.Main) {
        setupPendant(gatt)
      }
    }

    override fun onCharacteristicChanged(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      value: ByteArray
    ) {
      handleCharacteristicData(characteristic.uuid, value)
    }

    @Deprecated("Deprecated in API 33")
    override fun onCharacteristicChanged(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic
    ) {
      characteristic.value?.let { value ->
        handleCharacteristicData(characteristic.uuid, value)
      }
    }

    override fun onCharacteristicRead(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      value: ByteArray,
      status: Int
    ) {
      processNextGattOperation()
      if (status == BluetoothGatt.GATT_SUCCESS) {
        handleCharacteristicRead(characteristic.uuid, value)
      }
    }

    @Deprecated("Deprecated in API 33")
    override fun onCharacteristicRead(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      status: Int
    ) {
      processNextGattOperation()
      if (status == BluetoothGatt.GATT_SUCCESS) {
        characteristic.value?.let { value ->
          handleCharacteristicRead(characteristic.uuid, value)
        }
      }
    }

    override fun onCharacteristicWrite(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      status: Int
    ) {
      processNextGattOperation()
    }

    override fun onDescriptorWrite(
      gatt: BluetoothGatt,
      descriptor: BluetoothGattDescriptor,
      status: Int
    ) {
      processNextGattOperation()
    }
  }

  /**
   * Connect to the pendant device.
   */
  suspend fun connect(): Boolean {
    if (_state.value != PendantConnectionState.DISCONNECTED) {
      return false
    }

    if (!hasRequiredPermissions()) {
      _state.value = PendantConnectionState.ERROR
      return false
    }

    _state.value = PendantConnectionState.CONNECTING
    onConnectionStateChanged?.invoke(PendantConnectionState.CONNECTING)

    val device = getBluetoothDevice() ?: run {
      _state.value = PendantConnectionState.ERROR
      return false
    }

    return try {
      withTimeout(CONNECT_TIMEOUT_MS) {
        connectGatt(device)
      }
    } catch (e: Exception) {
      _state.value = PendantConnectionState.ERROR
      false
    }
  }

  private suspend fun connectGatt(device: BluetoothDevice): Boolean =
    suspendCancellableCoroutine { continuation ->
      try {
        bluetoothGatt = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
        } else {
          @Suppress("DEPRECATION")
          device.connectGatt(context, false, gattCallback)
        }

        if (bluetoothGatt == null) {
          continuation.resume(false)
        }
        // Connection result will be delivered via callback
        // For now, return true and let state flow handle actual status
        continuation.resume(true)
      } catch (e: SecurityException) {
        continuation.resume(false)
      }
    }

  private suspend fun setupPendant(gatt: BluetoothGatt) {
    when (pendant.type) {
      PendantType.FRIEND -> setupFriendPendant(gatt)
      PendantType.LIMITLESS -> setupLimitlessPendant(gatt)
      PendantType.UNKNOWN -> {
        // Try to detect type from available services
        val hasFriend = gatt.getService(PendantProtocol.FRIEND_SERVICE_UUID) != null
        val hasLimitless = gatt.getService(PendantProtocol.LIMITLESS_SERVICE_UUID) != null

        when {
          hasFriend -> setupFriendPendant(gatt)
          hasLimitless -> setupLimitlessPendant(gatt)
          else -> handleDisconnect("Unknown pendant type")
        }
      }
    }
  }

  private suspend fun setupFriendPendant(gatt: BluetoothGatt) {
    val service = gatt.getService(PendantProtocol.FRIEND_SERVICE_UUID)
    if (service == null) {
      handleDisconnect("Friend service not found")
      return
    }

    val audioChar = service.getCharacteristic(PendantProtocol.FRIEND_AUDIO_CHARACTERISTIC_UUID)
    if (audioChar == null) {
      handleDisconnect("Audio characteristic not found")
      return
    }

    audioCharacteristic = audioChar

    // Enable notifications for audio
    if (!enableNotifications(gatt, audioChar)) {
      handleDisconnect("Failed to enable audio notifications")
      return
    }

    // Read battery level if available
    readBatteryLevel(gatt)

    _state.value = PendantConnectionState.CONNECTED
    onConnectionStateChanged?.invoke(PendantConnectionState.CONNECTED)
  }

  private suspend fun setupLimitlessPendant(gatt: BluetoothGatt) {
    val service = gatt.getService(PendantProtocol.LIMITLESS_SERVICE_UUID)
    if (service == null) {
      handleDisconnect("Limitless service not found")
      return
    }

    val rxChar = service.getCharacteristic(PendantProtocol.LIMITLESS_RX_CHARACTERISTIC_UUID)
    val txChar = service.getCharacteristic(PendantProtocol.LIMITLESS_TX_CHARACTERISTIC_UUID)

    if (rxChar == null || txChar == null) {
      handleDisconnect("Limitless characteristics not found")
      return
    }

    audioCharacteristic = rxChar
    txCharacteristic = txChar

    // Enable notifications for RX
    if (!enableNotifications(gatt, rxChar)) {
      handleDisconnect("Failed to enable notifications")
      return
    }

    delay(1000) // Wait for connection to stabilize

    // Initialize Limitless: time sync
    val timeSyncCmd = limitlessEncoder.encodeSetCurrentTime(System.currentTimeMillis())
    writeCharacteristic(txChar, timeSyncCmd)
    delay(1000)

    // Enable data streaming
    val enableCmd = limitlessEncoder.encodeEnableDataStream(true)
    writeCharacteristic(txChar, enableCmd)
    delay(1000)

    limitlessInitialized = true

    // Start extraction timer for Opus frames
    startLimitlessExtraction()

    // Read battery level
    readBatteryLevel(gatt)

    _state.value = PendantConnectionState.CONNECTED
    onConnectionStateChanged?.invoke(PendantConnectionState.CONNECTED)
  }

  private fun enableNotifications(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic): Boolean {
    try {
      gatt.setCharacteristicNotification(characteristic, true)

      val descriptor = characteristic.getDescriptor(CCCD_UUID) ?: return false
      val value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        gatt.writeDescriptor(descriptor, value)
      } else {
        @Suppress("DEPRECATION")
        descriptor.value = value
        @Suppress("DEPRECATION")
        gatt.writeDescriptor(descriptor)
      }

      return true
    } catch (e: SecurityException) {
      return false
    }
  }

  private fun readBatteryLevel(gatt: BluetoothGatt) {
    val batteryService = gatt.getService(PendantProtocol.BATTERY_SERVICE_UUID) ?: return
    val batteryChar = batteryService.getCharacteristic(
      PendantProtocol.BATTERY_LEVEL_CHARACTERISTIC_UUID
    ) ?: return

    queueGattOperation(GattOperation.ReadCharacteristic(batteryChar))
  }

  private fun writeCharacteristic(characteristic: BluetoothGattCharacteristic, data: ByteArray) {
    queueGattOperation(GattOperation.WriteCharacteristic(characteristic, data))
  }

  private fun queueGattOperation(operation: GattOperation) {
    gattOperationQueue.add(operation)
    if (!isGattOperationPending) {
      processNextGattOperation()
    }
  }

  private fun processNextGattOperation() {
    val operation = gattOperationQueue.poll()
    if (operation == null) {
      isGattOperationPending = false
      return
    }

    isGattOperationPending = true
    val gatt = bluetoothGatt ?: return

    try {
      when (operation) {
        is GattOperation.WriteCharacteristic -> {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            gatt.writeCharacteristic(
              operation.characteristic,
              operation.data,
              BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
            )
          } else {
            @Suppress("DEPRECATION")
            operation.characteristic.value = operation.data
            @Suppress("DEPRECATION")
            gatt.writeCharacteristic(operation.characteristic)
          }
        }
        is GattOperation.ReadCharacteristic -> {
          gatt.readCharacteristic(operation.characteristic)
        }
        is GattOperation.WriteDescriptor -> {
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            gatt.writeDescriptor(operation.descriptor, operation.data)
          } else {
            @Suppress("DEPRECATION")
            operation.descriptor.value = operation.data
            @Suppress("DEPRECATION")
            gatt.writeDescriptor(operation.descriptor)
          }
        }
      }
    } catch (e: SecurityException) {
      processNextGattOperation()
    }
  }

  private fun handleCharacteristicData(uuid: UUID, data: ByteArray) {
    when (pendant.type) {
      PendantType.FRIEND -> handleFriendAudioData(data)
      PendantType.LIMITLESS -> handleLimitlessData(data)
      else -> {}
    }
  }

  private fun handleFriendAudioData(data: ByteArray) {
    if (!_isStreaming.value) {
      _isStreaming.value = true
      _state.value = PendantConnectionState.STREAMING
      onConnectionStateChanged?.invoke(PendantConnectionState.STREAMING)
    }

    // Process LC3 packet
    val pcmSamples = lc3Processor.processPacket(data) ?: return
    val pcmBytes = PcmUtils.shortArrayToByteArray(pcmSamples)
    onAudioData?.invoke(pcmBytes)
  }

  private fun handleLimitlessData(data: ByteArray) {
    // Check for packet index (protobuf field 1)
    if (data.size > 2 && data[0].toInt() and 0xFF == 0x08) {
      val index = decodeVarint(data, 1).first
      if (index > highestReceivedIndex) {
        highestReceivedIndex = index
      }
    }

    // Accumulate data
    rawDataBuffer.addAll(data.toList())
  }

  private fun startLimitlessExtraction() {
    extractionJob = scope.launch(Dispatchers.Default) {
      while (limitlessInitialized) {
        delay(500) // Extract every 500ms

        if (rawDataBuffer.isEmpty()) continue

        val bufferSnapshot = rawDataBuffer.toByteArray()
        val (frames, remainingStart) = opusExtractor.extractFrames(bufferSnapshot)

        if (frames.isNotEmpty()) {
          if (!_isStreaming.value) {
            _isStreaming.value = true
            _state.value = PendantConnectionState.STREAMING
            onConnectionStateChanged?.invoke(PendantConnectionState.STREAMING)
          }

          // Decode each Opus frame
          for (frame in frames) {
            try {
              val pcmSamples = opusCodec.decode(frame)
              val pcmBytes = PcmUtils.shortArrayToByteArray(pcmSamples)
              onAudioData?.invoke(pcmBytes)
            } catch (e: Exception) {
              // Skip bad frame
            }
          }
        }

        // Update buffer
        if (remainingStart > 0) {
          val remaining = bufferSnapshot.drop(remainingStart)
          rawDataBuffer.clear()
          rawDataBuffer.addAll(remaining)
        } else if (frames.isNotEmpty()) {
          rawDataBuffer.clear()
        }

        // Prevent buffer overflow
        if (rawDataBuffer.size > 65536) {
          rawDataBuffer.clear()
        }

        // Send acknowledgment
        if (highestReceivedIndex > lastAcknowledgedIndex && frames.isNotEmpty()) {
          lastAcknowledgedIndex = highestReceivedIndex
          txCharacteristic?.let { tx ->
            val ackCmd = limitlessEncoder.encodeAcknowledgeProcessedData(highestReceivedIndex)
            writeCharacteristic(tx, ackCmd)
          }
        }
      }
    }
  }

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

  private fun handleCharacteristicRead(uuid: UUID, data: ByteArray) {
    if (uuid == PendantProtocol.BATTERY_LEVEL_CHARACTERISTIC_UUID && data.isNotEmpty()) {
      _batteryLevel.value = data[0].toInt() and 0xFF
    }
  }

  private fun handleDisconnect(reason: String?) {
    cleanup()
    _state.value = PendantConnectionState.DISCONNECTED
    onConnectionStateChanged?.invoke(PendantConnectionState.DISCONNECTED)
  }

  /**
   * Disconnect from the pendant.
   */
  fun disconnect() {
    cleanup()
    _state.value = PendantConnectionState.DISCONNECTED
    onConnectionStateChanged?.invoke(PendantConnectionState.DISCONNECTED)
  }

  private fun cleanup() {
    extractionJob?.cancel()
    extractionJob = null
    limitlessInitialized = false
    _isStreaming.value = false
    rawDataBuffer.clear()

    try {
      bluetoothGatt?.disconnect()
      bluetoothGatt?.close()
    } catch (e: SecurityException) {
      // Ignore
    }
    bluetoothGatt = null
    audioCharacteristic = null
    txCharacteristic = null

    lc3Processor.release()
    opusCodec.release()
    limitlessEncoder.reset()

    gattOperationQueue.clear()
    isGattOperationPending = false
  }

  private fun getBluetoothDevice(): BluetoothDevice? {
    return try {
      bluetoothManager?.adapter?.getRemoteDevice(pendant.address)
    } catch (e: Exception) {
      null
    }
  }

  private fun hasRequiredPermissions(): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) ==
        PackageManager.PERMISSION_GRANTED
    } else {
      true
    }
  }

  /**
   * Get current pendant status.
   */
  fun getStatus(): PendantStatus {
    return PendantStatus(
      address = pendant.address,
      name = pendant.name,
      type = pendant.type,
      state = _state.value,
      batteryLevel = _batteryLevel.value,
      isStreaming = _isStreaming.value,
      audioCodec = when (pendant.type) {
        PendantType.FRIEND -> PendantAudioCodec.LC3
        PendantType.LIMITLESS -> PendantAudioCodec.OPUS
        else -> null
      }
    )
  }
}
