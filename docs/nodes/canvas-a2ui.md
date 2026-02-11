---
summary: "Canvas and A2UI architecture: WebView UI system for agent-controlled interfaces on nodes"
read_when:
  - Implementing Canvas WebView on iOS/Android
  - Building A2UI interfaces for agents
  - Understanding the action bridge between WebView and native
  - Debugging Canvas rendering or communication
title: "Canvas and A2UI"
---

# Canvas and A2UI

Canvas is a WebView-based UI system that allows the AI to display custom interfaces
on connected nodes (phones, tablets, macOS). A2UI is a Lit.js framework for building
these interfaces declaratively.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         AI Agent                             │
│                    (canvas tool calls)                       │
└──────────────────────┬───────────────────────────────────────┘
                       │ action: present/navigate/eval/snapshot/a2ui_push
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                      Gateway Server                          │
│                   (node.invoke command)                      │
│                                                              │
│  Canvas Host: http://<gateway>:18793/__openclaw__/a2ui/     │
└──────────────────────┬───────────────────────────────────────┘
                       │ canvas.present / canvas.navigate / etc.
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                    Node (Android/iOS/macOS)                  │
│                      ┌─────────────────┐                     │
│                      │    WebView      │                     │
│                      │  ┌───────────┐  │                     │
│                      │  │   A2UI    │  │                     │
│                      │  │ (Lit.js)  │  │                     │
│                      │  └───────────┘  │                     │
│                      └─────────────────┘                     │
│                             ▲                                │
│                    Action Bridge                             │
│            iOS: webkit.messageHandlers                       │
│            Android: window.openclawCanvasA2UIAction          │
└──────────────────────────────────────────────────────────────┘
```

## Canvas Tool

The AI controls Canvas via the `canvas` tool with these actions:

| Action       | Description                   | Parameters                                  |
| ------------ | ----------------------------- | ------------------------------------------- |
| `present`    | Show the Canvas WebView       | `target` (URL), `x`, `y`, `width`, `height` |
| `hide`       | Hide the Canvas WebView       | -                                           |
| `navigate`   | Load a URL in Canvas          | `url`                                       |
| `eval`       | Execute JavaScript in WebView | `javaScript`                                |
| `snapshot`   | Capture Canvas as image       | `outputFormat`, `maxWidth`, `quality`       |
| `a2ui_push`  | Push A2UI JSONL data          | `jsonl` or `jsonlPath`                      |
| `a2ui_reset` | Reset A2UI state              | -                                           |

### Examples

```bash
# Show Canvas with A2UI
openclaw nodes canvas present --node <id> --target "/__openclaw__/a2ui"

# Push A2UI data
openclaw nodes canvas a2ui push --node <id> --text "Hello World"
openclaw nodes canvas a2ui push --node <id> --jsonl ./ui-data.jsonl

# Execute JavaScript
openclaw nodes canvas eval --node <id> --js "document.title"

# Take screenshot
openclaw nodes canvas snapshot --node <id> --format png
```

## A2UI Framework

A2UI is a Lit.js-based UI framework that renders interfaces from JSONL data.

### A2UI Host URL

The Gateway serves A2UI at:

```
http://<gateway-host>:<port>/__openclaw__/a2ui/
```

### JSONL Format (v0.8)

A2UI accepts JSONL messages:

```jsonl
{"surfaceUpdate":{"surfaceId":"main","components":[...]}}
{"beginRendering":{"surfaceId":"main","root":"root"}}
```

Example - Simple text display:

```jsonl
{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"root","component":{"Column":{"children":{"explicitList":["title"]}}}},{"id":"title","component":{"Text":{"text":{"literalString":"Hello from A2UI"},"usageHint":"h1"}}}]}}
{"beginRendering":{"surfaceId":"main","root":"root"}}
```

### Component Types

A2UI supports these component types:

- `Text` - Text display with usage hints (h1, body, etc.)
- `Column` - Vertical layout
- `Row` - Horizontal layout
- `Button` - Interactive button
- `Image` - Image display
- `List` - Scrollable list
- `Card` - Card container

## Action Bridge

The Gateway injects a cross-platform action bridge into all Canvas HTML pages.
This enables communication from WebView JavaScript back to the native app.

### JavaScript API

```javascript
// Send any data to native app
OpenClaw.postMessage({ type: "custom", data: {...} });
window.openclawPostMessage({ type: "custom", data: {...} });

// Send user action (auto-generates ID)
OpenClaw.sendUserAction({ type: "button_click", buttonId: "submit" });
window.openclawSendUserAction({ type: "item_selected", itemId: "123" });
```

### Platform Handlers

The bridge automatically detects the platform:

| Platform | Handler                                                                   |
| -------- | ------------------------------------------------------------------------- |
| iOS      | `window.webkit.messageHandlers.openclawCanvasA2UIAction.postMessage(...)` |
| Android  | `window.openclawCanvasA2UIAction.postMessage(...)`                        |

### Android Implementation

In Android, expose a JavaScript interface:

```kotlin
class CanvasA2UIBridge(private val onAction: (String) -> Unit) {
    @JavascriptInterface
    fun postMessage(payload: String) {
        onAction(payload)
    }
}

// Add to WebView
webView.addJavascriptInterface(
    CanvasA2UIBridge { payload ->
        // Handle action from WebView
        handleCanvasAction(JSONObject(payload))
    },
    "openclawCanvasA2UIAction"
)
```

### iOS Implementation

In iOS, use WKScriptMessageHandler:

```swift
class CanvasMessageHandler: NSObject, WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "openclawCanvasA2UIAction",
              let payload = message.body as? String else { return }
        handleCanvasAction(payload)
    }
}

// Add to WKWebView configuration
let config = WKWebViewConfiguration()
config.userContentController.add(handler, name: "openclawCanvasA2UIAction")
```

## Live Reload

The Gateway includes WebSocket-based live reload for development:

1. WebSocket connects to `ws://<gateway>/__openclaw__/ws`
2. On file changes, server sends `"reload"` message
3. Canvas page automatically refreshes

This is injected automatically for HTML pages served from the A2UI host.

## Canvas Commands (Node Protocol)

Nodes must implement these commands for Canvas support:

| Command                 | Description    | Parameters                        |
| ----------------------- | -------------- | --------------------------------- |
| `canvas.present`        | Show Canvas    | `url?`, `placement?`              |
| `canvas.hide`           | Hide Canvas    | -                                 |
| `canvas.navigate`       | Load URL       | `url`                             |
| `canvas.eval`           | Execute JS     | `javaScript`                      |
| `canvas.snapshot`       | Capture image  | `format`, `maxWidth?`, `quality?` |
| `canvas.a2ui.pushJSONL` | Push A2UI data | `jsonl`                           |
| `canvas.a2ui.reset`     | Reset A2UI     | -                                 |

### Response Format

```json
{
  "success": true,
  "payload": {
    "result": "..." // For canvas.eval
  }
}
```

### Snapshot Response

```json
{
  "success": true,
  "payload": {
    "format": "png",
    "base64": "iVBORw0KGgoAAAANSUhEUgAA..."
  }
}
```

## What Runs Where

| Component      | Location            | Purpose                        |
| -------------- | ------------------- | ------------------------------ |
| Canvas Tool    | Gateway             | AI interface to control Canvas |
| A2UI Assets    | Gateway HTTP server | Serves framework files         |
| A2UI Host      | Gateway             | Serves at `/__openclaw__/a2ui` |
| Action Bridge  | Gateway (injected)  | Cross-platform JS bridge       |
| WebView        | Node (Android/iOS)  | Renders the UI                 |
| Native Handler | Node (Kotlin/Swift) | Receives actions from JS       |

## Security Notes

- Canvas scheme blocks directory traversal
- Files must live under the session/A2UI root
- External URLs only allowed when explicitly navigated
- Action bridge uses message handlers (not eval injection)

## Debugging

### Check A2UI availability

```bash
curl http://localhost:18793/__openclaw__/a2ui/
```

### Test Canvas commands

```bash
# Present Canvas
openclaw nodes invoke --node <id> --command canvas.present --params '{}'

# Check if WebView is loaded
openclaw nodes invoke --node <id> --command canvas.eval \
  --params '{"javaScript":"document.readyState"}'
```

### Common issues

1. **Canvas not showing**: Check node is foregrounded (background unavailable)
2. **A2UI not rendering**: Verify JSONL format matches v0.8 spec
3. **Actions not received**: Confirm JavaScript interface is registered in WebView
4. **Snapshot fails**: Canvas must be visible and fully rendered
