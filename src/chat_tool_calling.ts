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
    description: "Get the user's current geographic location (latitude, longitude)",
    schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "get_time",
    description: "Get the current time in UTC or a specified timezone",
    schema: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "IANA timezone name (defaults to browser's local timezone if not specified)",
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
    at_least_one: true,
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
  // Try structural tag format: ^<tool_call>JSON object\ntool>
  const structuralRegex = /<tool_call>\s*({[\s\S]*?})\s*<\/tool_call>/g;
  let match: RegExpExecArray | null;
  while ((match = structuralRegex.exec(content)) !== null) {
    try {
      const payload = JSON.parse(match[1]);
      if (typeof payload.name === "string" && payload.arguments !== undefined) {
        calls.push({ name: payload.name, arguments: payload.arguments });
      }
    } catch (e) {
      console.warn("Failed to parse structural tool call:", match[1]);
    }
  }
  if (calls.length > 0) {
    return calls;
  }
  // Fallback: Try Hermes function format: <function>JSON</function>
  const hermesRegex = /<function>\s*({[\s\S]*?})\s*<\/function>/g;
  while ((match = hermesRegex.exec(content)) !== null) {
    try {
      const payload = JSON.parse(match[1]);
      if (typeof payload.name === "string" && payload.parameters !== undefined) {
        calls.push({ name: payload.name, arguments: payload.parameters });
      }
    } catch (e) {
      console.warn("Failed to parse Hermes tool call:", match[1]);
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
  if (call.name === "get_location") {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve({ error: "Geolocation not supported by this browser" });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          // Try to get reverse geocode for city/country info
          let locationInfo: Record<string, unknown> = { timezone: browserTimezone };
          try {
            const response = await fetch(
              `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=10&addressdetails=1`,
              { headers: { "Accept-Language": "en" } }
            );
            const data = await response.json();
            if (data?.address) {
              locationInfo = {
                ...locationInfo,
                city: data.address.city || data.address.town || data.address.village || "",
                country: data.address.country || "",
                display_name: data.display_name || "",
              };
            }
          } catch (e) {
            // Ignore geocoding errors, just return lat/lon
          }
          resolve({
            latitude,
            longitude,
            accuracy: position.coords.accuracy,
            timestamp: new Date(position.timestamp).toISOString(),
            ...locationInfo,
            note: "Browser geolocation API with reverse geocoding",
          });
        },
        (error) => {
          resolve({ error: error.message });
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }
  if (call.name === "get_time") {
    const timezone = (call.arguments.timezone as string) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = new Date();
    const timeString = now.toLocaleTimeString("en-US", { 
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short"
    });
    const dateString = now.toLocaleDateString("en-US", { 
      timeZone: timezone,
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric"
    });
    return {
      timezone,
      iso_time: now.toISOString(),
      local_time: `${dateString} ${timeString}`,
      note: "Browser's local time",
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
  private engine: webllm.MLCEngineInterface;
  private selectedModel: string;
  private toolMode: ToolMode = "auto";
  private determinedMode: ToolMode | null = null; // Once determined, remember the working mode
  private chatLoaded = false;
  private requestInProgress = false;
  private chatHistory: webllm.ChatCompletionMessageParam[] = [];
  private chatRequestChain: Promise<void> = Promise.resolve();

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
    // Event handlers
    getElementAndCheck("chatui-reset-btn").onclick = () => chatUI.onReset();
    getElementAndCheck("chatui-send-btn").onclick = () => chatUI.onGenerate();
    getElementAndCheck("chatui-input").onkeypress = (event) => {
      if (event.keyCode === 13) chatUI.onGenerate();
    };
    chatUI.uiToolModeSelector.onchange = () => {
      chatUI.toolMode = chatUI.uiToolModeSelector.value as ToolMode;
      chatUI.determinedMode = null; // Reset when manually changed
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
      if (i === 0) opt.selected = true;
      modelSelector.appendChild(opt);
    }
    chatUI.selectedModel = modelSelector.value;
    modelSelector.onchange = () => {
      chatUI.onSelectChange(modelSelector);
    };
    return chatUI;
  };

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
      await this.engine.reload(this.selectedModel);
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
  // Tool Calling Logic
  // ============================================================================

  private async asyncGenerate() {
    await this.asyncInitChat();
    this.requestInProgress = true;
    const prompt = this.uiChatInput.value;
    if (prompt === "") {
      this.requestInProgress = false;
      return;
    }
    this.appendUserMessage(prompt);
    this.uiChatInput.value = "";
    this.uiChatInput.setAttribute("placeholder", "Generating...");
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
    this.chatHistory = this.chatHistory.slice(0, 1);
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
      for (const toolCall of toolCalls) {
        if (toolCall.type === "function") {
          const args = JSON.parse(toolCall.function.arguments);
          const result = await runTool({ name: toolCall.function.name, arguments: args });
          this.appendMessage(
            "tool-result",
            `Tool ${toolCall.function.name} result: ${JSON.stringify(result)}`,
          );
          this.chatHistory.push({
            role: "assistant",
            content: curMessage,
            tool_calls: [toolCall],
          } as webllm.ChatCompletionMessageParam);
          this.chatHistory.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        }
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
      "Use the provided tools by emitting  tool_call blocks (one or more) when needed. " +
      'Each  tool_call should contain a JSON body {"name": "...", "arguments": {...}}. ' +
      "After receiving tool responses, provide a natural language answer incorporating the results. " +
      "Available tools: " +
      JSON.stringify(tools.map((t) => ({ name: t.name, description: t.description })));
    const messages: webllm.ChatCompletionMessageParam[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ];
    const responseFormat: webllm.ResponseFormat = {
      type: "structural_tag",
      structural_tag: mcpStructuralTag,
    };
    const toolCallReply = await this.engine.chat.completions.create({
      stream: false,
      messages,
      max_tokens: 1024,
      response_format: responseFormat,
    });
    const toolCallContent = toolCallReply.choices[0].message.content || "";
    this.appendMessage("left", "Tool calls generated...");
    const parsedCalls = parseToolCallBlocks(toolCallContent);
    const toolCalls = parsedCalls.map((call, idx) => ({
      id: `call-${idx + 1}`,
      call,
    }));
    messages.push({
      role: "assistant",
      content: toolCallContent,
      tool_calls: toolCalls.map(({ id, call }) => ({
        id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    } as webllm.ChatCompletionMessageParam);
    for (const { id, call } of toolCalls) {
      const toolResult = await runTool(call);
      this.appendMessage(
        "tool-result",
        `Tool ${call.name}: ${JSON.stringify(toolResult)}`,
      );
      messages.push({
        role: "tool",
        tool_call_id: id,
        content: JSON.stringify(toolResult),
      });
    }
    messages.push({
      role: "user",
      content: "Summarize the tool results in a natural response.",
    });
    const finalReply = await this.engine.chat.completions.create({
      stream: false,
      messages,
      max_tokens: 256,
    });
    const finalMessage = finalReply.choices[0].message.content || "";
    this.updateLastMessage("left", finalMessage);
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