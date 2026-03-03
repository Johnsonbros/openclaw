package ai.openclaw.android.ui

import ai.openclaw.android.MainViewModel
import androidx.compose.runtime.Composable

/** AiSync flavor — uses the AiSync-specific root screen. */
@Composable
fun BrandEntryPoint(viewModel: MainViewModel): Boolean {
    AiSyncRootScreen(viewModel = viewModel)
    return true
}
