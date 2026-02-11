package ai.openclaw.android.pendant

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch

/**
 * Foreground service for maintaining pendant BLE connection in the background.
 *
 * This service keeps the BLE connection alive when the app is backgrounded,
 * allowing continuous audio streaming from the pendant.
 */
class PendantService : Service() {
  companion object {
    private const val TAG = "PendantService"
    private const val NOTIFICATION_ID = 2001
    private const val CHANNEL_ID = "pendant_service"
    private const val CHANNEL_NAME = "Pendant Connection"

    private const val ACTION_START = "ai.openclaw.android.pendant.START"
    private const val ACTION_STOP = "ai.openclaw.android.pendant.STOP"

    /**
     * Start the pendant service.
     */
    fun start(context: Context) {
      val intent = Intent(context, PendantService::class.java).apply {
        action = ACTION_START
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    /**
     * Stop the pendant service.
     */
    fun stop(context: Context) {
      val intent = Intent(context, PendantService::class.java).apply {
        action = ACTION_STOP
      }
      context.startService(intent)
    }
  }

  private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
  private var pendantManager: PendantManager? = null
  private var stateObserverJob: Job? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        startForeground(NOTIFICATION_ID, createNotification("Pendant service running"))
        startStateObserver()
      }
      ACTION_STOP -> {
        stopSelf()
      }
    }
    return START_STICKY
  }

  override fun onDestroy() {
    stateObserverJob?.cancel()
    serviceScope.cancel()
    super.onDestroy()
  }

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        CHANNEL_NAME,
        NotificationManager.IMPORTANCE_LOW
      ).apply {
        description = "Maintains BLE connection to pendant device"
        setShowBadge(false)
      }

      val notificationManager = getSystemService(NotificationManager::class.java)
      notificationManager?.createNotificationChannel(channel)
    }
  }

  private fun createNotification(text: String): Notification {
    // Intent to open main activity when notification is tapped
    val pendingIntent = packageManager.getLaunchIntentForPackage(packageName)?.let { intent ->
      PendingIntent.getActivity(
        this,
        0,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("OpenClaw Pendant")
      .setContentText(text)
      .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setOngoing(true)
      .setContentIntent(pendingIntent)
      .build()
  }

  private fun updateNotification(text: String) {
    val notificationManager = getSystemService(NotificationManager::class.java)
    notificationManager?.notify(NOTIFICATION_ID, createNotification(text))
  }

  private fun startStateObserver() {
    // Get PendantManager from application (needs to be set up in NodeApp/NodeRuntime)
    // For now, we'll observe a placeholder - in production this would come from
    // a singleton or dependency injection

    // Example of how this would work with a real PendantManager:
    // stateObserverJob = serviceScope.launch {
    //   pendantManager?.statusText?.collect { status ->
    //     updateNotification(status)
    //   }
    // }
  }

  /**
   * Set the PendantManager instance to observe.
   * Call this from the main application after creating the manager.
   */
  fun setPendantManager(manager: PendantManager) {
    pendantManager = manager

    stateObserverJob?.cancel()
    stateObserverJob = serviceScope.launch {
      manager.statusText.collect { status ->
        updateNotification(status)
      }
    }
  }
}
