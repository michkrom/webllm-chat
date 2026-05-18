# WebLLM Chat with Tool Calling

A chat application that implements the OpenAI tool calling protocol with fallback to structural tag approach for tool use.

This project combines the `simple-chat-ts` and `chat-with-tool-calling` examples from the WebLLM repository, implementing the OpenAI tool calling protocol with automatic fallback to structural tag generation.

## Features

- **OpenAI Tool Calling Protocol** — Implements the standard OpenAI `tools` and `tool_choice` API
  - Falls back to structural tag generation when OpenAI-style parsing fails
  - Remembers the working mode per model for subsequent requests

- **Multiple Tool Calling Modes**:
  - **OpenAI Style**: Uses `tools` and `tool_choice` fields (works with Hermes, Llama-3.1+, Qwen3 series)
  - **Structural Tag**: Uses grammar-guided generation for reliable tool call output (works with any model)
  - **Auto Mode**: Tries OpenAI style first, falls back to structural on failure, remembers the working mode

- **Full Chat UI**: Based on the simple-chat-ts example
- **Built-in Browser Tools**: `get_location` (geolocation API) and `get_time` (browser time)

## Getting Started

### Prerequisites

- Node.js (v18+ recommended)
- npm or yarn

### Installation

```bash
npm install
```

### Development

```bash
npm start
```

Open http://localhost:8085 in your browser.

### Build for Production

```bash
npm run build
```

## Task Automation (Optional)

This project includes [Invoke](https://www.pyinvoke.org/) tasks for common operations. Install it first if you want to use them:

```bash
pip install invoke
```

Then you can use:

```bash
inv init        # Install dependencies
inv build       # Build production bundle
inv serve       # Serve built files (default port 8085)
inv dev         # Start dev server with hot reload
inv clean       # Remove build artifacts
```

## Built-in Tools

### `/time [timezone]`
Returns the current date and time:
- Returns `date`, `time`
- Defaults to your browser's detected timezone

### `/location`
Uses the browser's Geolocation API to get your current city/country:
- Returns `city`, `country`, `display_name`

### `/new` / `/clear`
Starts a new conversation, clearing the chat history and resetting the tool mode detection.

### `/dump`
Dumps the current conversation state including chat history, model settings, and tool mode information for debugging.

## Tool Calling Modes Explained

### OpenAI Style
- Uses the standard OpenAI `tools` parameter
- Model must be trained for function calling (Hermes, Llama-3.1+, etc.)
- Automatic tool call parsing from response
- Example models: `Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC`, `Llama-3.1-8B-Instruct-q4f16_1-MLC`

### Structural Tag
- Uses grammar-guided generation to guarantee valid tool call JSON
- Works with any model supporting structural tags
- More reliable output format
- Example models: Any model in the filtered list works

### Auto Mode
- Attempts OpenAI style first
- If parsing fails or model doesn't support it, falls back to structural tag
- **Remembers** the working mode for subsequent requests
- Provides best of both worlds

## Example Usage

1. Select "Auto" tool mode (default)
2. Ask: "What's my location and what time is it?"
3. The system will try OpenAI-style tool calling, fall back to structural tags if needed
4. Tool results are displayed and incorporated into the final response

## Implementation Details

The fallback mechanism works by:
1. Try OpenAI-style with `tools` parameter
2. If `tool_calls` are found in the response, execute them and get final answer
3. If no tool calls or parsing fails, catch the error and try structural tag mode
4. Structural tag mode uses `response_format: { type: "structural_tag", ... }`
5. Auto mode remembers which mode worked for the selected model

## Files

- `src/chat_tool_calling.html` - Main HTML with tool mode selector
- `src/chat_tool_calling.ts` - Main TypeScript with ChatUI class and tool calling logic
- `src/chat_tool_calling.css` - Styling
- `tasks.py` - Invoke task definitions