package ai.openclaw.android.pendant

import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Singleton manager for pendant device connections.
 *
 * Enforces the "one pendant per user" rule - only one pendant can be
 * connected at a time. Provides a unified interface for discovery,
 * connection, and audio streaming.
 */
class PendantManager(
  private val context: Context,
  private val scope: CoroutineScope
) {
  companion object {
    private const val TAG = "PendantManager"
  }

  // Discovery
  private val discovery = PendantDiscovery(context, scope)
  val discoveredPendants: StateFlow<List<DiscoveredPendant>> = discovery.discoveredPendants
  val isScanning: StateFlow<Boolean> = discovery.isScanning
  val discoveryStatus: StateFlow<String> = discovery.statusText

  // Active connection (only one at a time)
  private var activeConnection: PendantConnection? = null
  private var connectionJob: Job? = null

  // Audio callback for streaming
  private var audioCallback: ((ByteArray) -> Unit)? = null

  // State flows
  private val _activePendant = MutableStateFlow<DiscoveredPendant?>(null)
  val activePendant: StateFlow<DiscoveredPendant?> = _activePendant.asStateFlow()

  private val _connectionState = MutableStateFlow(PendantConnectionState.DISCONNECTED)
  val connectionState: StateFlow<PendantConnectionState> = _connectionState.asStateFlow()

  private val _isStreaming = MutableStateFlow(false)
  val isStreaming: StateFlow<Boolean> = _isStreaming.asStateFlow()

  private val _batteryLevel = MutableStateFlow<Int?>(null)
  val batteryLevel: StateFlow<Int?> = _batteryLevel.asStateFlow()

  private val _statusText = MutableStateFlow("Not connected")
  val statusText: StateFlow<String> = _statusText.asStateFlow()

  /**
   * Start scanning for pendant devices.
   *
   * @param timeoutMs Scan timeout (0 = no timeout)
   * @return True if scan started
   */
  fun startScan(timeoutMs: Long = 30_000L): Boolean {
    return discovery.startScan(timeoutMs)
  }

  /**
   * Stop scanning for pendant devices.
   */
  fun stopScan() {
    discovery.stopScan()
  }

  /**
   * Set callback for receiving audio data.
   *
   * @param callback Called with PCM audio bytes when streaming
   */
  fun setAudioCallback(callback: ((ByteArray) -> Unit)?) {
    audioCallback = callback
  }

  /**
   * Connect to a pendant device.
   *
   * This will disconnect any existing connection first (one pendant rule).
   *
   * @param pendant The pendant to connect to
   * @return True if connection initiated (check connectionState for result)
   */
  fun connect(pendant: DiscoveredPendant): Boolean {
    // Disconnect existing connection first
    disconnectInternal()

    _activePendant.value = pendant
    _connectionState.value = PendantConnectionState.CONNECTING
    _statusText.value = "Connecting to ${pendant.displayName}..."

    connectionJob = scope.launch(Dispatchers.IO) {
      val connection = PendantConnection(
        context = context,
        scope = scope,
        pendant = pendant,
        onAudioData = { data ->
          audioCallback?.invoke(data)
        },
        onConnectionStateChanged = { state ->
          _connectionState.value = state
          updateStatusText(state, pendant)

          if (state == PendantConnectionState.DISCONNECTED ||
              state == PendantConnectionState.ERROR) {
            _activePendant.value = null
            _isStreaming.value = false
            _batteryLevel.value = null
          }
        }
      )

      activeConnection = connection

      val success = connection.connect()
      if (!success) {
        _connectionState.value = PendantConnectionState.ERROR
        _statusText.value = "Failed to connect"
        _activePendant.value = null
        activeConnection = null
      } else {
        // Start observing connection state
        scope.launch {
          connection.isStreaming.collect { streaming ->
            _isStreaming.value = streaming
          }
        }
        scope.launch {
          connection.batteryLevel.collect { level ->
            _batteryLevel.value = level
          }
        }
      }
    }

    return true
  }

  /**
   * Connect to the first discovered pendant.
   *
   * @return True if a pendant was found and connection initiated
   */
  fun connectFirst(): Boolean {
    val pendant = discoveredPendants.value.firstOrNull() ?: return false
    return connect(pendant)
  }

  /**
   * Disconnect from the current pendant.
   */
  fun disconnect() {
    disconnectInternal()
    _statusText.value = "Not connected"
  }

  private fun disconnectInternal() {
    connectionJob?.cancel()
    connectionJob = null

    activeConnection?.disconnect()
    activeConnection = null

    _activePendant.value = null
    _connectionState.value = PendantConnectionState.DISCONNECTED
    _isStreaming.value = false
    _batteryLevel.value = null
  }

  private fun updateStatusText(state: PendantConnectionState, pendant: DiscoveredPendant) {
    _statusText.value = when (state) {
      PendantConnectionState.DISCONNECTED -> "Not connected"
      PendantConnectionState.CONNECTING -> "Connecting to ${pendant.displayName}..."
      PendantConnectionState.CONNECTED -> "Connected to ${pendant.displayName}"
      PendantConnectionState.STREAMING -> "Streaming from ${pendant.displayName}"
      PendantConnectionState.ERROR -> "Connection error"
    }
  }

  /**
   * Get the current pendant status.
   */
  fun getStatus(): PendantStatus? {
    return activeConnection?.getStatus()
  }

  /**
   * Check if Bluetooth is available and enabled.
   */
  fun isBluetoothAvailable(): Boolean {
    return discovery.isAvailable()
  }

  /**
   * Check if Bluetooth is enabled.
   */
  fun isBluetoothEnabled(): Boolean {
    return discovery.isBluetoothEnabled()
  }

  /**
   * Get required permissions for BLE operations.
   */
  fun getRequiredPermissions(): Array<String> {
    return discovery.getRequiredPermissions()
  }

  /**
   * Check if a pendant is currently connected.
   */
  fun isConnected(): Boolean {
    val state = _connectionState.value
    return state == PendantConnectionState.CONNECTED ||
           state == PendantConnectionState.STREAMING
  }

  /**
   * Release all resources.
   */
  fun release() {
    stopScan()
    disconnectInternal()
  }
}
