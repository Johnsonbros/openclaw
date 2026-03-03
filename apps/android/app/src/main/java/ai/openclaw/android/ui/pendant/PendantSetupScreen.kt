package ai.openclaw.android.ui.pendant

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.BluetoothSearching
import androidx.compose.material.icons.filled.Bluetooth
import androidx.compose.material.icons.filled.BluetoothConnected
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.SignalCellular4Bar
import androidx.compose.material.icons.filled.SignalCellularAlt
import androidx.compose.material.icons.filled.SignalCellularAlt1Bar
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import ai.openclaw.android.MainViewModel
import ai.openclaw.android.ble.PendantBleManager
import ai.openclaw.android.ui.mobileAccent
import ai.openclaw.android.ui.mobileAccentSoft
import ai.openclaw.android.ui.mobileBorder
import ai.openclaw.android.ui.mobileCallout
import ai.openclaw.android.ui.mobileCaption1
import ai.openclaw.android.ui.mobileDanger
import ai.openclaw.android.ui.mobileHeadline
import ai.openclaw.android.ui.mobileSurface
import ai.openclaw.android.ui.mobileText
import ai.openclaw.android.ui.mobileTextSecondary
import ai.openclaw.android.ui.mobileTitle2

private val pendantDarkBg = Brush.verticalGradient(
  listOf(Color(0xFF0F172A), Color(0xFF1E293B)),
)

@Composable
fun PendantSetupScreen(viewModel: MainViewModel) {
  val context = LocalContext.current
  val connectionState by viewModel.bleManager.connectionState.collectAsState()
  val discoveredPendants by viewModel.bleManager.discoveredPendants.collectAsState()
  val connectedPendant by viewModel.bleManager.connectedPendant.collectAsState()
  val pendantEnabled by viewModel.pendantEnabled.collectAsState()

  val blePermissionLauncher = rememberLauncherForActivityResult(
    ActivityResultContracts.RequestMultiplePermissions(),
  ) { results ->
    if (results.values.all { it }) {
      viewModel.setPendantEnabled(true)
      viewModel.startPendantScan()
    }
  }

  Column(
    modifier = Modifier
      .fillMaxSize()
      .background(pendantDarkBg)
      .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Bottom))
      .padding(horizontal = 20.dp, vertical = 14.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    // Header
    Text(
      "PENDANT",
      style = mobileCaption1.copy(fontWeight = FontWeight.Bold, letterSpacing = 1.sp),
      color = Color(0xFF94A3B8),
    )
    Spacer(modifier = Modifier.height(4.dp))
    Text(
      "Connect your pendant",
      style = mobileTitle2,
      color = Color.White,
    )
    Spacer(modifier = Modifier.height(20.dp))

    when (connectionState) {
      PendantBleManager.ConnectionState.CONNECTED -> {
        // Connected state
        ConnectedView(
          pendant = connectedPendant,
          onDisconnect = { viewModel.disconnectPendant() },
        )
      }
      PendantBleManager.ConnectionState.SCANNING -> {
        // Scanning animation
        ScanningView(discoveredPendants = discoveredPendants) { address ->
          viewModel.connectPendant(address)
        }
      }
      PendantBleManager.ConnectionState.CONNECTING -> {
        // Connecting state
        Box(
          modifier = Modifier.weight(1f),
          contentAlignment = Alignment.Center,
        ) {
          Column(horizontalAlignment = Alignment.CenterHorizontally) {
            ScanningRipple(ringColor = mobileAccent, size = 160.dp)
            Spacer(modifier = Modifier.height(16.dp))
            Text("Connecting…", style = mobileHeadline, color = Color.White)
          }
        }
      }
      PendantBleManager.ConnectionState.DISCONNECTED -> {
        // Device type selector + scan button
        DisconnectedView(
          onScan = {
            val hasBle = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
              ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
            } else {
              // Pre-Android 12: BLE scanning requires ACCESS_FINE_LOCATION
              ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            }
            if (hasBle) {
              if (!pendantEnabled) viewModel.setPendantEnabled(true)
              viewModel.startPendantScan()
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
              blePermissionLauncher.launch(
                arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT),
              )
            } else {
              blePermissionLauncher.launch(
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION),
              )
            }
          },
        )
      }
    }
  }
}

@Composable
private fun DisconnectedView(onScan: () -> Unit) {
  Column(
    modifier = Modifier.fillMaxWidth(),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(16.dp),
  ) {
    Spacer(modifier = Modifier.height(12.dp))

    // Device type cards
    Text(
      "Supported devices",
      style = mobileCallout.copy(fontWeight = FontWeight.SemiBold),
      color = Color(0xFF94A3B8),
    )

    Row(
      modifier = Modifier.fillMaxWidth(),
      horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
      DeviceTypeCard(
        modifier = Modifier.weight(1f),
        name = "Omi DevKit2",
        icon = Icons.Default.Bluetooth,
      )
      DeviceTypeCard(
        modifier = Modifier.weight(1f),
        name = "Limitless",
        icon = Icons.Default.Bluetooth,
      )
    }

    Spacer(modifier = Modifier.height(8.dp))

    Button(
      onClick = onScan,
      modifier = Modifier.fillMaxWidth().height(52.dp),
      shape = RoundedCornerShape(14.dp),
      colors = ButtonDefaults.buttonColors(
        containerColor = mobileAccent,
        contentColor = Color.White,
      ),
    ) {
      Icon(Icons.AutoMirrored.Filled.BluetoothSearching, contentDescription = null, modifier = Modifier.size(20.dp))
      Spacer(modifier = Modifier.size(8.dp))
      Text("Scan for devices", style = mobileCallout.copy(fontWeight = FontWeight.Bold))
    }

    PendantConnectionGuide()
  }
}

@Composable
private fun DeviceTypeCard(
  modifier: Modifier = Modifier,
  name: String,
  icon: ImageVector,
) {
  Surface(
    modifier = modifier,
    shape = RoundedCornerShape(16.dp),
    color = Color(0xFF1E293B),
    border = BorderStroke(1.dp, Color(0xFF334155)),
  ) {
    Column(
      modifier = Modifier.padding(16.dp),
      horizontalAlignment = Alignment.CenterHorizontally,
      verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
      Surface(
        shape = CircleShape,
        color = Color(0xFF334155),
        modifier = Modifier.size(56.dp),
      ) {
        Box(contentAlignment = Alignment.Center) {
          Icon(icon, contentDescription = name, tint = mobileAccent, modifier = Modifier.size(28.dp))
        }
      }
      Text(name, style = mobileCallout.copy(fontWeight = FontWeight.SemiBold), color = Color.White)
    }
  }
}

@Composable
private fun ScanningView(
  discoveredPendants: List<PendantBleManager.PendantInfo>,
  onConnect: (String) -> Unit,
) {
  Column(
    modifier = Modifier.fillMaxWidth(),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    Box(
      modifier = Modifier.height(180.dp),
      contentAlignment = Alignment.Center,
    ) {
      ScanningRipple(ringColor = Color.White, size = 160.dp)
      Icon(
        Icons.AutoMirrored.Filled.BluetoothSearching,
        contentDescription = null,
        tint = Color.White,
        modifier = Modifier.size(36.dp),
      )
    }
    Text("Searching for devices…", style = mobileCallout, color = Color(0xFF94A3B8))

    if (discoveredPendants.isNotEmpty()) {
      Spacer(modifier = Modifier.height(4.dp))
      Text(
        "${discoveredPendants.size} device${if (discoveredPendants.size > 1) "s" else ""} found",
        style = mobileCaption1.copy(fontWeight = FontWeight.SemiBold),
        color = mobileAccent,
      )

      LazyColumn(
        modifier = Modifier.fillMaxWidth().heightIn(max = 300.dp),
        contentPadding = PaddingValues(vertical = 4.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
      ) {
        items(discoveredPendants, key = { it.address }) { pendant ->
          DiscoveredPendantCard(pendant = pendant, onConnect = { onConnect(pendant.address) })
        }
      }
    }
  }
}

@Composable
private fun DiscoveredPendantCard(
  pendant: PendantBleManager.PendantInfo,
  onConnect: () -> Unit,
) {
  Surface(
    modifier = Modifier.fillMaxWidth(),
    shape = RoundedCornerShape(14.dp),
    color = Color(0xFF1E293B),
    border = BorderStroke(1.dp, Color(0xFF334155)),
  ) {
    Row(
      modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 12.dp),
      horizontalArrangement = Arrangement.SpaceBetween,
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(pendant.name, style = mobileCallout.copy(fontWeight = FontWeight.SemiBold), color = Color.White)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
          Text(pendant.type.name, style = mobileCaption1, color = Color(0xFF94A3B8))
          RssiIndicator(rssi = pendant.rssi)
        }
      }
      Button(
        onClick = onConnect,
        shape = RoundedCornerShape(10.dp),
        colors = ButtonDefaults.buttonColors(containerColor = mobileAccent, contentColor = Color.White),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
      ) {
        Text("Connect", style = mobileCaption1.copy(fontWeight = FontWeight.Bold))
      }
    }
  }
}

@Composable
private fun RssiIndicator(rssi: Int) {
  val icon = when {
    rssi > -60 -> Icons.Default.SignalCellular4Bar
    rssi > -80 -> Icons.Default.SignalCellularAlt
    else -> Icons.Default.SignalCellularAlt1Bar
  }
  val color = when {
    rssi > -60 -> Color(0xFF22C55E)
    rssi > -80 -> Color(0xFFEAB308)
    else -> Color(0xFFEF4444)
  }
  Icon(icon, contentDescription = "RSSI $rssi", tint = color, modifier = Modifier.size(14.dp))
}

@Composable
private fun ConnectedView(
  pendant: PendantBleManager.PendantInfo?,
  onDisconnect: () -> Unit,
) {
  Column(
    modifier = Modifier.fillMaxWidth(),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.spacedBy(16.dp),
  ) {
    Spacer(modifier = Modifier.height(24.dp))

    // Connected icon
    Surface(
      shape = CircleShape,
      color = Color(0xFF166534),
      modifier = Modifier.size(80.dp),
    ) {
      Box(contentAlignment = Alignment.Center) {
        Icon(Icons.Default.BluetoothConnected, contentDescription = null, tint = Color(0xFF22C55E), modifier = Modifier.size(36.dp))
      }
    }

    // Connected badge
    Surface(
      shape = RoundedCornerShape(999.dp),
      color = Color(0xFF166534),
    ) {
      Row(
        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Icon(Icons.Default.Check, contentDescription = null, tint = Color(0xFF22C55E), modifier = Modifier.size(14.dp))
        Text("Connected", style = mobileCaption1.copy(fontWeight = FontWeight.Bold), color = Color(0xFF22C55E))
      }
    }

    Text(
      pendant?.name ?: "Pendant",
      style = mobileTitle2,
      color = Color.White,
    )
    Text(
      pendant?.type?.name ?: "",
      style = mobileCallout,
      color = Color(0xFF94A3B8),
    )

    Spacer(modifier = Modifier.height(16.dp))

    Button(
      onClick = onDisconnect,
      modifier = Modifier.fillMaxWidth(),
      shape = RoundedCornerShape(14.dp),
      colors = ButtonDefaults.buttonColors(
        containerColor = Color(0xFF7F1D1D),
        contentColor = Color(0xFFFCA5A5),
      ),
    ) {
      Text("Disconnect", style = mobileCallout.copy(fontWeight = FontWeight.Bold))
    }
  }
}
