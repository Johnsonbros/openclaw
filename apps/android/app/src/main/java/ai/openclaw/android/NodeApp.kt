package ai.openclaw.android

import android.app.Application
import android.os.StrictMode
import android.util.Log
import ai.openclaw.android.location.GeofenceBroadcastReceiver
import ai.openclaw.android.location.LocationPersistence
import ai.openclaw.android.location.LocationManager as GeofenceLocationManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob

class NodeApp : Application() {
  val runtime: NodeRuntime by lazy { NodeRuntime(this) }

  /** Geofence location manager, shared with GeofenceBroadcastReceiver. */
  lateinit var geofenceLocationManager: GeofenceLocationManager
    private set

  private val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

  override fun onCreate() {
    super.onCreate()
    if (BuildConfig.DEBUG) {
      StrictMode.setThreadPolicy(
        StrictMode.ThreadPolicy.Builder()
          .detectAll()
          .penaltyLog()
          .build(),
      )
      StrictMode.setVmPolicy(
        StrictMode.VmPolicy.Builder()
          .detectAll()
          .penaltyLog()
          .build(),
      )
    }

    // Initialize geofence LocationManager and wire it to the broadcast receiver
    geofenceLocationManager = GeofenceLocationManager(this, appScope)
    GeofenceBroadcastReceiver.locationManager = geofenceLocationManager

    // Handle any pending geofence re-registration from boot
    if (LocationPersistence.hasPendingReregistration(this)) {
      Log.i("NodeApp", "Completing deferred geofence re-registration from boot")
      val savedLocations = LocationPersistence.loadLocations(this)
      if (savedLocations.isNotEmpty()) {
        geofenceLocationManager.reregisterGeofences(savedLocations)
      }
      LocationPersistence.clearPendingReregistration(this)
    }
  }
}
