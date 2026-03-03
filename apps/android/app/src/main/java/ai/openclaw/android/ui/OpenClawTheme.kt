package ai.openclaw.android.ui

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import ai.openclaw.android.BuildConfig

private val aisyncDarkColorScheme = darkColorScheme(
  primary = Color(0xFF4FC3F7),
  secondary = Color(0xFF0F3460),
  tertiary = Color(0xFF6366F1),
  background = Color(0xFF0F172A),
  surface = Color(0xFF1E293B),
  surfaceVariant = Color(0xFF334155),
  onPrimary = Color.White,
  onSecondary = Color.White,
  onBackground = Color(0xFFF1F5F9),
  onSurface = Color(0xFFF1F5F9),
  onSurfaceVariant = Color(0xFF94A3B8),
  error = Color(0xFFEF4444),
)

private val isAiSync: Boolean = BuildConfig.FLAVOR_brand == "aisync"

@Composable
fun OpenClawTheme(content: @Composable () -> Unit) {
  val context = LocalContext.current
  val isDark = isSystemInDarkTheme()
  val colorScheme = when {
    isAiSync -> aisyncDarkColorScheme // Always dark for AiSync
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
      if (isDark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
    else -> if (isDark) darkColorScheme() else lightColorScheme()
  }

  MaterialTheme(colorScheme = colorScheme, content = content)
}

@Composable
fun overlayContainerColor(): Color {
  val scheme = MaterialTheme.colorScheme
  val isDark = isSystemInDarkTheme()
  val base = if (isDark) scheme.surfaceContainerLow else scheme.surfaceContainerHigh
  // Light mode: background stays dark (canvas), so clamp overlays away from pure-white glare.
  return if (isDark) base else base.copy(alpha = 0.88f)
}

@Composable
fun overlayIconColor(): Color {
  return MaterialTheme.colorScheme.onSurfaceVariant
}
