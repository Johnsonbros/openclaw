package ai.openclaw.android.pendant

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelUuid
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * BLE discovery manager for pendant devices.
 *
 * Scans for Friend and Limitless pendants using their service UUIDs
 * and device name patterns.
 */
class PendantDiscovery(
  private val context: Context,
  private val scope: CoroutineScope
) {
  companion object {
    private const val TAG = "PendantDiscovery"
    private const val SCAN_TIMEOUT_MS = 30_000L // 30 seconds default scan
    private const val MIN_RSSI = -90 // Ignore very weak signals
  }

  private val bluetoothManager: BluetoothManager? =
    context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager

  private val bluetoothAdapter: BluetoothAdapter? =
    bluetoothManager?.adapter

  private val bleScanner: BluetoothLeScanner?
    get() = bluetoothAdapter?.bluetoothLeScanner

  private val _isScanning = MutableStateFlow(false)
  val isScanning: StateFlow<Boolean> = _isScanning.asStateFlow()

  private val _discoveredPendants = MutableStateFlow<List<DiscoveredPendant>>(emptyList())
  val discoveredPendants: StateFlow<List<DiscoveredPendant>> = _discoveredPendants.asStateFlow()

  private val _statusText = MutableStateFlow("Not scanning")
  val statusText: StateFlow<String> = _statusText.asStateFlow()

  private val _error = MutableStateFlow<String?>(null)
  val error: StateFlow<String?> = _error.asStateFlow()

  private var scanJob: Job? = null
  private val pendantMap = mutableMapOf<String, DiscoveredPendant>()

  private val scanCallback = object : ScanCallback() {
    override fun onScanResult(callbackType: Int, result: ScanResult) {
      processScanResult(result)
    }

    override fun onBatchScanResults(results: List<ScanResult>) {
      results.forEach { processScanResult(it) }
    }

    override fun onScanFailed(errorCode: Int) {
      val errorMessage = when (errorCode) {
        SCAN_FAILED_ALREADY_STARTED -> "Scan already started"
        SCAN_FAILED_APPLICATION_REGISTRATION_FAILED -> "App registration failed"
        SCAN_FAILED_FEATURE_UNSUPPORTED -> "BLE scanning not supported"
        SCAN_FAILED_INTERNAL_ERROR -> "Internal error"
        else -> "Scan failed: $errorCode"
      }
      _error.value = errorMessage
      _statusText.value = errorMessage
      _isScanning.value = false
    }
  }

  /**
   * Start scanning for pendant devices.
   *
   * @param timeoutMs Scan timeout in milliseconds (0 = no timeout)
   * @return True if scan started successfully
   */
  fun startScan(timeoutMs: Long = SCAN_TIMEOUT_MS): Boolean {
    if (_isScanning.value) {
      return true
    }

    if (!hasRequiredPermissions()) {
      _error.value = "Missing Bluetooth permissions"
      _statusText.value = "Permission required"
      return false
    }

    val scanner = bleScanner
    if (scanner == null) {
      _error.value = "Bluetooth not available"
      _statusText.value = "Bluetooth unavailable"
      return false
    }

    if (bluetoothAdapter?.isEnabled != true) {
      _error.value = "Bluetooth is disabled"
      _statusText.value = "Bluetooth disabled"
      return false
    }

    // Clear previous results
    pendantMap.clear()
    _discoveredPendants.value = emptyList()
    _error.value = null

    // Build scan filters for known pendant service UUIDs
    val filters = buildScanFilters()
    val settings = buildScanSettings()

    try {
      scanner.startScan(filters, settings, scanCallback)
      _isScanning.value = true
      _statusText.value = "Scanning for pendants..."

      // Set up timeout
      if (timeoutMs > 0) {
        scanJob = scope.launch(Dispatchers.Main) {
          delay(timeoutMs)
          stopScan()
        }
      }

      return true
    } catch (e: SecurityException) {
      _error.value = "Permission denied"
      _statusText.value = "Permission denied"
      return false
    } catch (e: Exception) {
      _error.value = e.message
      _statusText.value = "Scan error"
      return false
    }
  }

  /**
   * Stop the current scan.
   */
  fun stopScan() {
    scanJob?.cancel()
    scanJob = null

    if (!_isScanning.value) {
      return
    }

    try {
      bleScanner?.stopScan(scanCallback)
    } catch (e: SecurityException) {
      // Ignore - likely permission revoked
    } catch (e: Exception) {
      // Ignore
    }

    _isScanning.value = false
    val count = pendantMap.size
    _statusText.value = if (count > 0) {
      "$count pendant${if (count > 1) "s" else ""} found"
    } else {
      "No pendants found"
    }
  }

  /**
   * Check if Bluetooth and required permissions are available.
   */
  fun isAvailable(): Boolean {
    return bluetoothAdapter != null && hasRequiredPermissions()
  }

  /**
   * Check if Bluetooth is enabled.
   */
  fun isBluetoothEnabled(): Boolean {
    return bluetoothAdapter?.isEnabled == true
  }

  private fun hasRequiredPermissions(): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      // Android 12+ requires BLUETOOTH_SCAN and BLUETOOTH_CONNECT
      ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) ==
        PackageManager.PERMISSION_GRANTED &&
      ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) ==
        PackageManager.PERMISSION_GRANTED
    } else {
      // Pre-Android 12 requires location for BLE scanning
      ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
        PackageManager.PERMISSION_GRANTED
    }
  }

  private fun buildScanFilters(): List<ScanFilter> {
    return listOf(
      // Friend Pendant by service UUID
      ScanFilter.Builder()
        .setServiceUuid(ParcelUuid(PendantProtocol.FRIEND_SERVICE_UUID))
        .build(),

      // Limitless Pendant by service UUID
      ScanFilter.Builder()
        .setServiceUuid(ParcelUuid(PendantProtocol.LIMITLESS_SERVICE_UUID))
        .build(),

      // Also scan for devices with "Friend" in name (some may not advertise service)
      // Note: Name filters are prefix-matched on some Android versions
      // ScanFilter.Builder()
      //   .setDeviceName("Friend")
      //   .build()
    )
  }

  private fun buildScanSettings(): ScanSettings {
    return ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
      .setReportDelay(0) // Immediate results
      .build()
  }

  private fun processScanResult(result: ScanResult) {
    val device = result.device ?: return

    // Check RSSI threshold
    if (result.rssi < MIN_RSSI) {
      return
    }

    val address = device.address ?: return
    val name = try {
      device.name
    } catch (e: SecurityException) {
      null
    }

    // Extract service UUIDs from scan record
    val serviceUuids = result.scanRecord?.serviceUuids
      ?.mapNotNull { it?.uuid }
      ?: emptyList()

    // Determine pendant type
    val type = determinePendantType(name, serviceUuids)

    // Only process known pendant types
    if (type == PendantType.UNKNOWN) {
      // Check if name suggests a pendant
      val nameType = PendantType.fromDeviceName(name)
      if (nameType == PendantType.UNKNOWN) {
        return
      }
    }

    val pendant = DiscoveredPendant(
      address = address,
      name = name,
      type = if (type != PendantType.UNKNOWN) type else PendantType.fromDeviceName(name),
      rssi = result.rssi,
      serviceUuids = serviceUuids
    )

    // Update or add to map
    pendantMap[address] = pendant

    // Update flow with sorted list (strongest signal first)
    _discoveredPendants.value = pendantMap.values
      .sortedByDescending { it.rssi }
      .toList()

    // Update status
    val count = pendantMap.size
    _statusText.value = "Found $count pendant${if (count > 1) "s" else ""}..."
  }

  private fun determinePendantType(name: String?, serviceUuids: List<UUID>): PendantType {
    // Check by service UUID first (most reliable)
    for (uuid in serviceUuids) {
      val type = PendantType.fromServiceUuid(uuid)
      if (type != PendantType.UNKNOWN) {
        return type
      }
    }

    // Fall back to name matching
    return PendantType.fromDeviceName(name)
  }

  /**
   * Get required permissions for BLE scanning.
   */
  fun getRequiredPermissions(): Array<String> {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      arrayOf(
        Manifest.permission.BLUETOOTH_SCAN,
        Manifest.permission.BLUETOOTH_CONNECT
      )
    } else {
      arrayOf(
        Manifest.permission.ACCESS_FINE_LOCATION
      )
    }
  }
}
