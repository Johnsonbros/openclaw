package ai.openclaw.android.ble

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.ParcelUuid
import android.util.Log
import androidx.core.content.ContextCompat
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull

/**
 * BLE manager for Omi DevKit2 and Limitless pendants.
 * Handles scanning, connection, GATT service discovery, and audio data notifications.
 */
class PendantBleManager(
  private val context: Context,
  private val scope: CoroutineScope,
) {
  companion object {
    private const val TAG = "PendantBLE"

    // Limitless pendant UUIDs
    val LIMITLESS_SERVICE: UUID = UUID.fromString("632de001-604c-446b-a80f-7963e950f3fb")
    val LIMITLESS_TX: UUID = UUID.fromString("632de002-604c-446b-a80f-7963e950f3fb")
    val LIMITLESS_RX: UUID = UUID.fromString("632de003-604c-446b-a80f-7963e950f3fb")

    // Omi DevKit2 (Friend) UUIDs
    val OMI_SERVICE: UUID = UUID.fromString("19b10000-e8f2-537e-4f6c-d104768a1214")
    val OMI_AUDIO: UUID = UUID.fromString("19b10001-e8f2-537e-4f6c-d104768a1214")
    val OMI_CODEC: UUID = UUID.fromString("19b10002-e8f2-537e-4f6c-d104768a1214")

    // MimicLaw DOT (ESP32-S3) UUIDs
    val DOT_SERVICE: UUID = UUID.fromString("d0700001-e8f2-537e-4f6c-d104768a1214")
    val DOT_AUDIO: UUID = UUID.fromString("d0700002-e8f2-537e-4f6c-d104768a1214")
    val DOT_DISPLAY: UUID = UUID.fromString("d0700003-e8f2-537e-4f6c-d104768a1214")

    // CCCD for enabling notifications
    private val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    private const val SCAN_TIMEOUT_MS = 15_000L
    private const val RECONNECT_DELAY_MS = 3_000L
    private const val MAX_RECONNECT_ATTEMPTS = 10
  }

  enum class ConnectionState { DISCONNECTED, SCANNING, CONNECTING, CONNECTED }
  enum class PendantType { OMI, LIMITLESS, DOT, UNKNOWN }

  data class PendantInfo(
    val name: String,
    val address: String,
    val type: PendantType,
    val rssi: Int = 0,
  )

  private val bluetoothManager =
    context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
  private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager?.adapter

  private val _connectionState = MutableStateFlow(ConnectionState.DISCONNECTED)
  val connectionState: StateFlow<ConnectionState> = _connectionState

  private val _connectedPendant = MutableStateFlow<PendantInfo?>(null)
  val connectedPendant: StateFlow<PendantInfo?> = _connectedPendant

  private val _discoveredPendants = MutableStateFlow<List<PendantInfo>>(emptyList())
  val discoveredPendants: StateFlow<List<PendantInfo>> = _discoveredPendants

  private val _audioData = MutableSharedFlow<ByteArray>(extraBufferCapacity = 64)
  val audioData: SharedFlow<ByteArray> = _audioData

  enum class PendantCodec(val id: Int) {
    PCM8(0), PCM16(1), OPUS(10), LC3(20), UNKNOWN(-1);
    companion object {
      fun fromByte(value: Int): PendantCodec = entries.firstOrNull { it.id == value } ?: UNKNOWN
    }
  }

  private val _codec = MutableStateFlow(PendantCodec.UNKNOWN)
  val codec: StateFlow<PendantCodec> = _codec

  private var gatt: BluetoothGatt? = null
  private var scanJob: Job? = null
  private var reconnectJob: Job? = null
  private var reconnectAttempts = 0
  private var shouldAutoReconnect = false
  private var lastConnectedAddress: String? = null
  private var connectedType: PendantType = PendantType.UNKNOWN

  // GATT write/descriptor completion signaling (serialized via gattWriteMutex)
  private val gattWriteMutex = Mutex()
  @Volatile private var pendingWrite: CompletableDeferred<Boolean>? = null
  @Volatile private var pendingDescriptorWrite: CompletableDeferred<Boolean>? = null

  private val prefs by lazy {
    context.getSharedPreferences("pendant_ble", Context.MODE_PRIVATE)
  }

  val lastPairedAddress: String?
    get() = prefs.getString("last_paired_address", null)

  private fun hasBlePermissions(): Boolean {
    return if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
      ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED
    } else {
      // Pre-Android 12: legacy BLUETOOTH permission is normal (auto-granted), but
      // ACCESS_FINE_LOCATION is required at runtime for BLE scanning
      ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }
  }

  @SuppressLint("MissingPermission")
  fun startScan() {
    if (!hasBlePermissions()) {
      Log.w(TAG, "Missing BLE permissions")
      return
    }
    val adapter = bluetoothAdapter ?: run {
      Log.w(TAG, "Bluetooth not available")
      return
    }
    if (!adapter.isEnabled) {
      Log.w(TAG, "Bluetooth not enabled")
      return
    }

    stopScan()
    _connectionState.value = ConnectionState.SCANNING
    _discoveredPendants.value = emptyList()

    val filters = listOf(
      ScanFilter.Builder().setServiceUuid(ParcelUuid(LIMITLESS_SERVICE)).build(),
      ScanFilter.Builder().setServiceUuid(ParcelUuid(OMI_SERVICE)).build(),
      ScanFilter.Builder().setServiceUuid(ParcelUuid(DOT_SERVICE)).build(),
    )
    val settings = ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
      .build()

    adapter.bluetoothLeScanner?.startScan(filters, settings, scanCallback)
    Log.d(TAG, "BLE scan started")

    scanJob = scope.launch {
      delay(SCAN_TIMEOUT_MS)
      stopScan()
    }
  }

  @SuppressLint("MissingPermission")
  fun stopScan() {
    scanJob?.cancel()
    scanJob = null
    if (hasBlePermissions()) {
      bluetoothAdapter?.bluetoothLeScanner?.stopScan(scanCallback)
    }
    if (_connectionState.value == ConnectionState.SCANNING) {
      _connectionState.value = ConnectionState.DISCONNECTED
    }
  }

  @SuppressLint("MissingPermission")
  fun connect(address: String) {
    if (!hasBlePermissions()) return
    val adapter = bluetoothAdapter ?: return
    stopScan()

    _connectionState.value = ConnectionState.CONNECTING
    shouldAutoReconnect = true
    lastConnectedAddress = address
    reconnectAttempts = 0

    val device = adapter.getRemoteDevice(address)
    gatt = device.connectGatt(context, false, gattCallback, BluetoothDevice.TRANSPORT_LE)
    Log.d(TAG, "Connecting to $address")
  }

  @SuppressLint("MissingPermission")
  fun disconnect() {
    shouldAutoReconnect = false
    reconnectJob?.cancel()
    reconnectJob = null
    gatt?.let { g ->
      if (hasBlePermissions()) {
        g.disconnect()
        g.close()
      }
    }
    gatt = null
    _connectionState.value = ConnectionState.DISCONNECTED
    _connectedPendant.value = null
    connectedType = PendantType.UNKNOWN
    Log.d(TAG, "Disconnected")
  }

  fun autoConnectLastPaired() {
    val address = lastPairedAddress ?: return
    if (_connectionState.value != ConnectionState.DISCONNECTED) return
    Log.d(TAG, "Auto-connecting to last paired: $address")
    connect(address)
  }

  private val scanCallback = object : ScanCallback() {
    @SuppressLint("MissingPermission")
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      val device = result.device
      val name = if (hasBlePermissions()) device.name else null
      val address = device.address
      val uuids = result.scanRecord?.serviceUuids?.map { it.uuid } ?: emptyList()

      val type = when {
        uuids.contains(DOT_SERVICE) -> PendantType.DOT
        uuids.contains(OMI_SERVICE) -> PendantType.OMI
        uuids.contains(LIMITLESS_SERVICE) -> PendantType.LIMITLESS
        else -> PendantType.UNKNOWN
      }

      val info = PendantInfo(
        name = name ?: "Unknown Pendant",
        address = address,
        type = type,
        rssi = result.rssi,
      )

      val current = _discoveredPendants.value.toMutableList()
      val idx = current.indexOfFirst { it.address == address }
      if (idx >= 0) {
        current[idx] = info
      } else {
        current.add(info)
      }
      _discoveredPendants.value = current
      Log.d(TAG, "Discovered: ${info.name} (${info.type}) ${info.address} RSSI=${info.rssi}")
    }

    override fun onScanFailed(errorCode: Int) {
      Log.e(TAG, "Scan failed: $errorCode")
      _connectionState.value = ConnectionState.DISCONNECTED
    }
  }

  @SuppressLint("MissingPermission")
  private val gattCallback = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
      when (newState) {
        BluetoothProfile.STATE_CONNECTED -> {
          Log.d(TAG, "GATT connected, discovering services")
          _connectionState.value = ConnectionState.CONNECTING
          reconnectAttempts = 0
          if (hasBlePermissions()) {
            gatt.discoverServices()
          }
        }
        BluetoothProfile.STATE_DISCONNECTED -> {
          Log.d(TAG, "GATT disconnected status=$status")
          _connectionState.value = ConnectionState.DISCONNECTED
          _connectedPendant.value = null
          if (hasBlePermissions()) {
            gatt.close()
          }
          this@PendantBleManager.gatt = null
          if (shouldAutoReconnect) {
            scheduleReconnect()
          }
        }
      }
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
      if (status != BluetoothGatt.GATT_SUCCESS) {
        Log.e(TAG, "Service discovery failed: $status")
        return
      }
      Log.d(TAG, "Services discovered")

      val dotService = gatt.getService(DOT_SERVICE)
      val omiService = gatt.getService(OMI_SERVICE)
      val limitlessService = gatt.getService(LIMITLESS_SERVICE)

      when {
        dotService != null -> {
          connectedType = PendantType.DOT
          setupDot(gatt, dotService)
        }
        omiService != null -> {
          connectedType = PendantType.OMI
          setupOmi(gatt, omiService)
        }
        limitlessService != null -> {
          connectedType = PendantType.LIMITLESS
          setupLimitless(gatt, limitlessService)
        }
        else -> {
          Log.w(TAG, "No known pendant service found")
          return
        }
      }

      val deviceName = if (hasBlePermissions()) gatt.device.name else null
      _connectedPendant.value = PendantInfo(
        name = deviceName ?: "Pendant",
        address = gatt.device.address,
        type = connectedType,
      )
      _connectionState.value = ConnectionState.CONNECTED
      prefs.edit().putString("last_paired_address", gatt.device.address).apply()
      Log.d(TAG, "Connected: ${_connectedPendant.value}")
    }

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onCharacteristicChanged(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
    ) {
      val data = characteristic.value ?: return
      handleNotification(characteristic.uuid, data)
    }

    override fun onCharacteristicChanged(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      value: ByteArray,
    ) {
      handleNotification(characteristic.uuid, value)
    }

    override fun onDescriptorWrite(
      gatt: BluetoothGatt,
      descriptor: BluetoothGattDescriptor,
      status: Int,
    ) {
      val ok = status == BluetoothGatt.GATT_SUCCESS
      if (!ok) Log.w(TAG, "Descriptor write failed status=$status")
      pendingDescriptorWrite?.complete(ok)
      pendingDescriptorWrite = null
    }

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onCharacteristicWrite(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      status: Int,
    ) {
      val ok = status == BluetoothGatt.GATT_SUCCESS
      if (!ok) Log.w(TAG, "Characteristic write failed status=$status uuid=${characteristic.uuid}")
      pendingWrite?.complete(ok)
      pendingWrite = null
    }

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onCharacteristicRead(
      gatt: BluetoothGatt,
      characteristic: BluetoothGattCharacteristic,
      status: Int,
    ) {
      if (status != BluetoothGatt.GATT_SUCCESS) {
        Log.w(TAG, "Characteristic read failed status=$status")
        return
      }
      if (characteristic.uuid == OMI_CODEC) {
        val value = characteristic.value
        if (value != null && value.isNotEmpty()) {
          val codec = PendantCodec.fromByte(value[0].toInt() and 0xFF)
          _codec.value = codec
          Log.d(TAG, "Omi codec: $codec (raw=${value[0].toInt() and 0xFF})")
        }
      }
    }
  }

  private fun handleNotification(uuid: UUID, data: ByteArray) {
    when (uuid) {
      OMI_AUDIO, LIMITLESS_RX, DOT_AUDIO -> {
        _audioData.tryEmit(data)
      }
    }
  }

  @SuppressLint("MissingPermission")
  private fun setupDot(
    gatt: BluetoothGatt,
    service: android.bluetooth.BluetoothGattService,
  ) {
    val audioChar = service.getCharacteristic(DOT_AUDIO) ?: run {
      Log.w(TAG, "DOT audio characteristic not found")
      return
    }
    enableNotifications(gatt, audioChar)
    _codec.value = PendantCodec.PCM16
    Log.d(TAG, "MimicLaw DOT setup complete")
  }

  @SuppressLint("MissingPermission")
  private fun setupOmi(
    gatt: BluetoothGatt,
    service: android.bluetooth.BluetoothGattService,
  ) {
    val audioChar = service.getCharacteristic(OMI_AUDIO) ?: run {
      Log.w(TAG, "Omi audio characteristic not found")
      return
    }
    enableNotifications(gatt, audioChar)

    // Read codec characteristic to determine audio format
    val codecChar = service.getCharacteristic(OMI_CODEC)
    if (codecChar != null && hasBlePermissions()) {
      gatt.readCharacteristic(codecChar)
    }
    Log.d(TAG, "Omi setup complete")
  }

  @SuppressLint("MissingPermission")
  private fun setupLimitless(
    gatt: BluetoothGatt,
    service: android.bluetooth.BluetoothGattService,
  ) {
    val rxChar = service.getCharacteristic(LIMITLESS_RX) ?: run {
      Log.w(TAG, "Limitless RX characteristic not found")
      return
    }
    val txChar = service.getCharacteristic(LIMITLESS_TX)

    // Queue all GATT writes sequentially using callbacks
    scope.launch(Dispatchers.IO) {
      // 1. Enable RX notifications (writes CCCD descriptor)
      val notifyOk = enableNotificationsAsync(gatt, rxChar)
      if (!notifyOk) {
        Log.w(TAG, "Failed to enable Limitless RX notifications")
        return@launch
      }

      // 2. Write time sync + enable stream to TX
      if (txChar != null) {
        writeLimitlessTimeSyncAndEnable(gatt, txChar)
      }
      Log.d(TAG, "Limitless setup complete")
    }
  }

  @SuppressLint("MissingPermission")
  private suspend fun writeLimitlessTimeSyncAndEnable(
    gatt: BluetoothGatt,
    txChar: BluetoothGattCharacteristic,
  ) {
    if (!hasBlePermissions()) return

    // Time sync: command byte 0x01 + unix timestamp as 4 bytes big-endian
    val now = (System.currentTimeMillis() / 1000).toInt()
    val timeSync = byteArrayOf(
      0x01,
      (now shr 24).toByte(),
      (now shr 16).toByte(),
      (now shr 8).toByte(),
      now.toByte(),
    )
    if (!writeCharacteristicAsync(gatt, txChar, timeSync)) {
      Log.w(TAG, "Limitless time sync write failed")
      return
    }
    Log.d(TAG, "Limitless time sync written")

    // Enable audio stream: command byte 0x02
    if (!writeCharacteristicAsync(gatt, txChar, byteArrayOf(0x02))) {
      Log.w(TAG, "Limitless enable stream write failed")
      return
    }
    Log.d(TAG, "Limitless stream enabled")
  }

  /** Write a characteristic and suspend until the GATT callback confirms completion. */
  @SuppressLint("MissingPermission")
  private suspend fun writeCharacteristicAsync(
    gatt: BluetoothGatt,
    characteristic: BluetoothGattCharacteristic,
    value: ByteArray,
  ): Boolean = gattWriteMutex.withLock {
    if (!hasBlePermissions()) return false
    val deferred = CompletableDeferred<Boolean>()
    pendingWrite = deferred
    @Suppress("DEPRECATION")
    characteristic.value = value
    @Suppress("DEPRECATION")
    gatt.writeCharacteristic(characteristic)
    withTimeoutOrNull(5_000) { deferred.await() } ?: false
  }

  /** Enable notifications and suspend until the CCCD descriptor write callback fires. */
  @SuppressLint("MissingPermission")
  private suspend fun enableNotificationsAsync(
    gatt: BluetoothGatt,
    characteristic: BluetoothGattCharacteristic,
  ): Boolean = gattWriteMutex.withLock {
    if (!hasBlePermissions()) return false
    gatt.setCharacteristicNotification(characteristic, true)
    val descriptor = characteristic.getDescriptor(CCCD) ?: run {
      Log.w(TAG, "CCCD not found for ${characteristic.uuid}")
      return false
    }
    val deferred = CompletableDeferred<Boolean>()
    pendingDescriptorWrite = deferred
    @Suppress("DEPRECATION")
    descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
    @Suppress("DEPRECATION")
    gatt.writeDescriptor(descriptor)
    Log.d(TAG, "Notifications enabling for ${characteristic.uuid}")
    withTimeoutOrNull(5_000) { deferred.await() } ?: false
  }

  /** Fire-and-forget notification enable (for Omi where we read codec after). */
  @SuppressLint("MissingPermission")
  private fun enableNotifications(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
    if (!hasBlePermissions()) return
    gatt.setCharacteristicNotification(characteristic, true)
    val descriptor = characteristic.getDescriptor(CCCD)
    if (descriptor != null) {
      @Suppress("DEPRECATION")
      descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
      @Suppress("DEPRECATION")
      gatt.writeDescriptor(descriptor)
      Log.d(TAG, "Notifications enabled for ${characteristic.uuid}")
    }
  }

  private fun scheduleReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      Log.w(TAG, "Max reconnect attempts reached")
      shouldAutoReconnect = false
      return
    }
    reconnectJob?.cancel()
    reconnectJob = scope.launch {
      val delayMs = RECONNECT_DELAY_MS * (reconnectAttempts + 1)
      Log.d(TAG, "Reconnecting in ${delayMs}ms (attempt ${reconnectAttempts + 1})")
      delay(delayMs)
      reconnectAttempts++
      lastConnectedAddress?.let { connect(it) }
    }
  }
}
