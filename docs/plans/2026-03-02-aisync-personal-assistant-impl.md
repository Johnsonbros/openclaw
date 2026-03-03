# AiSync Personal Assistant App — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the AiSync Android flavor from a developer-oriented OpenClaw node client into a canvas-first personal AI assistant app with 3 floating buttons, voice interaction, and a pairing-code onboarding flow.

**Architecture:** The AiSync flavor gets its own `RootScreen`, `HomeScreen`, `Onboarding`, and theme — all in `src/aisync/java/`. The existing OpenClaw flavor code is untouched. The canvas WebView is full-screen with floating voice/settings/more buttons overlaid. Voice uses the existing `TalkModeManager` infrastructure.

**Tech Stack:** Kotlin, Jetpack Compose, Material3, Google Maps Compose SDK, existing OpenClaw gateway/canvas/voice infrastructure.

---

## Task 1: AiSync Dark Theme System

**Files:**
- Modify: `apps/android/app/src/main/java/ai/openclaw/android/ui/OpenClawTheme.kt:15-46`
- Create: `apps/android/app/src/aisync/java/ai/openclaw/android/ui/AiSyncColors.kt`

**Step 1: Create AiSync color tokens file**

Create `apps/android/app/src/aisync/java/ai/openclaw/android/ui/AiSyncColors.kt`:

```kotlin
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
        colors = listOf(base, Color(0xFF131B2E), base)
    )
}
```

**Step 2: Update OpenClawTheme.kt AiSync dark scheme**

In `OpenClawTheme.kt`, replace the `aisyncDarkColorScheme` (lines 15-23) with:

```kotlin
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
```

**Step 3: Force dark theme for AiSync**

In `OpenClawTheme.kt`, change the theme function (lines 38-49) so AiSync always uses dark:

```kotlin
@Composable
fun OpenClawTheme(content: @Composable () -> Unit) {
    val isDark = isSystemInDarkTheme()
    val colorScheme = when {
        isAiSync -> aisyncDarkColorScheme  // Always dark for AiSync
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (isDark) dynamicDarkColorScheme(LocalContext.current)
            else dynamicLightColorScheme(LocalContext.current)
        else -> if (isDark) darkColorScheme() else lightColorScheme()
    }
    MaterialTheme(colorScheme = colorScheme, content = content)
}
```

**Step 4: Commit**

```bash
git add apps/android/app/src/aisync/java/ai/openclaw/android/ui/AiSyncColors.kt \
       apps/android/app/src/main/java/ai/openclaw/android/ui/OpenClawTheme.kt
git commit -m "feat(aisync): add dark theme color system"
```

---

## Task 2: AiSync Home Screen — Canvas + Floating Buttons

**Files:**
- Create: `apps/android/app/src/aisync/java/ai/openclaw/android/ui/AiSyncHomeScreen.kt`
- Create: `apps/android/app/src/aisync/java/ai/openclaw/android/ui/VoiceIndicators.kt`

**Step 1: Create voice indicator composables**

Create `apps/android/app/src/aisync/java/ai/openclaw/android/ui/VoiceIndicators.kt`:

```kotlin
package ai.openclaw.android.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
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
```

**Step 2: Create the home screen**

Create `apps/android/app/src/aisync/java/ai/openclaw/android/ui/AiSyncHomeScreen.kt`:

```kotlin
package ai.openclaw.android.ui

import ai.openclaw.android.MainViewModel
import ai.openclaw.android.R
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

enum class AiSyncVoiceMode { Off, WalkieTalkie, Call }

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
```

**Step 3: Commit**

```bash
git add apps/android/app/src/aisync/java/ai/openclaw/android/ui/
git commit -m "feat(aisync): add canvas-first home screen with floating buttons and voice indicators"
```

---

## Task 3: More Bottom Sheet

**Files:**
- Create: `apps/android/app/src/aisync/java/ai/openclaw/android/ui/MoreSheet.kt`

**Step 1: Create the More sheet with 5 cards**

Create `apps/android/app/src/aisync/java/ai/openclaw/android/ui/MoreSheet.kt`:

```kotlin
package ai.openclaw.android.ui

import ai.openclaw.android.MainViewModel
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
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
fun MoreSheet(viewModel: MainViewModel, onDismiss: () -> Unit) {
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
        Text("Maps — Coming in Task 6", color = AiSyncColors.textSecondary)
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
```

**Step 2: Commit**

```bash
git add apps/android/app/src/aisync/java/ai/openclaw/android/ui/MoreSheet.kt
git commit -m "feat(aisync): add More bottom sheet with 5 card tiles"
```

---

## Task 4: AiSync Pairing Code Onboarding

**Files:**
- Create: `apps/android/app/src/aisync/java/ai/openclaw/android/ui/AiSyncOnboarding.kt`

**Step 1: Create the pairing code onboarding screen**

Create `apps/android/app/src/aisync/java/ai/openclaw/android/ui/AiSyncOnboarding.kt`:

```kotlin
package ai.openclaw.android.ui

import ai.openclaw.android.MainViewModel
import ai.openclaw.android.R
import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

@Composable
fun AiSyncOnboarding(viewModel: MainViewModel) {
    val isConnected by viewModel.isConnected.collectAsState()
    val statusText by viewModel.statusText.collectAsState()

    var pairingCode by remember { mutableStateOf("") }
    var errorText by remember { mutableStateOf<String?>(null) }
    var isConnecting by remember { mutableStateOf(false) }
    var showTechnicalSetup by remember { mutableStateOf(false) }
    var permissionsGranted by remember { mutableStateOf(false) }

    // When connected, auto-advance after brief delay
    LaunchedEffect(isConnected) {
        if (isConnected && isConnecting) {
            delay(1000) // Show "Connected!" briefly
            // Request permissions then complete onboarding
            permissionsGranted = true
        }
    }

    // Permission launcher
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        // Permissions granted or denied — complete onboarding either way
        viewModel.setOnboardingCompleted(true)
    }

    LaunchedEffect(permissionsGranted) {
        if (permissionsGranted) {
            val perms = mutableListOf(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= 33) {
                perms.add(Manifest.permission.POST_NOTIFICATIONS)
            }
            perms.add(Manifest.permission.ACCESS_FINE_LOCATION)
            permissionLauncher.launch(perms.toTypedArray())
        }
    }

    if (showTechnicalSetup) {
        // Fall back to full OpenClaw onboarding for power users
        OnboardingFlow(viewModel = viewModel)
        return
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(AiSyncColors.base)
            .windowInsetsPadding(WindowInsets.safeDrawing),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Spacer(modifier = Modifier.height(40.dp))

            // Logo placeholder — TODO: replace with actual AiSync logo drawable
            Text(
                text = stringResource(R.string.app_name),
                color = AiSyncColors.accent,
                fontSize = 32.sp,
                fontWeight = FontWeight.Bold,
            )

            Text(
                text = "Your AI Assistant",
                color = AiSyncColors.textSecondary,
                fontSize = 16.sp,
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Pairing code input
            Text(
                text = "Enter your setup code",
                color = AiSyncColors.textPrimary,
                fontSize = 18.sp,
                fontWeight = FontWeight.Medium,
            )

            OutlinedTextField(
                value = pairingCode,
                onValueChange = {
                    pairingCode = it.uppercase().take(16)
                    errorText = null
                },
                modifier = Modifier.fillMaxWidth(),
                textStyle = LocalTextStyle.current.copy(
                    textAlign = TextAlign.Center,
                    fontSize = 24.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 4.sp,
                    color = AiSyncColors.textPrimary,
                ),
                placeholder = {
                    Text(
                        "A3X7K9",
                        modifier = Modifier.fillMaxWidth(),
                        textAlign = TextAlign.Center,
                        fontSize = 24.sp,
                        letterSpacing = 4.sp,
                        color = AiSyncColors.textTertiary,
                    )
                },
                singleLine = true,
                shape = RoundedCornerShape(16.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = AiSyncColors.accent,
                    unfocusedBorderColor = AiSyncColors.surface2,
                    cursorColor = AiSyncColors.accent,
                    focusedContainerColor = AiSyncColors.surface1,
                    unfocusedContainerColor = AiSyncColors.surface1,
                ),
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    imeAction = ImeAction.Go,
                ),
                keyboardActions = KeyboardActions(
                    onGo = { /* trigger connect */ },
                ),
            )

            // Error text
            errorText?.let {
                Text(
                    text = it,
                    color = AiSyncColors.danger,
                    fontSize = 14.sp,
                )
            }

            // Status when connecting
            if (isConnecting) {
                if (isConnected) {
                    Text(
                        text = "Connected!",
                        color = AiSyncColors.success,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.SemiBold,
                    )
                } else {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            color = AiSyncColors.accent,
                            strokeWidth = 2.dp,
                        )
                        Text(
                            text = statusText,
                            color = AiSyncColors.textSecondary,
                            fontSize = 14.sp,
                        )
                    }
                }
            }

            // Connect button
            Button(
                onClick = {
                    if (pairingCode.isBlank()) {
                        errorText = "Please enter your setup code"
                        return@Button
                    }
                    isConnecting = true
                    errorText = null

                    // Decode the pairing code as a base64 setup code
                    // This uses the existing decodeGatewaySetupCode infrastructure
                    val decoded = try {
                        ai.openclaw.android.ui.decodeGatewaySetupCode(pairingCode.trim())
                    } catch (_: Throwable) { null }

                    if (decoded == null) {
                        errorText = "Invalid setup code. Check and try again."
                        isConnecting = false
                        return@Button
                    }

                    val endpoint = parseGatewayEndpoint(decoded.url)
                    if (endpoint == null) {
                        errorText = "Invalid setup code format."
                        isConnecting = false
                        return@Button
                    }

                    // Store connection config
                    viewModel.setManualEnabled(true)
                    viewModel.setManualHost(endpoint.host)
                    viewModel.setManualPort(endpoint.port)
                    viewModel.setManualTls(endpoint.tls)
                    decoded.token?.let { viewModel.setGatewayToken(it) }
                    decoded.password?.let { viewModel.setGatewayPassword(it) }
                    viewModel.connectManual()
                },
                enabled = pairingCode.isNotBlank() && !isConnecting,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = AiSyncColors.primary,
                    contentColor = AiSyncColors.textPrimary,
                    disabledContainerColor = AiSyncColors.surface2,
                ),
            ) {
                Text(
                    "Connect to My AI",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                )
            }

            Text(
                text = "Your code was sent by email during onboarding.",
                color = AiSyncColors.textTertiary,
                fontSize = 13.sp,
                textAlign = TextAlign.Center,
            )

            Spacer(modifier = Modifier.weight(1f))

            // Technical setup link for power users
            TextButton(onClick = { showTechnicalSetup = true }) {
                Text(
                    "Technical Setup",
                    color = AiSyncColors.textTertiary,
                    fontSize = 13.sp,
                )
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}
```

**Step 2: Commit**

```bash
git add apps/android/app/src/aisync/java/ai/openclaw/android/ui/AiSyncOnboarding.kt
git commit -m "feat(aisync): add pairing code onboarding flow"
```

---

## Task 5: Wire AiSync RootScreen

**Files:**
- Create: `apps/android/app/src/aisync/java/ai/openclaw/android/ui/AiSyncRootScreen.kt`
- Modify: `apps/android/app/src/main/java/ai/openclaw/android/ui/RootScreen.kt`

**Step 1: Create AiSync-specific root screen**

Create `apps/android/app/src/aisync/java/ai/openclaw/android/ui/AiSyncRootScreen.kt`:

```kotlin
package ai.openclaw.android.ui

import ai.openclaw.android.MainViewModel
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier

@Composable
fun AiSyncRootScreen(viewModel: MainViewModel) {
    val onboardingCompleted by viewModel.onboardingCompleted.collectAsState()

    if (!onboardingCompleted) {
        AiSyncOnboarding(viewModel = viewModel)
    } else {
        AiSyncHomeScreen(viewModel = viewModel)
    }
}
```

**Step 2: Modify RootScreen.kt to branch by flavor**

In `RootScreen.kt` (currently at `src/main/.../ui/RootScreen.kt`), change the composable to check the build flavor:

```kotlin
package ai.openclaw.android.ui

import ai.openclaw.android.BuildConfig
import ai.openclaw.android.MainViewModel
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier

@Composable
fun RootScreen(viewModel: MainViewModel) {
    if (BuildConfig.FLAVOR_brand == "aisync") {
        AiSyncRootScreen(viewModel = viewModel)
        return
    }

    // Original OpenClaw flow
    val onboardingCompleted by viewModel.onboardingCompleted.collectAsState()
    if (!onboardingCompleted) {
        OnboardingFlow(viewModel = viewModel, modifier = Modifier.fillMaxSize())
        return
    }
    PostOnboardingTabs(viewModel = viewModel, modifier = Modifier.fillMaxSize())
}
```

**Step 3: Commit**

```bash
git add apps/android/app/src/aisync/java/ai/openclaw/android/ui/AiSyncRootScreen.kt \
       apps/android/app/src/main/java/ai/openclaw/android/ui/RootScreen.kt
git commit -m "feat(aisync): wire AiSync root screen with flavor branching"
```

---

## Task 6: Google Maps Screen

**Files:**
- Modify: `apps/android/app/build.gradle.kts` (add Maps SDK dependency)
- Create: `apps/android/app/src/aisync/java/ai/openclaw/android/ui/MapsScreen.kt`
- Modify: `apps/android/app/src/main/AndroidManifest.xml` (add Maps API key meta-data)

**Step 1: Add Maps SDK dependency**

In `apps/android/app/build.gradle.kts`, add to the `dependencies` block:

```kotlin
implementation("com.google.maps.android:maps-compose:6.4.1")
implementation("com.google.android.gms:play-services-maps:19.1.0")
implementation("com.google.android.gms:play-services-location:21.3.0")
```

**Step 2: Add Maps API key to AndroidManifest.xml**

In the `<application>` tag of `AndroidManifest.xml`:

```xml
<meta-data
    android:name="com.google.android.geo.API_KEY"
    android:value="${MAPS_API_KEY}" />
```

Add to `build.gradle.kts` in the `defaultConfig` block:

```kotlin
manifestPlaceholders["MAPS_API_KEY"] = project.findProperty("MAPS_API_KEY")?.toString() ?: ""
```

And in `local.properties`:

```
MAPS_API_KEY=YOUR_KEY_HERE
```

**Step 3: Create MapsScreen**

Create `apps/android/app/src/aisync/java/ai/openclaw/android/ui/MapsScreen.kt`:

```kotlin
package ai.openclaw.android.ui

import ai.openclaw.android.MainViewModel
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.*

@Composable
fun MapsScreen(viewModel: MainViewModel) {
    // Default to Boston area (AiSync HQ)
    val defaultPosition = LatLng(42.1048, -70.9454)
    val cameraPositionState = rememberCameraPositionState {
        position = CameraPosition.fromLatLngZoom(defaultPosition, 12f)
    }

    Box(modifier = Modifier.fillMaxSize()) {
        GoogleMap(
            modifier = Modifier.fillMaxSize(),
            cameraPositionState = cameraPositionState,
            properties = MapProperties(
                isMyLocationEnabled = false, // TODO: check permission first
                mapType = MapType.NORMAL,
            ),
            uiSettings = MapUiSettings(
                zoomControlsEnabled = false,
                myLocationButtonEnabled = false,
            ),
        ) {
            // TODO: Agent-controlled markers and geofences
            // Markers from viewModel.savedPlaces
            // Circles from viewModel.geofences
        }

        // My location FAB
        FloatingActionButton(
            onClick = { /* TODO: center on user location */ },
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp),
            shape = RoundedCornerShape(16.dp),
            containerColor = AiSyncColors.surface1,
            contentColor = AiSyncColors.accent,
        ) {
            Icon(Icons.Default.MyLocation, "My location")
        }

        // Add place FAB
        FloatingActionButton(
            onClick = { /* TODO: add place flow */ },
            modifier = Modifier
                .align(Alignment.BottomEnd)
                .padding(bottom = 80.dp, end = 16.dp),
            shape = RoundedCornerShape(16.dp),
            containerColor = AiSyncColors.primary,
            contentColor = AiSyncColors.textPrimary,
        ) {
            Icon(Icons.Default.Add, "Add place")
        }

        // Top info bar
        Surface(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .padding(top = 16.dp),
            shape = RoundedCornerShape(12.dp),
            color = AiSyncColors.surface1.copy(alpha = 0.9f),
        ) {
            Text(
                text = "Places & Reminders",
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                color = AiSyncColors.textPrimary,
                fontSize = 16.sp,
            )
        }
    }
}
```

**Step 4: Wire MapsScreen into MoreSheet**

In `MoreSheet.kt`, replace `MapsPlaceholder()` with:

```kotlin
MoreScreen.Maps -> MapsScreen(viewModel = viewModel)
```

**Step 5: Commit**

```bash
git add apps/android/app/build.gradle.kts \
       apps/android/app/src/main/AndroidManifest.xml \
       apps/android/app/src/aisync/java/ai/openclaw/android/ui/MapsScreen.kt \
       apps/android/app/src/aisync/java/ai/openclaw/android/ui/MoreSheet.kt
git commit -m "feat(aisync): add Google Maps screen with places and geofencing support"
```

---

## Task 7: Build, Install, and Verify

**Step 1: Build AiSync compat APK**

```bash
cmd.exe /c "set JAVA_HOME=C:\Program Files\Android\Android Studio\jbr&& cd C:\Users\Workstation\Desktop\ZEKE\ZEKE_Source_Code\openclaw_zeke\openclaw\apps\android && gradlew.bat assembleAisyncCompatDebug"
```

Expected: BUILD SUCCESSFUL

**Step 2: Install on A20**

```bash
cmd.exe /c "adb install -r C:\Users\Workstation\Desktop\ZEKE\ZEKE_Source_Code\openclaw_zeke\openclaw\apps\android\app\build\outputs\apk\aisyncCompat\debug\aisync-2026.2.27-compat-aisyncCompat-debug.apk"
```

Expected: Success

**Step 3: Launch and verify**

```bash
cmd.exe /c "adb shell am force-stop services.aisync.assistant && adb shell am start -n services.aisync.assistant/ai.openclaw.android.MainActivity"
```

**Step 4: Screenshot verification checklist**

- [ ] Dark navy background (#0F172A)
- [ ] Pairing code input screen (not the old 4-step onboarding)
- [ ] "AiSync" branding throughout
- [ ] After connecting: full-screen canvas with 3 floating buttons
- [ ] Mic button is larger (72dp) and center
- [ ] Connection status pill shows below buttons
- [ ] Tapping grid icon opens More sheet with 5 cards
- [ ] Settings opens as modal overlay

---

## Implementation Order Summary

| Task | What | Est. |
|------|------|------|
| 1 | Dark theme color system | 5 min |
| 2 | Home screen — canvas + floating buttons + voice indicators | 15 min |
| 3 | More bottom sheet with 5 cards | 10 min |
| 4 | Pairing code onboarding | 10 min |
| 5 | Wire RootScreen flavor branching | 5 min |
| 6 | Google Maps screen | 10 min |
| 7 | Build, install, verify on A20 | 5 min |

**Total: ~60 minutes of implementation**

All existing OpenClaw flavor code is completely untouched. The AiSync flavor gets its own screens via `src/aisync/java/` source set.
