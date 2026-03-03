package ai.openclaw.android.ui

import ai.openclaw.android.MainViewModel
import ai.openclaw.android.R
import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
            permissionsGranted = true
        }
    }

    // Permission launcher
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) {
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
                    pairingCode = it.uppercase().take(64)
                    errorText = null
                },
                modifier = Modifier.fillMaxWidth(),
                textStyle = LocalTextStyle.current.copy(
                    textAlign = TextAlign.Center,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 2.sp,
                    color = AiSyncColors.textPrimary,
                ),
                placeholder = {
                    Text(
                        "Paste setup code here",
                        modifier = Modifier.fillMaxWidth(),
                        textAlign = TextAlign.Center,
                        fontSize = 16.sp,
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
                    onGo = { /* trigger connect via button click */ },
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
                    val decoded = try {
                        decodeGatewaySetupCode(pairingCode.trim())
                    } catch (_: Throwable) {
                        null
                    }

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
