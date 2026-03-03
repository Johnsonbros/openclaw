package ai.openclaw.android.ui

import ai.openclaw.android.MainViewModel
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue

@Composable
fun AiSyncRootScreen(viewModel: MainViewModel) {
    val onboardingCompleted by viewModel.onboardingCompleted.collectAsState()

    if (!onboardingCompleted) {
        AiSyncOnboarding(viewModel = viewModel)
    } else {
        AiSyncHomeScreen(viewModel = viewModel)
    }
}
