package ai.openclaw.android.location

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent

/**
 * Broadcast receiver for geofence transition events.
 *
 * Receives geofence enter/exit/dwell events from the Android system and
 * forwards them to the [LocationManager] for processing.
 *
 * ## Registration
 *
 * This receiver must be registered in AndroidManifest.xml:
 *
 * ```xml
 * <receiver
 *   android:name=".location.GeofenceBroadcastReceiver"
 *   android:exported="false" />
 * ```
 *
 * ## Event Flow
 *
 * 1. User enters/exits a geofenced area
 * 2. Android system detects transition
 * 3. This receiver is triggered
 * 4. Event is forwarded to LocationManager
 * 5. LocationManager notifies registered callbacks
 * 6. Callback sends event to gateway via WebSocket
 *
 * @see LocationManager
 * @see GeofenceCallback
 */
class GeofenceBroadcastReceiver : BroadcastReceiver() {
  companion object {
    private const val TAG = "GeofenceReceiver"

    /**
     * Singleton reference to LocationManager for receiving events.
     *
     * Must be set by the application before geofence events can be processed.
     * Typically set in Application.onCreate() or when LocationManager is created.
     */
    @Volatile
    var locationManager: LocationManager? = null
  }

  /**
   * Handle incoming geofence transition broadcast.
   *
   * @param context Application context
   * @param intent Intent containing geofence transition data
   */
  override fun onReceive(context: Context, intent: Intent) {
    Log.d(TAG, "Received geofence broadcast")

    val geofencingEvent = GeofencingEvent.fromIntent(intent)
    if (geofencingEvent == null) {
      Log.e(TAG, "Failed to parse GeofencingEvent from intent")
      return
    }

    if (geofencingEvent.hasError()) {
      val errorCode = geofencingEvent.errorCode
      Log.e(TAG, "Geofencing error: ${getErrorString(errorCode)}")
      return
    }

    val transitionType = geofencingEvent.geofenceTransition
    val triggeringGeofences = geofencingEvent.triggeringGeofences

    if (triggeringGeofences.isNullOrEmpty()) {
      Log.w(TAG, "No triggering geofences in event")
      return
    }

    val transitionName = when (transitionType) {
      Geofence.GEOFENCE_TRANSITION_ENTER -> "ENTER"
      Geofence.GEOFENCE_TRANSITION_EXIT -> "EXIT"
      Geofence.GEOFENCE_TRANSITION_DWELL -> "DWELL"
      else -> "UNKNOWN($transitionType)"
    }

    Log.i(TAG, "Geofence transition: $transitionName, ${triggeringGeofences.size} geofence(s)")

    // Forward to LocationManager
    val manager = locationManager
    if (manager == null) {
      Log.w(TAG, "LocationManager not set, cannot process geofence event")
      return
    }

    for (geofence in triggeringGeofences) {
      val locationId = geofence.requestId
      Log.d(TAG, "Processing geofence: $locationId ($transitionName)")
      manager.handleGeofenceTransition(locationId, transitionType)
    }
  }

  /**
   * Convert geofence error code to human-readable string.
   *
   * @param errorCode The error code from GeofencingEvent
   * @return Human-readable error description
   */
  private fun getErrorString(errorCode: Int): String {
    return when (errorCode) {
      1 -> "GEOFENCE_NOT_AVAILABLE - Geofence service is not available"
      2 -> "GEOFENCE_TOO_MANY_GEOFENCES - Too many geofences registered"
      3 -> "GEOFENCE_TOO_MANY_PENDING_INTENTS - Too many pending intents"
      else -> "Unknown error code: $errorCode"
    }
  }
}
