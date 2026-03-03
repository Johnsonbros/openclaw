package ai.openclaw.android.ui

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun VoicePulsingDot(
    isActive: Boolean,
    isThinking: Boolean,
    modifier: Modifier = Modifier,
) {
    if (!isActive && !isThinking) return

    val infiniteTransition = rememberInfiniteTransition(label = "pulse")

    val scale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = if (isThinking) 1.3f else 1.5f,
        animationSpec = infiniteRepeatable(
            animation = tween(
                durationMillis = if (isThinking) 600 else 800,
                easing = FastOutSlowInEasing,
            ),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "scale",
    )

    val alpha by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = if (isThinking) 0.5f else 0.3f,
        animationSpec = infiniteRepeatable(
            animation = tween(
                durationMillis = if (isThinking) 600 else 800,
                easing = FastOutSlowInEasing,
            ),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "alpha",
    )

    val color = if (isThinking) AiSyncColors.highlight else AiSyncColors.accent

    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        // Outer glow
        Box(
            modifier = Modifier
                .size(28.dp)
                .scale(scale)
                .background(color.copy(alpha = alpha * 0.3f), CircleShape),
        )
        // Inner dot
        Box(
            modifier = Modifier
                .size(12.dp)
                .background(color, CircleShape),
        )
    }
}

@Composable
fun VoiceCallPill(
    agentName: String,
    isSpeaking: Boolean,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(999.dp),
        color = AiSyncColors.surface1.copy(alpha = 0.92f),
        shadowElevation = 8.dp,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            VoicePulsingDot(
                isActive = isSpeaking,
                isThinking = !isSpeaking,
                modifier = Modifier.size(24.dp),
            )
            Text(
                text = "On call with $agentName",
                color = AiSyncColors.textPrimary,
                fontSize = 14.sp,
                fontWeight = FontWeight.Medium,
            )
        }
    }
}

@Composable
fun ConnectionStatusPill(
    isConnected: Boolean,
    statusText: String,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(999.dp),
        color = AiSyncColors.surface1.copy(alpha = 0.75f),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .background(
                        if (isConnected) AiSyncColors.success else AiSyncColors.danger,
                        CircleShape,
                    ),
            )
            Text(
                text = statusText.trim().ifEmpty { "Offline" },
                color = AiSyncColors.textSecondary,
                fontSize = 12.sp,
            )
        }
    }
}
