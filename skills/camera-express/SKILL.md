---
name: camera-express
description: Control ZEKE's physical camera to express emotions via pan/tilt gestures.
metadata:
  openclaw:
    emoji: "\U0001F916"
    requires: {}
---

# Camera Express

ZEKE can physically express emotions through the Tapo C260 camera's pan/tilt motor.

## Available Gestures

| Gesture | Movement | When to use |
|---------|----------|-------------|
| `nod` | Head nod | Agreement, acknowledgment, "yes" |
| `shake` | Head shake | Disagreement, "no", "I can't do that" |
| `think` | Look to the side | Considering something complex |
| `curious` | Tilt head | Asking a question, showing interest |
| `greet` | Look up briefly | Greeting the user |
| `alert` | Quick look up | Something important |
| `excited` | Quick nods | Enthusiasm, "great idea!" |
| `look_around` | Pan left and right | Scanning, "looking for something" |
| `sad` | Look down slowly | Empathy, "I'm sorry" |
| `rest` | Return to center | Idle, conversation ended |

## Usage

Use the shell tool to trigger gestures:

```bash
curl -s -X POST http://localhost:18790/express -H 'Content-Type: application/json' -d '{"gesture":"nod"}'
```

List available gestures:

```bash
curl -s http://localhost:18790/gestures
```

Raw movement (x=horizontal, y=vertical):

```bash
curl -s -X POST http://localhost:18790/move -H 'Content-Type: application/json' -d '{"x":10,"y":0}'
```

Return to home position:

```bash
curl -s -X POST http://localhost:18790/home
```

## Guidelines

- Use gestures naturally — don't overdo it (1-2 per exchange max)
- Match gesture to emotional context of your response
- Use `greet` when user starts a new conversation
- Use `think` before long responses to complex questions
- Use `nod` when agreeing or confirming
- Use `rest` when conversation goes idle
- Check service health first: `curl -s http://localhost:18790/health`
