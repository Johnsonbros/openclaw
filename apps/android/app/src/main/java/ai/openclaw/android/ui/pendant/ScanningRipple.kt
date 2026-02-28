package ai.openclaw.android.ui.pendant

import androidx.compose.animation.core.InfiniteTransition
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Animated scanning ripple — 3 concentric circles that expand and fade out,
 * inspired by the Omi ScanningRippleWidget.
 */
@Composable
fun ScanningRipple(
  modifier: Modifier = Modifier,
  size: Dp = 200.dp,
  ringColor: Color = Color.White,
  ringCount: Int = 3,
  cycleDurationMs: Int = 2500,
) {
  val transition = rememberInfiniteTransition(label = "scanRipple")

  Box(modifier = modifier.size(size), contentAlignment = Alignment.Center) {
    repeat(ringCount) { index ->
      val delay = (cycleDurationMs / ringCount) * index
      RippleRing(
        transition = transition,
        cycleDurationMs = cycleDurationMs,
        delay = delay,
        ringColor = ringColor,
        ringSize = size,
      )
    }
  }
}

@Composable
private fun RippleRing(
  transition: InfiniteTransition,
  cycleDurationMs: Int,
  delay: Int,
  ringColor: Color,
  ringSize: Dp,
) {
  val progress by transition.animateFloat(
    initialValue = 0f,
    targetValue = 1f,
    animationSpec = infiniteRepeatable(
      animation = tween(durationMillis = cycleDurationMs, delayMillis = delay, easing = LinearEasing),
    ),
    label = "rippleRing",
  )

  Canvas(modifier = Modifier.size(ringSize)) {
    val maxRadius = size.minDimension / 2f
    val radius = maxRadius * progress
    val alpha = (1f - progress).coerceIn(0f, 1f) * 0.6f
    drawCircle(
      color = ringColor.copy(alpha = alpha),
      radius = radius,
      style = Stroke(width = 2.dp.toPx()),
    )
  }
}
