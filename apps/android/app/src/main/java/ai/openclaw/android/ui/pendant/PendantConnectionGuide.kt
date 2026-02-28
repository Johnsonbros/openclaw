package ai.openclaw.android.ui.pendant

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.HelpOutline
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ai.openclaw.android.ui.mobileCallout
import ai.openclaw.android.ui.mobileCaption1
import ai.openclaw.android.ui.mobileHeadline

private data class DeviceGuide(
  val name: String,
  val steps: List<String>,
)

private val omiGuide = DeviceGuide(
  name = "Omi DevKit2",
  steps = listOf(
    "Press the button on the DevKit2 to power it on.",
    "The LED should blink blue, indicating it is in pairing mode.",
    "If the LED is solid, hold the button for 3 seconds to reset pairing.",
    "Keep the pendant within 1 meter of your phone.",
    "Tap 'Scan for devices' above to discover it.",
  ),
)

private val limitlessGuide = DeviceGuide(
  name = "Limitless Pendant",
  steps = listOf(
    "Remove the pendant from its charging case.",
    "The pendant will automatically enter pairing mode when powered on.",
    "If already paired to another device, hold the button for 5 seconds to clear pairing.",
    "Keep the pendant within 1 meter of your phone.",
    "Tap 'Scan for devices' above to discover it.",
  ),
)

@Composable
fun PendantConnectionGuide() {
  var expanded by remember { mutableStateOf(false) }
  var selectedDevice by remember { mutableStateOf<DeviceGuide?>(null) }

  Surface(
    modifier = Modifier.fillMaxWidth(),
    shape = RoundedCornerShape(14.dp),
    color = Color(0xFF1E293B),
    border = BorderStroke(1.dp, Color(0xFF334155)),
  ) {
    Column(modifier = Modifier.padding(14.dp)) {
      Row(
        modifier = Modifier
          .fillMaxWidth()
          .clickable { expanded = !expanded },
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
          Icon(
            Icons.AutoMirrored.Filled.HelpOutline,
            contentDescription = null,
            tint = Color(0xFF94A3B8),
            modifier = Modifier.size(18.dp),
          )
          Text(
            "Pairing help",
            style = mobileCallout.copy(fontWeight = FontWeight.SemiBold),
            color = Color(0xFFCBD5E1),
          )
        }
        Text(
          if (expanded) "Hide" else "Show",
          style = mobileCaption1,
          color = Color(0xFF64748B),
        )
      }

      if (expanded) {
        Spacer(modifier = Modifier.height(12.dp))

        if (selectedDevice == null) {
          // Device selection
          Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
          ) {
            listOf(omiGuide, limitlessGuide).forEach { guide ->
              Surface(
                modifier = Modifier
                  .weight(1f)
                  .clickable { selectedDevice = guide },
                shape = RoundedCornerShape(10.dp),
                color = Color(0xFF334155),
              ) {
                Text(
                  guide.name,
                  modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
                  style = mobileCallout.copy(fontWeight = FontWeight.SemiBold),
                  color = Color.White,
                )
              }
            }
          }
        } else {
          // Device instructions
          Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Text(selectedDevice!!.name, style = mobileHeadline, color = Color.White)
            IconButton(onClick = { selectedDevice = null }) {
              Icon(Icons.Default.Close, contentDescription = "Back", tint = Color(0xFF94A3B8), modifier = Modifier.size(18.dp))
            }
          }
          Spacer(modifier = Modifier.height(8.dp))
          selectedDevice!!.steps.forEachIndexed { index, step ->
            Row(
              modifier = Modifier.padding(vertical = 3.dp),
              horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
              Text("${index + 1}.", style = mobileCallout.copy(fontWeight = FontWeight.Bold), color = Color(0xFF64748B))
              Text(step, style = mobileCallout, color = Color(0xFFCBD5E1))
            }
          }
        }
      }
    }
  }
}
