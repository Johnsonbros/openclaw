package ai.openclaw.android.ui

import ai.openclaw.android.MainViewModel
import androidx.compose.runtime.Composable

/** OpenClaw flavor — no custom entry point, fall through to default RootScreen flow. */
@Composable
fun BrandEntryPoint(
    @Suppress("UNUSED_PARAMETER") viewModel: MainViewModel,
): Boolean = false
