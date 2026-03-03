package ai.openclaw.android.ui

import ai.openclaw.android.MainViewModel
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier

@Composable
fun RootScreen(viewModel: MainViewModel) {
  // Flavor-specific entry point (overridden in aisync source set)
  if (BrandEntryPoint(viewModel = viewModel)) return

  // Default OpenClaw flow
  val onboardingCompleted by viewModel.onboardingCompleted.collectAsState()
  if (!onboardingCompleted) {
    OnboardingFlow(viewModel = viewModel, modifier = Modifier.fillMaxSize())
    return
  }
  PostOnboardingTabs(viewModel = viewModel, modifier = Modifier.fillMaxSize())
}
