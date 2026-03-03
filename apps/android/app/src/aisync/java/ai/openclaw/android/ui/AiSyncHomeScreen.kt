package ai.openclaw.android.ui

import ai.openclaw.android.MainViewModel
import ai.openclaw.android.R
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.FloatingActionButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

enum class AiSyncVoiceMode { Off, WalkieTalkie, Call }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AiSyncHomeScreen(viewModel: MainViewModel) {
    val isConnected by viewModel.isConnected.collectAsState()
    val statusText by viewModel.statusText.collectAsState()
    val talkIsListening by viewModel.talkIsListening.collectAsState()
    val talkIsSpeaking by viewModel.talkIsSpeaking.collectAsState()
    val talkStatusText by viewModel.talkStatusText.collectAsState()

    var voiceMode by remember { mutableStateOf(AiSyncVoiceMode.Off) }
    var showSettings by remember { mutableStateOf(false) }
    var showMoreSheet by remember { mutableStateOf(false) }

    Box(modifier = Modifier.fillMaxSize().background(AiSyncColors.base)) {
        // Full-screen canvas
        CanvasScreen(viewModel = viewModel, modifier = Modifier.fillMaxSize())

        // Voice call pill (when in call mode)
        if (voiceMode == AiSyncVoiceMode.Call) {
            VoiceCallPill(
                agentName = stringResource(R.string.brand_assistant_name),
                isSpeaking = talkIsSpeaking,
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .padding(top = 60.dp),
            )
        }

        // Walkie-talkie indicator (when in walkie-talkie mode)
        if (voiceMode == AiSyncVoiceMode.WalkieTalkie) {
            VoicePulsingDot(
                isActive = talkIsListening,
                isThinking = talkStatusText.contains("Think", ignoreCase = true),
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 140.dp),
            )
        }

        // Bottom controls
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 24.dp)
                .windowInsetsPadding(WindowInsets.navigationBars),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // 3 floating buttons
            Row(
                horizontalArrangement = Arrangement.spacedBy(24.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Settings button
                FloatingActionButton(
                    onClick = { showSettings = true },
                    modifier = Modifier.size(56.dp),
                    shape = CircleShape,
                    containerColor = AiSyncColors.floatingBg,
                    contentColor = AiSyncColors.textPrimary,
                    elevation = FloatingActionButtonDefaults.elevation(4.dp),
                ) {
                    Icon(Icons.Default.Settings, contentDescription = "Settings")
                }

                // Voice button (center, larger)
                FloatingActionButton(
                    onClick = {
                        when (voiceMode) {
                            AiSyncVoiceMode.Off -> {
                                voiceMode = AiSyncVoiceMode.WalkieTalkie
                                viewModel.setTalkEnabled(true)
                            }
                            AiSyncVoiceMode.WalkieTalkie, AiSyncVoiceMode.Call -> {
                                voiceMode = AiSyncVoiceMode.Off
                                viewModel.setTalkEnabled(false)
                            }
                        }
                    },
                    modifier = Modifier.size(72.dp),
                    shape = CircleShape,
                    containerColor = if (voiceMode != AiSyncVoiceMode.Off)
                        AiSyncColors.accent else AiSyncColors.primary,
                    contentColor = Color.White,
                    elevation = FloatingActionButtonDefaults.elevation(8.dp),
                ) {
                    Icon(
                        Icons.Default.Mic,
                        contentDescription = "Voice",
                        modifier = Modifier.size(32.dp),
                    )
                }

                // More button
                FloatingActionButton(
                    onClick = { showMoreSheet = true },
                    modifier = Modifier.size(56.dp),
                    shape = CircleShape,
                    containerColor = AiSyncColors.floatingBg,
                    contentColor = AiSyncColors.textPrimary,
                    elevation = FloatingActionButtonDefaults.elevation(4.dp),
                ) {
                    Icon(Icons.Default.GridView, contentDescription = "More")
                }
            }

            // Connection status pill
            ConnectionStatusPill(
                isConnected = isConnected,
                statusText = statusText,
            )
        }
    }

    // Settings modal
    if (showSettings) {
        ModalBottomSheet(
            onDismissRequest = { showSettings = false },
            containerColor = AiSyncColors.surface1,
        ) {
            SettingsSheet(viewModel = viewModel)
        }
    }

    // More sheet
    if (showMoreSheet) {
        ModalBottomSheet(
            onDismissRequest = { showMoreSheet = false },
            containerColor = AiSyncColors.surface1,
        ) {
            MoreSheet(
                viewModel = viewModel,
                onDismiss = { showMoreSheet = false },
            )
        }
    }
}
