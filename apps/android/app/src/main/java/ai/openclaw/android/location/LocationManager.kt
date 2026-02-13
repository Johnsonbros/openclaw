package ai.openclaw.android.location

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Saved location data for geofencing.
 *
 * @property id Unique identifier for this location
 * @property name Human-readable name (e.g., "Home", "Work")
 * @property latitude Latitude coordinate
 * @property longitude Longitude coordinate
 * @property radiusMeters Geofence radius in meters
 * @property address Optional human-readable address
 * @property starred Whether this is a favorite location
 */
@Serializable
data class SavedLocation(
  val id: String,
  val name: String,
  val latitude: Double,
  val longitude: Double,
  val radiusMeters: Float = 100f,
  val address: String? = null,
  val starred: Boolean = false
)

/**
 * Geofence event types.
 */
enum class GeofenceEventType {
  ENTER,
  EXIT,
  DWELL
}

/**
 * Geofence event data emitted when user enters/exits a location.
 *
 * @property locationId The saved location ID that triggered
 * @property locationName The location name
 * @property eventType Whether user entered or exited
 * @property timestamp When the event occurred (epoch millis)
 */
@Serializable
data class GeofenceEvent(
  val locationId: String,
  val locationName: String,
  val eventType: GeofenceEventType,
  val timestamp: Long = System.currentTimeMillis()
)

/**
 * Callback interface for geofence events.
 */
interface GeofenceCallback {
  /**
   * Called when a geofence transition occurs.
   *
   * @param event The geofence event details
   */
  fun onGeofenceEvent(event: GeofenceEvent)
}

/**
 * Manager for location-based geofencing.
 *
 * Handles registration and monitoring of geofences for saved locations.
 * Uses Google Play Services Location API for efficient geofence monitoring.
 *
 * ## Usage
 *
 * ```kotlin
 * val locationManager = LocationManager(context, scope)
 *
 * // Set callback for events
 * locationManager.setCallback(object : GeofenceCallback {
 *   override fun onGeofenceEvent(event: GeofenceEvent) {
 *     // Handle enter/exit event
 *   }
 * })
 *
 * // Register a geofence
 * locationManager.registerGeofence(SavedLocation(
 *   id = "home_123",
 *   name = "Home",
 *   latitude = 37.7749,
 *   longitude = -122.4194,
 *   radiusMeters = 100f
 * ))
 * ```
 *
 * ## Permissions Required
 *
 * - `ACCESS_FINE_LOCATION` - For precise geofencing
 * - `ACCESS_BACKGROUND_LOCATION` - For geofencing when app is in background (Android 10+)
 *
 * @param context Application context
 * @param scope Coroutine scope for async operations
 */
class LocationManager(
  private val context: Context,
  private val scope: CoroutineScope
) {
  companion object {
    private const val TAG = "LocationManager"

    /** Default geofence radius in meters */
    const val DEFAULT_RADIUS_METERS = 100f

    /** Minimum geofence radius supported by Android */
    const val MIN_RADIUS_METERS = 10f

    /** Maximum number of geofences that can be registered */
    const val MAX_GEOFENCES = 100

    /** Loitering delay for DWELL transition (ms) */
    const val DWELL_DELAY_MS = 60_000 // 1 minute

    /** Geofence expiration - never expire */
    const val GEOFENCE_EXPIRATION_MS = Geofence.NEVER_EXPIRE
  }

  private val geofencingClient: GeofencingClient = LocationServices.getGeofencingClient(context)
  private val json = Json { ignoreUnknownKeys = true }

  // Registered geofences
  private val _registeredLocations = MutableStateFlow<Map<String, SavedLocation>>(emptyMap())
  val registeredLocations: StateFlow<Map<String, SavedLocation>> = _registeredLocations.asStateFlow()

  // Status
  private val _status = MutableStateFlow("Not initialized")
  val status: StateFlow<String> = _status.asStateFlow()

  // Callback for geofence events
  private var callback: GeofenceCallback? = null

  // Pending intent for geofence transitions
  private val geofencePendingIntent: PendingIntent by lazy {
    val intent = Intent(context, GeofenceBroadcastReceiver::class.java)
    PendingIntent.getBroadcast(
      context,
      0,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  /**
   * Set the callback for geofence events.
   *
   * @param callback Callback to receive events, or null to clear
   */
  fun setCallback(callback: GeofenceCallback?) {
    this.callback = callback
  }

  /**
   * Get the current geofence callback.
   */
  fun getCallback(): GeofenceCallback? = callback

  /**
   * Check if location permissions are granted.
   *
   * @return true if both fine and background location permissions are granted
   */
  fun hasLocationPermissions(): Boolean {
    val hasFineLocation = ContextCompat.checkSelfPermission(
      context,
      Manifest.permission.ACCESS_FINE_LOCATION
    ) == PackageManager.PERMISSION_GRANTED

    val hasBackgroundLocation = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.ACCESS_BACKGROUND_LOCATION
      ) == PackageManager.PERMISSION_GRANTED
    } else {
      true // Not needed before Android 10
    }

    return hasFineLocation && hasBackgroundLocation
  }

  /**
   * Get the list of permissions required for geofencing.
   *
   * @return Array of permission strings
   */
  fun getRequiredPermissions(): Array<String> {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      arrayOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
        Manifest.permission.ACCESS_BACKGROUND_LOCATION
      )
    } else {
      arrayOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION
      )
    }
  }

  /**
   * Register a geofence for a saved location.
   *
   * @param location The location to register
   * @return true if registration was successful
   */
  @SuppressLint("MissingPermission")
  suspend fun registerGeofence(location: SavedLocation): Boolean {
    if (!hasLocationPermissions()) {
      Log.e(TAG, "Missing location permissions for geofencing")
      _status.value = "Missing permissions"
      return false
    }

    if (_registeredLocations.value.size >= MAX_GEOFENCES) {
      Log.e(TAG, "Maximum number of geofences reached ($MAX_GEOFENCES)")
      _status.value = "Max geofences reached"
      return false
    }

    try {
      val geofence = Geofence.Builder()
        .setRequestId(location.id)
        .setCircularRegion(
          location.latitude,
          location.longitude,
          maxOf(location.radiusMeters, MIN_RADIUS_METERS)
        )
        .setExpirationDuration(GEOFENCE_EXPIRATION_MS)
        .setTransitionTypes(
          Geofence.GEOFENCE_TRANSITION_ENTER or
          Geofence.GEOFENCE_TRANSITION_EXIT or
          Geofence.GEOFENCE_TRANSITION_DWELL
        )
        .setLoiteringDelay(DWELL_DELAY_MS)
        .build()

      val request = GeofencingRequest.Builder()
        .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
        .addGeofence(geofence)
        .build()

      geofencingClient.addGeofences(request, geofencePendingIntent).await()

      // Update registered locations
      _registeredLocations.value = _registeredLocations.value + (location.id to location)
      _status.value = "Registered: ${location.name}"

      Log.i(TAG, "Registered geofence for ${location.name} (${location.id})")
      return true
    } catch (e: Exception) {
      Log.e(TAG, "Failed to register geofence for ${location.name}", e)
      _status.value = "Failed: ${e.message}"
      return false
    }
  }

  /**
   * Unregister a geofence by location ID.
   *
   * @param locationId The location ID to unregister
   * @return true if unregistration was successful
   */
  suspend fun unregisterGeofence(locationId: String): Boolean {
    try {
      geofencingClient.removeGeofences(listOf(locationId)).await()

      // Update registered locations
      _registeredLocations.value = _registeredLocations.value - locationId
      _status.value = "Unregistered: $locationId"

      Log.i(TAG, "Unregistered geofence: $locationId")
      return true
    } catch (e: Exception) {
      Log.e(TAG, "Failed to unregister geofence: $locationId", e)
      _status.value = "Failed: ${e.message}"
      return false
    }
  }

  /**
   * Unregister all geofences.
   *
   * @return true if all geofences were unregistered
   */
  suspend fun unregisterAllGeofences(): Boolean {
    try {
      geofencingClient.removeGeofences(geofencePendingIntent).await()
      _registeredLocations.value = emptyMap()
      _status.value = "All geofences removed"

      Log.i(TAG, "Unregistered all geofences")
      return true
    } catch (e: Exception) {
      Log.e(TAG, "Failed to unregister all geofences", e)
      _status.value = "Failed: ${e.message}"
      return false
    }
  }

  /**
   * Update a geofence (unregister and re-register with new parameters).
   *
   * @param location The updated location
   * @return true if update was successful
   */
  suspend fun updateGeofence(location: SavedLocation): Boolean {
    unregisterGeofence(location.id)
    return registerGeofence(location)
  }

  /**
   * Handle a geofence transition from the broadcast receiver.
   *
   * Called by [GeofenceBroadcastReceiver] when a transition occurs.
   *
   * @param locationId The location ID that triggered
   * @param transitionType The type of transition (enter/exit/dwell)
   */
  fun handleGeofenceTransition(locationId: String, transitionType: Int) {
    val location = _registeredLocations.value[locationId]
    if (location == null) {
      Log.w(TAG, "Received transition for unknown location: $locationId")
      return
    }

    val eventType = when (transitionType) {
      Geofence.GEOFENCE_TRANSITION_ENTER -> GeofenceEventType.ENTER
      Geofence.GEOFENCE_TRANSITION_EXIT -> GeofenceEventType.EXIT
      Geofence.GEOFENCE_TRANSITION_DWELL -> GeofenceEventType.DWELL
      else -> {
        Log.w(TAG, "Unknown transition type: $transitionType")
        return
      }
    }

    val event = GeofenceEvent(
      locationId = locationId,
      locationName = location.name,
      eventType = eventType
    )

    Log.i(TAG, "Geofence ${eventType.name}: ${location.name}")
    callback?.onGeofenceEvent(event)
  }

  /**
   * Re-register all geofences from stored locations.
   *
   * Called after device reboot to restore geofences.
   *
   * @param locations List of locations to re-register
   */
  fun reregisterGeofences(locations: List<SavedLocation>) {
    scope.launch(Dispatchers.IO) {
      for (location in locations) {
        registerGeofence(location)
      }
      Log.i(TAG, "Re-registered ${locations.size} geofences")
    }
  }

  /**
   * Serialize a location to JSON for storage.
   *
   * @param location The location to serialize
   * @return JSON string
   */
  fun serializeLocation(location: SavedLocation): String {
    return json.encodeToString(location)
  }

  /**
   * Deserialize a location from JSON.
   *
   * @param jsonString The JSON string
   * @return Parsed location
   */
  fun deserializeLocation(jsonString: String): SavedLocation {
    return json.decodeFromString(jsonString)
  }

  /**
   * Get the number of registered geofences.
   */
  fun getRegisteredCount(): Int = _registeredLocations.value.size

  /**
   * Check if a location is registered.
   *
   * @param locationId The location ID to check
   * @return true if registered
   */
  fun isRegistered(locationId: String): Boolean {
    return _registeredLocations.value.containsKey(locationId)
  }
}
