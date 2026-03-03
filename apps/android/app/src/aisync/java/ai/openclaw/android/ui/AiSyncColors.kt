package ai.openclaw.android.ui

import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

// AiSync Dark Theme — Dark only for v1
object AiSyncColors {
    // Backgrounds
    val base = Color(0xFF0F172A)
    val surface1 = Color(0xFF1E293B)
    val surface2 = Color(0xFF334155)
    val surface3 = Color(0xFF475569)

    // Brand
    val primary = Color(0xFF0F3460)
    val accent = Color(0xFF4FC3F7)
    val highlight = Color(0xFF6366F1)

    // Text
    val textPrimary = Color(0xFFF1F5F9)
    val textSecondary = Color(0xFF94A3B8)
    val textTertiary = Color(0xFF64748B)

    // Status
    val success = Color(0xFF10B981)
    val warning = Color(0xFFF59E0B)
    val danger = Color(0xFFEF4444)
    val info = Color(0xFF4FC3F7)

    // Floating buttons
    val floatingBg = Color(0xFF1E293B).copy(alpha = 0.85f)
    val floatingBorder = Color(0xFF334155)

    // Gradients
    val backgroundGradient = Brush.verticalGradient(
        colors = listOf(base, Color(0xFF131B2E), base),
    )
}
