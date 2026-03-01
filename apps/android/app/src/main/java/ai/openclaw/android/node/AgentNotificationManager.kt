package ai.openclaw.android.node

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import ai.openclaw.android.MainActivity
import ai.openclaw.android.R
import java.util.concurrent.atomic.AtomicInteger

class AgentNotificationManager(private val context: Context) {
  companion object {
    const val CHANNEL_ID = "agent_responses"
    private const val GROUP_KEY = "ai.openclaw.android.AGENT_RESPONSES"
    private val notificationIdCounter = AtomicInteger(1000)
  }

  private val notificationManager =
    context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  init {
    ensureChannel()
  }

  private fun ensureChannel() {
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Agent Responses",
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = "Notifications when your assistant responds"
      setShowBadge(true)
    }
    notificationManager.createNotificationChannel(channel)
  }

  fun canPost(): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      return ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.POST_NOTIFICATIONS,
      ) == PackageManager.PERMISSION_GRANTED
    }
    return true
  }

  fun postAgentResponse(text: String, sessionKey: String? = null) {
    if (!canPost()) return

    val launchIntent = Intent(context, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      if (!sessionKey.isNullOrBlank()) {
        putExtra("openSessionKey", sessionKey)
      }
    }
    val pendingIntent = PendingIntent.getActivity(
      context,
      notificationIdCounter.get(),
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val preview = if (text.length > 300) text.take(297) + "…" else text
    val brandName = context.getString(R.string.brand_assistant_name)
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(brandName)
      .setContentText(preview)
      .setStyle(NotificationCompat.BigTextStyle().bigText(preview))
      .setContentIntent(pendingIntent)
      .setAutoCancel(true)
      .setGroup(GROUP_KEY)
      .build()

    notificationManager.notify(notificationIdCounter.incrementAndGet(), notification)
  }

  fun dismissAll() {
    notificationManager.cancelAll()
  }
}
