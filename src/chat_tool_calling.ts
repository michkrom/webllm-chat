import * as webllm from "@mlc-ai/web-llm";
import { prebuiltAppConfig } from "@mlc-ai/web-llm";

// ============================================================================
// Tool Definitions
// ============================================================================

type ToolDefinition = {
  name: string;
  description: string;
  schema: Record<string, unknown>;
};

const tools: ToolDefinition[] = [
  {
    name: "get_location",
    description: "Get the user's current city and country",
    schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_time",
    description: "Get the current time. Use without timezone argument to get the user's local time. Only specify timezone if the user explicitly asks for time in a specific location.",
    schema: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "IANA timezone name. Optional - only specify if user requests time in a timezone other than their local timezone",
        },
      },
      required: [],
    },
  },
];

// Structural tag format for tool calling
const mcpStructuralTag = {
  type: "structural_tag",
  format: {
    type: "triggered_tags",
    triggers: ["<tool_call>"],
    tags: tools.map((tool) => ({
      begin: `<tool_call>\n{"name": "${tool.name}", "arguments": `,
      content: { type: "json_schema", json_schema: tool.schema },
      end: "}\n<\/tool_call>",
    })),
    at_least_one: false,
    stop_after_first: false,
  },
} as const;

// ============================================================================
// App Config
// ============================================================================

const appConfig: webllm.AppConfig = {
  ...prebuiltAppConfig,
  model_list: prebuiltAppConfig.model_list.filter(
    (m) =>
      m.model_id.includes("Hermes") ||
      m.model_id.includes("Llama-3.1") ||
      m.model_id.includes("Llama-3.2") ||
      m.model_id.includes("Llama-3.3") ||
      m.model_id.includes("Qwen3") ||
      m.model_id.includes("Qwen2.5") ||
      m.model_id.includes("Phi-4") ||
      m.model_id.includes("gemma-2") ||
      m.model_id.includes("gemma-3") ||
      m.model_id.includes("Mistral") ||
      m.model_id.includes("DeepSeek"),
  ),
};

// ============================================================================
// Tool Mode Types
// ============================================================================

type ToolMode = "auto" | "openai" | "structural";

// ============================================================================
// Helper Functions
// ============================================================================

function getElementAndCheck(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element == null) {
    throw Error("Cannot find element " + id);
  }
  return element;
}

// Parse tool call blocks from model output
function parseToolCallBlocks(
  content: string | null | undefined,
): Array<{ name: string; arguments: Record<string, unknown> }> {
  if (!content) {
    throw new Error("Assistant reply did not contain a tool call.");
  }
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  
  // Helper to find matching closing brace for nested JSON
  function findMatchingBrace(str: string, startIndex: number): number {
    let depth = 0;
    for (let i = startIndex; i < str.length; i++) {
      if (str[i] === '{') depth++;
      else if (str[i] === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }
  
  // Try structural tag format
  const structuralRegex = />\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = structuralRegex.exec(content)) !== null) {
    const startBrace = match.index + match[0].length - 1;
    const endBrace = findMatchingBrace(content, startBrace);
    if (endBrace === -1) continue;
    
    const jsonStr = content.substring(startBrace, endBrace + 1);
    
    // Verify this is a valid tool call block ending with </ (from <\/tool_call>)
    const afterBrace = content.substring(endBrace + 1).trim();
    if (!afterBrace.startsWith("<")) continue;
    
    try {
      const payload = JSON.parse(jsonStr);
      if (typeof payload.name === "string" && payload.arguments !== undefined) {
        calls.push({ name: payload.name, arguments: payload.arguments });
      }
    } catch (e) {
      console.warn("Failed to parse structural tool call:", jsonStr);
    }
  }
  if (calls.length > 0) {
    return calls;
  }
  // Fallback: Try Hermes function format: <function>JSON</function>
  const hermesRegex = /<function>\s*\{/g;
  while ((match = hermesRegex.exec(content)) !== null) {
    const startBrace = match.index + match[0].length - 1;
    const endBrace = findMatchingBrace(content, startBrace);
    if (endBrace === -1) continue;
    
    const jsonStr = content.substring(startBrace, endBrace + 1);
    
    // Verify this is a valid function block ending with </
    const afterBrace = content.substring(endBrace + 1).trim();
    if (!afterBrace.startsWith("<")) continue;
    
    try {
      const payload = JSON.parse(jsonStr);
      if (typeof payload.name === "string" && payload.parameters !== undefined) {
        calls.push({ name: payload.name, arguments: payload.parameters });
      }
    } catch (e) {
      console.warn("Failed to parse Hermes tool call:", jsonStr);
    }
  }
  if (calls.length === 0) {
    throw new Error("Failed to find any tool call blocks.");
  }
  return calls;
}

// Browser-native tool execution
async function runTool(
  call: { name: string; arguments: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  console.log(`Tool ${call.name} called with args:`, call.arguments);
  const result = await executeTool(call);
  console.log(`Tool ${call.name} result:`, result);
  return result;
}

async function executeTool(
  call: { name: string; arguments: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  if (call.name === "get_location") {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve({ error: "Geolocation not supported by this browser" });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          let locationInfo: Record<string, unknown> = {};
          try {
            const response = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1`,
              { headers: { "Accept-Language": "en" } }
            );
            const data = await response.json();
            if (data?.address) {
              locationInfo = {
                city: data.address.city || data.address.town || data.address.village || "",
                country: data.address.country || "",
                display_name: data.display_name || "",
              };
            }
          } catch (e) {
            // Ignore geocoding errors
          }
          resolve(locationInfo);
        },
        (error) => {
          resolve({ error: error.message });
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }
  if (call.name === "get_time") {
    const now = new Date();
    
    // If timezone specified, use it; otherwise use local time directly
    if (typeof call.arguments?.timezone === 'string' && call.arguments.timezone) {
      const timezone = call.arguments.timezone;
      const date = now.toLocaleDateString("en-US", { 
        timeZone: timezone,
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric"
      });
      const time = now.toLocaleTimeString("en-US", { 
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
      return { 
        success: true,
        date, 
        time,
        timezone: timezone 
      };
    }
    
    // No timezone specified - use browser's local time
    const date = now.toLocaleDateString("en-US", { 
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric"
    });
    const time = now.toLocaleTimeString("en-US", { 
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    return { 
      success: true,
      date, 
      time,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone 
    };
  }
  return { error: `Tool ${call.name} is not implemented.` };
}

// ============================================================================
// ChatUI Class
// ============================================================================

class ChatUI {
  private uiChat: HTMLElement;
  private uiChatInput: HTMLInputElement;
  private uiChatInfoLabel: HTMLLabelElement;
  private uiToolModeSelector: HTMLSelectElement;
  private uiContextSizeSelector: HTMLSelectElement;
  private engine: webllm.MLCEngineInterface;
  private selectedModel: string;
  private contextSize: number;
  private toolMode: ToolMode = "auto";
  private determinedMode: ToolMode | null = null; // Once determined, remember the working mode
  private chatLoaded = false;
  private requestInProgress = false;
  private chatHistory: webllm.ChatCompletionMessageParam[] = [];
  private chatRequestChain: Promise<void> = Promise.resolve();

  // Available context size options (in tokens)
  private static readonly CONTEXT_SIZE_OPTIONS = [4096, 8192, 16384, 32768, 65536, 131072];

  public static CreateAsync = async (engine: webllm.MLCEngineInterface) => {
    const chatUI = new ChatUI();
    chatUI.engine = engine;
    chatUI.uiChat = getElementAndCheck("chatui-chat");
    chatUI.uiChatInput = getElementAndCheck("chatui-input") as HTMLInputElement;
    chatUI.uiChatInfoLabel = getElementAndCheck(
      "chatui-info-label",
    ) as HTMLLabelElement;
    chatUI.uiToolModeSelector = getElementAndCheck(
      "tool-mode",
    ) as HTMLSelectElement;
    chatUI.uiContextSizeSelector = getElementAndCheck(
      "context-size",
    ) as HTMLSelectElement;
    // Load saved settings from localStorage
    chatUI.loadSettings();
    // Event handlers
    getElementAndCheck("chatui-reset-btn").onclick = () => chatUI.onReset();
    getElementAndCheck("chatui-send-btn").onclick = () => chatUI.onGenerate();
    getElementAndCheck("chatui-input").onkeypress = (event) => {
      if (event.keyCode === 13) chatUI.onGenerate();
    };
    chatUI.uiToolModeSelector.onchange = () => {
      chatUI.toolMode = chatUI.uiToolModeSelector.value as ToolMode;
      chatUI.determinedMode = null; // Reset when manually changed
      chatUI.saveSettings();
    };
    chatUI.uiContextSizeSelector.onchange = () => {
      chatUI.contextSize = parseInt(chatUI.uiContextSizeSelector.value, 10);
      chatUI.saveSettings();
    };
    // Populate model selector
    const modelSelector = getElementAndCheck(
      "chatui-select",
    ) as HTMLSelectElement;
    for (let i = 0; i < appConfig.model_list.length; ++i) {
      const item = appConfig.model_list[i];
      const opt = document.createElement("option");
      opt.value = item.model_id;
      opt.innerHTML = item.model_id;
      modelSelector.appendChild(opt);
    }
    // Set selected model from settings or default to first
    if (chatUI.selectedModel) {
      modelSelector.value = chatUI.selectedModel;
    } else {
      chatUI.selectedModel = modelSelector.value;
    }
    modelSelector.onchange = () => {
      chatUI.onSelectChange(modelSelector);
    };
    // Populate context size selector
    for (const size of ChatUI.CONTEXT_SIZE_OPTIONS) {
      const opt = document.createElement("option");
      opt.value = size.toString();
      opt.innerHTML = `${size} tokens`;
      if (size === chatUI.contextSize) opt.selected = true;
      chatUI.uiContextSizeSelector.appendChild(opt);
    }
    return chatUI;
  };

  private loadSettings() {
    const saved = localStorage.getItem("webllm-chat-settings");
    if (saved) {
      try {
        const settings = JSON.parse(saved);
        this.selectedModel = settings.selectedModel || "";
        this.contextSize = settings.contextSize || 4096;
        this.toolMode = settings.toolMode || "auto";
        this.determinedMode = settings.determinedMode || null;
      } catch (e) {
        console.warn("Failed to load settings:", e);
        this.selectedModel = "";
        this.contextSize = 4096;
        this.toolMode = "auto";
      }
    } else {
      this.selectedModel = "";
      this.contextSize = 4096;
      this.toolMode = "auto";
    }
    // Update UI to reflect loaded settings
    if (this.uiToolModeSelector) {
      this.uiToolModeSelector.value = this.toolMode;
      // Restore the detected mode text if in auto mode
      if (this.toolMode === "auto" && this.determinedMode) {
        const autoOption = this.uiToolModeSelector.querySelector("option[value='auto']");
        if (autoOption) {
          autoOption.textContent = `Auto ✓ (${this.determinedMode === "openai" ? "OpenAI" : "Structural"} detected)`;
        }
      }
    }
  }

  private saveSettings() {
    const settings = {
      selectedModel: this.selectedModel,
      contextSize: this.contextSize,
      toolMode: this.toolMode,
      determinedMode: this.determinedMode,
    };
    localStorage.setItem("webllm-chat-settings", JSON.stringify(settings));
  }

  private pushTask(task: () => Promise<void>) {
    const lastEvent = this.chatRequestChain;
    this.chatRequestChain = lastEvent.then(task);
  }

  private async onGenerate() {
    if (this.requestInProgress) return;
    this.pushTask(async () => await this.asyncGenerate());
  }

  private async onSelectChange(modelSelector: HTMLSelectElement) {
    if (this.requestInProgress) this.engine.interruptGenerate();
    this.pushTask(async () => {
      await this.engine.resetChat();
      this.resetChatHistory();
      await this.unloadChat();
      this.selectedModel = modelSelector.value;
      this.saveSettings();
      this.determinedMode = null; // Reset mode preference when model changes
      // Reset dropdown text
      const autoOption = this.uiToolModeSelector.querySelector("option[value='auto']");
      if (autoOption) autoOption.textContent = "Auto (Try OpenAI → Fallback to Structural)";
      await this.asyncInitChat();
    });
  }

  private async onReset() {
    if (this.requestInProgress) this.engine.interruptGenerate();
    this.pushTask(async () => {
      await this.engine.resetChat();
      this.resetChatHistory();
      this.determinedMode = null; // Reset mode preference too
      // Reset dropdown text
      const autoOption = this.uiToolModeSelector.querySelector("option[value='auto']");
      if (autoOption) autoOption.textContent = "Auto (Try OpenAI → Fallback to Structural)";
    });
  }

  // Message UI helpers
  private appendMessage(kind: string, text: string) {
    const msg = `
      <div class="msg ${kind}-msg">
        <div class="msg-bubble">
          <div class="msg-text">${this.escapeHtml(text)}</div>
        </div>
      </div>
    `;
    this.uiChat.insertAdjacentHTML("beforeend", msg);
    this.uiChat.scrollTo(0, this.uiChat.scrollHeight);
  }

  private appendUserMessage(text: string) {
    const msg = `
      <div class="msg right-msg">
        <div class="msg-bubble">
          <div class="msg-text"></div>
        </div>
      </div>
    `;
    this.uiChat.insertAdjacentHTML("beforeend", msg);
    const msgElement = this.uiChat.lastElementChild?.lastElementChild
      ?.lastElementChild as HTMLElement;
    msgElement.insertAdjacentText("beforeend", text);
    this.uiChat.scrollTo(0, this.uiChat.scrollHeight);
  }

  private escapeHtml(text: string): string {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  private updateLastMessage(kind: string, text: string) {
    const matches = this.uiChat.getElementsByClassName(`msg ${kind}-msg`);
    if (matches.length === 0) return;
    const msg = matches[matches.length - 1];
    const msgText = msg.getElementsByClassName("msg-text");
    if (msgText.length !== 1) return;
    msgText[0].textContent = text;
    this.uiChat.scrollTo(0, this.uiChat.scrollHeight);
  }

  private resetChatHistory() {
    this.chatHistory = [];
    const clearTags = ["left", "right", "init", "error", "tool-result"];
    for (const tag of clearTags) {
      const matches = [...this.uiChat.getElementsByClassName(`msg ${tag}-msg`)];
      for (const item of matches) this.uiChat.removeChild(item);
    }
    this.uiChatInfoLabel.innerHTML = "";
  }

  private async asyncInitChat() {
    if (this.chatLoaded) return;
    this.requestInProgress = true;
    this.appendMessage("init", "Loading model...");
    const initProgressCallback = (report: webllm.InitProgressReport) => {
      this.updateLastMessage("init", report.text);
    };
    this.engine.setInitProgressCallback(initProgressCallback);
    try {
      await this.engine.reload(this.selectedModel, { context_size: this.contextSize });
    } catch (err) {
      this.appendMessage("error", "Init error: " + (err as Error).toString());
      this.requestInProgress = false;
      return;
    }
    this.requestInProgress = false;
    this.chatLoaded = true;
  }

  private async unloadChat() {
    await this.engine.unload();
    this.chatLoaded = false;
  }

  // ============================================================================
  // Slash Command Support
  // ============================================================================

  private async runSlashCommand(command: string) {
    const trimmed = command.trim();
    const parts = trimmed.slice(1).split(/\s+/);
    const cmdName = parts[0]?.toLowerCase() || "";
    const cmdArgs = parts.slice(1);

    this.uiChatInput.value = "";

    // Map slash commands to tool calls
    if (cmdName === "time" || cmdName === "get_time") {
      this.appendUserMessage(trimmed);
      this.chatHistory.push({ role: "user", content: trimmed });
      const toolCall = { name: "get_time", arguments: {} };
      if (cmdArgs.length > 0) {
        toolCall.arguments = { timezone: cmdArgs[0] };
      }
      await this.executeToolCommand(toolCall);
    } else if (cmdName === "location" || cmdName === "get_location" || cmdName === "where") {
      this.appendUserMessage(trimmed);
      this.chatHistory.push({ role: "user", content: trimmed });
      await this.executeToolCommand({ name: "get_location", arguments: {} });
    } else if (cmdName === "help" || cmdName === "?") {
      this.appendUserMessage(trimmed);
      this.appendMessage("left", 
        "Available commands:\n" +
        "/time [timezone] - Get current time\n" +
        "/location - Get your current location\n" +
        "/help - Show this help message\n" +
        "/new - Start a new conversation (clears chat history)\n" +
        "/clear - Same as /new\n" +
        "/dump - Dump conversation track (shows chat history, model, settings)"
      );
    } else if (cmdName === "new" || cmdName === "clear") {
      // Reset chat - same as clicking reset button (don't append user message since we're clearing)
      if (this.requestInProgress) this.engine.interruptGenerate();
      this.pushTask(async () => {
        await this.engine.resetChat();
        this.resetChatHistory();
        this.determinedMode = null;
        const autoOption = this.uiToolModeSelector.querySelector("option[value='auto']");
        if (autoOption) autoOption.textContent = "Auto (Try OpenAI → Fallback to Structural)";
      });
    } else if (cmdName === "dump") {
      this.appendUserMessage(trimmed);
      // Dump conversation track
      const dump = {
        chatHistory: this.chatHistory,
        model: this.selectedModel,
        contextSize: this.contextSize,
        toolMode: this.toolMode,
        determinedMode: this.determinedMode,
      };
      this.appendMessage("left", "Conversation dump:\n```\n" + JSON.stringify(dump, null, 2) + "\n```");
    } else {
      this.appendUserMessage(trimmed);
      this.appendMessage("error", `Unknown command: /${cmdName}\nType /help for available commands.`);
    }
  }

  private async executeToolCommand(toolCall: { name: string; arguments: Record<string, unknown> }) {
    try {
      const result = await runTool(toolCall);
      this.appendMessage("tool-result", `Tool ${toolCall.name}: ${JSON.stringify(result)}`);
      // Display result naturally and add to chat history
      if (toolCall.name === "get_time") {
        const date = result.date as string;
        const time = result.time as string;
        const response = `The current time is ${date} ${time}.`;
        this.appendMessage("left", response);
        this.chatHistory.push({ role: "assistant", content: response });
      } else if (toolCall.name === "get_location") {
        const city = result.city as string;
        const country = result.country as string;
        if (city || country) {
          const response = `You are in ${city}, ${country}.`;
          this.appendMessage("left", response);
          this.chatHistory.push({ role: "assistant", content: response });
        } else {
          const response = JSON.stringify(result);
          this.appendMessage("left", response);
          this.chatHistory.push({ role: "assistant", content: response });
        }
      }
    } catch (error) {
      this.appendMessage("error", `Command error: ${(error as Error).message}`);
    }
  }

  // ============================================================================
  // Tool Calling Logic
  // ============================================================================

  private async asyncGenerate() {
    const prompt = this.uiChatInput.value.trim();
    if (prompt === "") {
      return;
    }
    
    // Check for slash commands (direct tool invocation)
    if (prompt.startsWith("/")) {
      await this.runSlashCommand(prompt);
      return;
    }
    
    await this.asyncInitChat();
    this.requestInProgress = true;
    this.appendUserMessage(prompt);
    this.uiChatInput.value = "";
    this.uiChatInput.setAttribute("placeholder", "Generating...");
    // Create empty message bubble for streaming response to update
    this.appendMessage("left", "");
    try {
      let finalMessage = "";
      let usage: webllm.CompletionUsage | undefined;
      // If we've already determined the working mode, use it
      const effectiveMode = this.determinedMode ?? this.toolMode;
      
      if (effectiveMode === "structural") {
        ({ finalMessage, usage } = await this.runStructuralToolCalling(prompt));
        if (this.toolMode === "auto") this.determinedMode = "structural";
      } else if (effectiveMode === "openai") {
        ({ finalMessage, usage } = await this.runOpenAIToolCalling(prompt));
        if (this.toolMode === "auto") this.determinedMode = "openai";
      } else {
        // Auto mode - try OpenAI first, fall back to structural
        try {
          ({ finalMessage, usage } = await this.runOpenAIToolCalling(prompt));
          this.appendMessage("init", "(Used OpenAI-style tool calling)");
          this.determinedMode = "openai";
          // Update dropdown to show detected mode
          this.uiToolModeSelector.querySelector("option[value='auto']")!.textContent = 
            "Auto ✓ (OpenAI detected)";
        } catch (openaiError) {
          this.appendMessage(
            "init",
            `(OpenAI tool calling failed, falling back to structural tag mode)`,
          );
          ({ finalMessage, usage } = await this.runStructuralToolCalling(prompt));
          this.determinedMode = "structural";
          // Update dropdown to show detected mode
          this.uiToolModeSelector.querySelector("option[value='auto']")!.textContent = 
            "Auto ✓ (Structural detected)";
        }
      }
      this.updateLastMessage("left", finalMessage);
      if (usage) {
        this.uiChatInfoLabel.innerHTML =
          `prompt_tokens: ${usage.prompt_tokens}, ` +
          `completion_tokens: ${usage.completion_tokens}`;
      }
    } catch (err) {
      this.appendMessage("error", "Generate error: " + (err as Error).toString());
      await this.unloadChat();
    }
    this.uiChatInput.setAttribute("placeholder", "Enter your message...");
    this.requestInProgress = false;
  }

  private async runOpenAIToolCalling(prompt: string): Promise<{
    finalMessage: string;
    usage?: webllm.CompletionUsage;
  }> {
    this.chatHistory.push({ role: "user", content: prompt });
    const openaiTools: webllm.ChatCompletionTool[] = tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.schema,
      },
    }));
    let curMessage = "";
    let lastChunk: webllm.ChatCompletionChunk | undefined;
    let usage: webllm.CompletionUsage | undefined;
    const completion = await this.engine.chat.completions.create({
      stream: true,
      messages: this.chatHistory,
      stream_options: { include_usage: true },
      tools: openaiTools,
      tool_choice: "auto",
    });
    for await (const chunk of completion) {
      const delta = chunk.choices[0]?.delta?.content || "";
      if (delta) curMessage += delta;
      this.updateLastMessage("left", curMessage);
      lastChunk = chunk;
      if (chunk.usage) usage = chunk.usage;
    }
    const toolCalls = lastChunk?.choices[0]?.delta?.tool_calls;
    let finalMessage = curMessage;
    if (toolCalls && toolCalls.length > 0) {
      // Execute all tools in parallel for efficiency
      const toolResults = await Promise.all(toolCalls.map(async (toolCall) => {
        if (toolCall.type !== "function") return null;
        const args = JSON.parse(toolCall.function.arguments);
        const result = await runTool({ name: toolCall.function.name, arguments: args });
        this.appendMessage(
          "tool-result",
          `Tool ${toolCall.function.name} result: ${JSON.stringify(result)}`,
        );
        return { toolCall, result };
      }));
      
      // Add assistant message (once) with all tool calls
      // Note: When tool calls are present, we clear the text content to avoid hallucinated text being shown
      this.chatHistory.push({
        role: "assistant",
        content: "",
        tool_calls: toolCalls,
      } as webllm.ChatCompletionMessageParam);
      
      // Add all tool results to chat history
      for (const { toolCall, result } of toolResults.filter((r): r is NonNullable<typeof r> => r !== null)) {
        this.chatHistory.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }
      const finalCompletion = await this.engine.chat.completions.create({
        stream: false,
        messages: this.chatHistory,
      });
      finalMessage = finalCompletion.choices[0].message.content || "";
      this.updateLastMessage("left", finalMessage);
    } else {
      this.chatHistory.push({ role: "assistant", content: curMessage });
    }
    return { finalMessage, usage };
  }

  private async runStructuralToolCalling(prompt: string): Promise<{
    finalMessage: string;
    usage?: webllm.CompletionUsage;
  }> {
    const systemPrompt =
      "You are a helpful assistant with access to tools. " +
      "You MUST call the tools to get actual data - do NOT make up fake results. " +
      "When you need to use a tool, emit ONLY the tool call block in this exact format: " +
      "\n<tool_call>\n{\"name\": \"get_time\", \"arguments\": {}}\n<\/tool_call>\n" +
      "Replace the values with appropriate tool name and arguments. " +
      "For get_time, only specify timezone if user asks for a specific location.\n" +
      "After receiving tool responses, provide a natural language answer incorporating the results. " +
      "Tool results will be JSON objects like {\"success\": true, \"date\": \"Sun, May 17, 2026\", \"time\": \"02:11:06 PM\"} - extract the 'time' field to answer the user. " +
      "Available tools: " +
      JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description, schema: t.schema })));
    
    // Check if we need to add system prompt (only if chatHistory is empty or doesn't have system)
    if (this.chatHistory.length === 0 || this.chatHistory[0].role !== "system") {
      this.chatHistory.unshift({ role: "system", content: systemPrompt });
    }
    
    // Add user message to chat history
    this.chatHistory.push({ role: "user", content: prompt });
    
    const responseFormat: webllm.ResponseFormat = {
      type: "structural_tag",
      structural_tag: mcpStructuralTag,
    };
    const toolCallReply = await this.engine.chat.completions.create({
      stream: false,
      messages: this.chatHistory,
      max_tokens: 1024,
      response_format: responseFormat,
    });
    const toolCallContent = toolCallReply.choices[0].message.content || "";
    this.updateLastMessage("left", "Tool calls generated...");
    
    let finalMessage = "";
    let usage = toolCallReply.usage;
    
    // Try to parse tool calls - if none found, just show the response
    let parsedCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
    try {
      parsedCalls = parseToolCallBlocks(toolCallContent);
    } catch (e) {
      // No valid tool calls found - just show the raw response
      this.updateLastMessage("left", toolCallContent || "(no response)");
      this.chatHistory.push({ role: "assistant", content: toolCallContent });
      return { finalMessage: toolCallContent, usage };
    }
    
    const toolCalls = parsedCalls.map((call, idx) => ({
      id: `call-${idx + 1}`,
      call,
    }));
    
    // Update message to show what tool was generated
    const toolInfo = toolCalls.map(({ call }) => `${call.name}(${JSON.stringify(call.arguments)})`).join(", ");
    this.updateLastMessage("left", `Calling tool(s): ${toolInfo}`);
    
    // Push assistant message with tool calls to chat history
    // Note: When tool calls are present, we clear the text content to avoid hallucinated text being shown
    this.chatHistory.push({
      role: "assistant",
      content: "",
      tool_calls: toolCalls.map(({ id, call }) => ({
        id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    } as webllm.ChatCompletionMessageParam);
    
    // Execute all tools in parallel
    const toolResults = await Promise.all(toolCalls.map(async ({ id, call }) => {
      const result = await runTool(call);
      this.appendMessage(
        "tool-result",
        `Tool ${call.name}: ${JSON.stringify(result)}`,
      );
      return { id, result };
    }));
    
    // Add tool results to chat history
    for (const { id, result } of toolResults) {
      this.chatHistory.push({
        role: "tool",
        tool_call_id: id,
        content: JSON.stringify(result),
      });
    }
    
    // Continue conversation with tool results - let model naturally respond
    const finalReply = await this.engine.chat.completions.create({
      stream: false,
      messages: this.chatHistory,
      max_tokens: 256,
    });
    finalMessage = finalReply.choices[0].message.content || "";
    this.updateLastMessage("left", finalMessage);
    
    // Add final assistant message to chat history
    this.chatHistory.push({ role: "assistant", content: finalMessage });
    
    return { finalMessage, usage: finalReply.usage };
  }
}

// ============================================================================
// Main
// ============================================================================

let engine: webllm.MLCEngineInterface;

async function main() {
  engine = new webllm.MLCEngine({ appConfig });
  const chatUI = await ChatUI.CreateAsync(engine);
}

main();