package ai.openclaw.android.location

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json

/**
 * Broadcast receiver for device boot events.
 *
 * Re-registers geofences after device reboot, since geofences do not persist
 * across reboots in Android.
 *
 * ## Registration
 *
 * This receiver must be registered in AndroidManifest.xml:
 *
 * ```xml
 * <receiver
 *   android:name=".location.BootReceiver"
 *   android:exported="false">
 *   <intent-filter>
 *     <action android:name="android.intent.action.BOOT_COMPLETED" />
 *   </intent-filter>
 * </receiver>
 * ```
 *
 * ## Permissions Required
 *
 * - `RECEIVE_BOOT_COMPLETED` - To receive boot broadcast
 *
 * ## Boot Flow
 *
 * 1. Device boots
 * 2. Android sends BOOT_COMPLETED broadcast
 * 3. This receiver loads saved locations from preferences
 * 4. Re-registers all geofences with LocationManager
 *
 * @see LocationManager
 */
class BootReceiver : BroadcastReceiver() {
  companion object {
    private const val TAG = "BootReceiver"

    /** SharedPreferences key for saved locations */
    const val PREFS_NAME = "pendant_locations"

    /** Key for the locations JSON array */
    const val KEY_LOCATIONS = "saved_locations"
  }

  private val json = Json { ignoreUnknownKeys = true }

  /**
   * Handle device boot broadcast.
   *
   * Uses goAsync() to allow long-running geofence re-registration work
   * without being killed by the system's 10-second timeout.
   *
   * @param context Application context
   * @param intent Boot completed intent
   */
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED) {
      Log.d(TAG, "Ignoring non-boot intent: ${intent.action}")
      return
    }

    Log.i(TAG, "Device booted - re-registering geofences")

    // Use goAsync() to extend the broadcast receiver's lifecycle
    // This allows us to do async work without being killed by the 10-second timeout
    val pendingResult = goAsync()

    // Create a new scope for this specific broadcast
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    scope.launch {
      try {
        reregisterGeofences(context)
      } catch (e: Exception) {
        Log.e(TAG, "Failed to re-register geofences on boot", e)
      } finally {
        // CRITICAL: Always call finish() to release the wake lock
        pendingResult.finish()
      }
    }
  }

  /**
   * Re-register all saved geofences.
   *
   * [P-H8] Limitation: geofence transitions that occur between device boot and the
   * first gateway WebSocket connection are inherently undeliverable. The broadcast
   * receiver re-registers geofences with the OS, but there is no connected gateway
   * session to forward events to until the app starts and connects. This is an
   * acceptable edge case since the window is typically very short.
   *
   * @param context Application context
   */
  private suspend fun reregisterGeofences(context: Context) {
    // Load saved locations from SharedPreferences
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val locationsJson = prefs.getString(KEY_LOCATIONS, null)

    if (locationsJson.isNullOrEmpty()) {
      Log.d(TAG, "No saved locations to re-register")
      return
    }

    try {
      val locations: List<SavedLocation> = json.decodeFromString(locationsJson)
      Log.i(TAG, "Found ${locations.size} saved locations to re-register")

      if (locations.isEmpty()) {
        return
      }

      // Get or create LocationManager
      val locationManager = GeofenceBroadcastReceiver.locationManager
      if (locationManager == null) {
        Log.w(TAG, "LocationManager not available, deferring geofence registration")
        // Store flag to register later when app starts
        prefs.edit().putBoolean("pending_reregistration", true).apply()
        return
      }

      // Re-register each geofence
      var successCount = 0
      for (location in locations) {
        val success = locationManager.registerGeofence(location)
        if (success) {
          successCount++
        }
      }

      Log.i(TAG, "Re-registered $successCount/${locations.size} geofences")
    } catch (e: Exception) {
      Log.e(TAG, "Failed to parse saved locations", e)
    }
  }
}

/**
 * Helper object for persisting locations to SharedPreferences.
 *
 * Used by LocationManager to persist locations and by BootReceiver to restore them.
 */
object LocationPersistence {
  private val json = Json { ignoreUnknownKeys = true }

  /**
   * Lock guarding read-modify-write cycles in [addLocation] and [removeLocation]
   * to prevent concurrent writes from losing data.  [P-H7]
   */
  private val lock = Any()

  /**
   * Save locations to SharedPreferences.
   *
   * @param context Application context
   * @param locations List of locations to save
   */
  fun saveLocations(context: Context, locations: List<SavedLocation>) {
    val prefs = context.getSharedPreferences(BootReceiver.PREFS_NAME, Context.MODE_PRIVATE)
    val locationsJson = json.encodeToString(
      kotlinx.serialization.builtins.ListSerializer(SavedLocation.serializer()),
      locations
    )
    prefs.edit().putString(BootReceiver.KEY_LOCATIONS, locationsJson).apply()
  }

  /**
   * Load locations from SharedPreferences.
   *
   * @param context Application context
   * @return List of saved locations
   */
  fun loadLocations(context: Context): List<SavedLocation> {
    val prefs = context.getSharedPreferences(BootReceiver.PREFS_NAME, Context.MODE_PRIVATE)
    val locationsJson = prefs.getString(BootReceiver.KEY_LOCATIONS, null)

    if (locationsJson.isNullOrEmpty()) {
      return emptyList()
    }

    return try {
      json.decodeFromString(locationsJson)
    } catch (e: Exception) {
      emptyList()
    }
  }
  /**
   * Add a location to persistence.
   *
   * Synchronized to prevent concurrent read-modify-write races. [P-H7]
   *
   * @param context Application context
   * @param location Location to add
   */
  fun addLocation(context: Context, location: SavedLocation) {
    synchronized(lock) {
      val locations = loadLocations(context).toMutableList()
      locations.removeAll { it.id == location.id }
      locations.add(location)
      saveLocations(context, locations)
    }
  }

  /**
   * Remove a location from persistence.
   *
   * Synchronized to prevent concurrent read-modify-write races. [P-H7]
   *
   * @param context Application context
   * @param locationId ID of location to remove
   */
  fun removeLocation(context: Context, locationId: String) {
    synchronized(lock) {
      val locations = loadLocations(context).filter { it.id != locationId }
      saveLocations(context, locations)
    }
  }

  /**
   * Check if there's a pending re-registration from boot.
   *
   * @param context Application context
   * @return true if re-registration is pending
   */
  fun hasPendingReregistration(context: Context): Boolean {
    val prefs = context.getSharedPreferences(BootReceiver.PREFS_NAME, Context.MODE_PRIVATE)
    return prefs.getBoolean("pending_reregistration", false)
  }

  /**
   * Clear the pending re-registration flag.
   *
   * @param context Application context
   */
  fun clearPendingReregistration(context: Context) {
    val prefs = context.getSharedPreferences(BootReceiver.PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit().putBoolean("pending_reregistration", false).apply()
  }
}
