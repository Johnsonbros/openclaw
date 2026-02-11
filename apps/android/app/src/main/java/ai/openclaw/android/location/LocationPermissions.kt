package ai.openclaw.android.location

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat

/**
 * Helper for managing location permissions required for geofencing.
 *
 * Geofencing requires specific permissions that vary by Android version:
 *
 * - **Android 9 and below**: `ACCESS_FINE_LOCATION` only
 * - **Android 10 (Q)**: Add `ACCESS_BACKGROUND_LOCATION`
 * - **Android 11+**: Background location must be requested separately
 *
 * ## Permission Request Flow
 *
 * 1. Check if permissions are granted with [hasAllPermissions]
 * 2. If not, get missing permissions with [getMissingPermissions]
 * 3. Request permissions using Android's permission APIs
 * 4. On Android 11+, request foreground permissions first, then background
 *
 * ## Usage
 *
 * ```kotlin
 * val permissions = LocationPermissions(context)
 *
 * if (!permissions.hasAllPermissions()) {
 *   val missing = permissions.getMissingPermissions()
 *   // Request missing permissions from Activity
 * }
 *
 * if (permissions.needsBackgroundPermissionSeparately()) {
 *   // Show rationale and request background permission separately
 * }
 * ```
 *
 * @param context Application or Activity context
 */
class LocationPermissions(private val context: Context) {

  /**
   * Permission for precise location (required for geofencing).
   */
  val fineLocation = Manifest.permission.ACCESS_FINE_LOCATION

  /**
   * Permission for approximate location (useful but not sufficient for geofencing).
   */
  val coarseLocation = Manifest.permission.ACCESS_COARSE_LOCATION

  /**
   * Permission for background location access (Android 10+).
   * Required for geofences to work when app is not in foreground.
   */
  val backgroundLocation: String? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
    Manifest.permission.ACCESS_BACKGROUND_LOCATION
  } else {
    null
  }

  /**
   * Check if fine location permission is granted.
   *
   * @return true if ACCESS_FINE_LOCATION is granted
   */
  fun hasFineLocation(): Boolean {
    return ContextCompat.checkSelfPermission(
      context,
      fineLocation
    ) == PackageManager.PERMISSION_GRANTED
  }

  /**
   * Check if coarse location permission is granted.
   *
   * @return true if ACCESS_COARSE_LOCATION is granted
   */
  fun hasCoarseLocation(): Boolean {
    return ContextCompat.checkSelfPermission(
      context,
      coarseLocation
    ) == PackageManager.PERMISSION_GRANTED
  }

  /**
   * Check if background location permission is granted.
   *
   * On Android 9 and below, this always returns true since background
   * location is implicitly granted with fine location.
   *
   * @return true if background location access is available
   */
  fun hasBackgroundLocation(): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.ACCESS_BACKGROUND_LOCATION
      ) == PackageManager.PERMISSION_GRANTED
    } else {
      // Before Android 10, background location is included with fine location
      true
    }
  }

  /**
   * Check if all permissions required for geofencing are granted.
   *
   * For geofencing to work reliably, both fine location and background
   * location (on Android 10+) must be granted.
   *
   * @return true if all required permissions are granted
   */
  fun hasAllPermissions(): Boolean {
    return hasFineLocation() && hasBackgroundLocation()
  }

  /**
   * Check if foreground location permissions are granted.
   *
   * @return true if either fine or coarse location is granted
   */
  fun hasForegroundPermissions(): Boolean {
    return hasFineLocation() || hasCoarseLocation()
  }

  /**
   * Get list of all permissions that need to be requested.
   *
   * @return Array of permission strings that are not yet granted
   */
  fun getMissingPermissions(): Array<String> {
    val missing = mutableListOf<String>()

    if (!hasFineLocation()) {
      missing.add(fineLocation)
    }

    if (!hasCoarseLocation()) {
      missing.add(coarseLocation)
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && !hasBackgroundLocation()) {
      missing.add(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
    }

    return missing.toTypedArray()
  }

  /**
   * Get foreground location permissions only.
   *
   * On Android 11+, background location must be requested separately
   * after foreground permissions are granted.
   *
   * @return Array of foreground location permission strings
   */
  fun getForegroundPermissions(): Array<String> {
    return arrayOf(fineLocation, coarseLocation)
  }

  /**
   * Check if background permission needs to be requested separately.
   *
   * On Android 11 (R) and above, background location must be requested
   * in a separate permission request after foreground location is granted.
   *
   * @return true if background permission should be requested separately
   */
  fun needsBackgroundPermissionSeparately(): Boolean {
    return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
           hasForegroundPermissions() &&
           !hasBackgroundLocation()
  }

  /**
   * Get a user-friendly explanation of why each permission is needed.
   *
   * @return Map of permission to explanation string
   */
  fun getPermissionRationales(): Map<String, String> {
    val rationales = mutableMapOf<String, String>()

    rationales[fineLocation] = "Precise location is needed to detect when you arrive at or leave specific places for your reminders."

    rationales[coarseLocation] = "Approximate location helps provide location-based features."

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      rationales[Manifest.permission.ACCESS_BACKGROUND_LOCATION] =
        "Background location access allows reminders to trigger even when the app is not open. " +
        "Without this, location-based reminders will only work while the app is visible."
    }

    return rationales
  }

  /**
   * Get current permission status summary.
   *
   * @return Human-readable status string
   */
  fun getStatusSummary(): String {
    return buildString {
      append("Location Permissions Status:\n")
      append("  Fine Location: ${if (hasFineLocation()) "✓ Granted" else "✗ Not granted"}\n")
      append("  Coarse Location: ${if (hasCoarseLocation()) "✓ Granted" else "✗ Not granted"}\n")

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        append("  Background Location: ${if (hasBackgroundLocation()) "✓ Granted" else "✗ Not granted"}\n")
      } else {
        append("  Background Location: ✓ Included (Android ${Build.VERSION.SDK_INT})\n")
      }

      append("\nGeofencing Ready: ${if (hasAllPermissions()) "Yes" else "No"}")
    }
  }

  companion object {
    /**
     * Request code for foreground location permissions.
     */
    const val REQUEST_FOREGROUND_LOCATION = 1001

    /**
     * Request code for background location permission.
     */
    const val REQUEST_BACKGROUND_LOCATION = 1002

    /**
     * Request code for all location permissions (combined).
     */
    const val REQUEST_ALL_LOCATION = 1003
  }
}
