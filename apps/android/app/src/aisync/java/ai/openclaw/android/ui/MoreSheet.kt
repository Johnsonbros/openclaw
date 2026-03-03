package ai.openclaw.android.ui

import ai.openclaw.android.MainViewModel
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Bluetooth
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.ElectricBolt
import androidx.compose.material.icons.filled.Map
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ai.openclaw.android.ui.pendant.PendantSetupScreen

private enum class MoreScreen { None, Chat, Maps, Pendant, Vault, Automations }

private data class MoreCard(
    val screen: MoreScreen,
    val icon: ImageVector,
    val title: String,
    val subtitle: String,
)

private val cards = listOf(
    MoreCard(MoreScreen.Chat, Icons.Default.ChatBubble, "Chat", "Text conversation"),
    MoreCard(MoreScreen.Maps, Icons.Default.Map, "Maps", "Places & reminders"),
    MoreCard(MoreScreen.Pendant, Icons.Default.Bluetooth, "Pendant", "BLE device"),
    MoreCard(MoreScreen.Vault, Icons.Default.Psychology, "Vault", "AI memory"),
    MoreCard(MoreScreen.Automations, Icons.Default.ElectricBolt, "Automations", "Workflows"),
)

@Composable
fun MoreSheet(
    viewModel: MainViewModel,
    @Suppress("UNUSED_PARAMETER") onDismiss: () -> Unit,
) {
    var activeScreen by remember { mutableStateOf(MoreScreen.None) }

    when (activeScreen) {
        MoreScreen.None -> MoreCardGrid(
            onSelect = { activeScreen = it },
        )
        MoreScreen.Chat -> ChatSheet(viewModel = viewModel)
        MoreScreen.Maps -> MapsPlaceholder()
        MoreScreen.Pendant -> PendantSetupScreen(viewModel = viewModel)
        MoreScreen.Vault -> VaultPlaceholder()
        MoreScreen.Automations -> AutomationsPlaceholder()
    }
}

@Composable
private fun MoreCardGrid(onSelect: (MoreScreen) -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            "More",
            color = AiSyncColors.textPrimary,
            fontSize = 20.sp,
            fontWeight = FontWeight.SemiBold,
        )

        // Row 1: Chat + Maps
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            cards.take(2).forEach { card ->
                MoreCardTile(
                    card = card,
                    onClick = { onSelect(card.screen) },
                    modifier = Modifier.weight(1f),
                )
            }
        }

        // Row 2: Pendant + Vault
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            cards.drop(2).take(2).forEach { card ->
                MoreCardTile(
                    card = card,
                    onClick = { onSelect(card.screen) },
                    modifier = Modifier.weight(1f),
                )
            }
        }

        // Row 3: Automations (centered)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.Center,
        ) {
            MoreCardTile(
                card = cards.last(),
                onClick = { onSelect(cards.last().screen) },
                modifier = Modifier.width(160.dp),
            )
        }

        Spacer(modifier = Modifier.height(24.dp))
    }
}

@Composable
private fun MoreCardTile(
    card: MoreCard,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        onClick = onClick,
        modifier = modifier.heightIn(min = 100.dp),
        shape = RoundedCornerShape(16.dp),
        color = AiSyncColors.surface2,
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                imageVector = card.icon,
                contentDescription = card.title,
                tint = AiSyncColors.accent,
                modifier = Modifier.size(28.dp),
            )
            Text(
                text = card.title,
                color = AiSyncColors.textPrimary,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = card.subtitle,
                color = AiSyncColors.textSecondary,
                fontSize = 13.sp,
            )
        }
    }
}

@Composable
private fun MapsPlaceholder() {
    Box(Modifier.fillMaxWidth().height(400.dp), contentAlignment = Alignment.Center) {
        Text("Maps — Coming soon", color = AiSyncColors.textSecondary)
    }
}

@Composable
private fun VaultPlaceholder() {
    Box(Modifier.fillMaxWidth().height(400.dp), contentAlignment = Alignment.Center) {
        Text("Vault — Agent memory browser", color = AiSyncColors.textSecondary)
    }
}

@Composable
private fun AutomationsPlaceholder() {
    Box(Modifier.fillMaxWidth().height(400.dp), contentAlignment = Alignment.Center) {
        Text("Automations — Coming soon", color = AiSyncColors.textSecondary)
    }
}
