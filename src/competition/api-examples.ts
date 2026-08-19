export type ApiProtocol = "openai" | "anthropic";

export type ApiExampleId =
  | "curl"
  | "javascript"
  | "python"
  | "csharp"
  | "java"
  | "go"
  | "php"
  | "ruby"
  | "typescript";

export interface ApiCodeExample {
  id: ApiExampleId;
  label: string;
  code: string;
}

interface ApiExampleInput {
  apiKey: string;
  model: string;
  openAiBaseUrl: string;
  anthropicBaseUrl: string;
}

function openAiExamples(input: ApiExampleInput): ApiCodeExample[] {
  const { apiKey, model, openAiBaseUrl } = input;
  return [
    {
      id: "curl",
      label: "cURL",
      code: `curl ${openAiBaseUrl}/chat/completions \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "你好"}]
  }'`,
    },
    {
      id: "javascript",
      label: "JavaScript",
      code: `// npm install openai
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "${apiKey}",
  baseURL: "${openAiBaseUrl}",
});

const response = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "你好" }],
});

console.log(response.choices[0].message.content);`,
    },
    {
      id: "python",
      label: "Python",
      code: `# pip install openai
from openai import OpenAI

client = OpenAI(
    api_key="${apiKey}",
    base_url="${openAiBaseUrl}",
)

response = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "你好"}],
)

print(response.choices[0].message.content)`,
    },
    {
      id: "csharp",
      label: ".NET",
      code: `using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;

using var client = new HttpClient();
client.DefaultRequestHeaders.Authorization =
    new AuthenticationHeaderValue("Bearer", "${apiKey}");

var response = await client.PostAsJsonAsync(
    "${openAiBaseUrl}/chat/completions",
    new {
        model = "${model}",
        messages = new[] { new { role = "user", content = "你好" } }
    });
response.EnsureSuccessStatusCode();

using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
Console.WriteLine(json.RootElement.GetProperty("choices")[0]
    .GetProperty("message").GetProperty("content").GetString());`,
    },
    {
      id: "java",
      label: "Java",
      code: `// com.openai:openai-java
import com.openai.client.okhttp.OpenAIOkHttpClient;
import com.openai.models.chat.completions.ChatCompletionCreateParams;

var client = OpenAIOkHttpClient.builder()
    .apiKey("${apiKey}")
    .baseUrl("${openAiBaseUrl}")
    .build();

var params = ChatCompletionCreateParams.builder()
    .model("${model}")
    .addUserMessage("你好")
    .build();

var response = client.chat().completions().create(params);
response.choices().get(0).message().content()
    .ifPresent(System.out::println);`,
    },
    {
      id: "go",
      label: "Go",
      code: `// go get github.com/openai/openai-go/v3
package main

import (
    "context"
    "fmt"
    "github.com/openai/openai-go/v3"
    "github.com/openai/openai-go/v3/option"
)

func main() {
    client := openai.NewClient(
        option.WithAPIKey("${apiKey}"),
        option.WithBaseURL("${openAiBaseUrl}"),
    )
    response, err := client.Chat.Completions.New(context.TODO(),
        openai.ChatCompletionNewParams{
            Model: "${model}",
            Messages: []openai.ChatCompletionMessageParamUnion{
                openai.UserMessage("你好"),
            },
        })
    if err != nil { panic(err) }
    fmt.Println(response.Choices[0].Message.Content)
}`,
    },
    {
      id: "ruby",
      label: "Ruby",
      code: `# bundle add openai
require "openai"

client = OpenAI::Client.new(
  api_key: "${apiKey}",
  base_url: "${openAiBaseUrl}"
)

response = client.chat.completions.create(
  model: "${model}",
  messages: [{ role: "user", content: "你好" }]
)

puts response.choices.first.message.content`,
    },
  ];
}

function anthropicExamples(input: ApiExampleInput): ApiCodeExample[] {
  const { anthropicBaseUrl, apiKey, model } = input;
  const messagesUrl = `${anthropicBaseUrl}/v1/messages`;
  return [
    {
      id: "curl",
      label: "cURL",
      code: `curl ${messagesUrl} \\
  -H "x-api-key: ${apiKey}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model}",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "你好"}]
  }'`,
    },
    {
      id: "python",
      label: "Python",
      code: `# pip install anthropic
from anthropic import Anthropic

client = Anthropic(
    api_key="${apiKey}",
    base_url="${anthropicBaseUrl}",
)

message = client.messages.create(
    model="${model}",
    max_tokens=1024,
    messages=[{"role": "user", "content": "你好"}],
)

print(message.content[0].text)`,
    },
    {
      id: "typescript",
      label: "TypeScript",
      code: `// npm install @anthropic-ai/sdk
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  apiKey: "${apiKey}",
  baseURL: "${anthropicBaseUrl}",
});

const message = await client.messages.create({
  model: "${model}",
  max_tokens: 1024,
  messages: [{ role: "user", content: "你好" }],
});

for (const block of message.content) {
  if (block.type === "text") console.log(block.text);
}`,
    },
    {
      id: "csharp",
      label: "C#",
      code: `using System.Net.Http.Json;
using System.Text.Json;

using var client = new HttpClient();
client.DefaultRequestHeaders.Add("x-api-key", "${apiKey}");
client.DefaultRequestHeaders.Add("anthropic-version", "2023-06-01");

var response = await client.PostAsJsonAsync(
    "${messagesUrl}",
    new {
        model = "${model}",
        max_tokens = 1024,
        messages = new[] { new { role = "user", content = "你好" } }
    });
response.EnsureSuccessStatusCode();

using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
Console.WriteLine(json.RootElement.GetProperty("content")[0]
    .GetProperty("text").GetString());`,
    },
    {
      id: "go",
      label: "Go",
      code: `// go get github.com/anthropics/anthropic-sdk-go
package main

import (
    "context"
    "fmt"
    "github.com/anthropics/anthropic-sdk-go"
    "github.com/anthropics/anthropic-sdk-go/option"
)

func main() {
    client := anthropic.NewClient(
        option.WithAPIKey("${apiKey}"),
        option.WithBaseURL("${anthropicBaseUrl}"),
    )
    message, err := client.Messages.New(context.TODO(), anthropic.MessageNewParams{
        Model: anthropic.Model("${model}"),
        MaxTokens: 1024,
        Messages: []anthropic.MessageParam{
            anthropic.NewUserMessage(anthropic.NewTextBlock("你好")),
        },
    })
    if err != nil { panic(err) }
    for _, block := range message.Content {
        if text, ok := block.AsAny().(anthropic.TextBlock); ok {
            fmt.Println(text.Text)
        }
    }
}`,
    },
    {
      id: "java",
      label: "Java",
      code: `// com.anthropic:anthropic-java
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.models.messages.MessageCreateParams;

var client = AnthropicOkHttpClient.builder()
    .apiKey("${apiKey}")
    .baseUrl("${anthropicBaseUrl}")
    .build();

var params = MessageCreateParams.builder()
    .model("${model}")
    .maxTokens(1024L)
    .addUserMessage("你好")
    .build();

var message = client.messages().create(params);
message.content().forEach(block -> block.text()
    .ifPresent(text -> System.out.println(text.text())));`,
    },
    {
      id: "php",
      label: "PHP",
      code: `<?php
// composer require anthropic-ai/sdk guzzlehttp/guzzle
require 'vendor/autoload.php';

use Anthropic\\Client;

putenv('ANTHROPIC_API_KEY=${apiKey}');
putenv('ANTHROPIC_BASE_URL=${anthropicBaseUrl}');
$client = new Client();

$message = $client->messages->create(
    model: '${model}',
    maxTokens: 1024,
    messages: [['role' => 'user', 'content' => '你好']],
);

foreach ($message->content as $block) {
    if ($block->type === 'text') echo $block->text, PHP_EOL;
}`,
    },
    {
      id: "ruby",
      label: "Ruby",
      code: `# bundle add anthropic
require "anthropic"

ENV["ANTHROPIC_API_KEY"] = "${apiKey}"
ENV["ANTHROPIC_BASE_URL"] = "${anthropicBaseUrl}"
client = Anthropic::Client.new

message = client.messages.create(
  model: "${model}",
  max_tokens: 1024,
  messages: [{ role: "user", content: "你好" }]
)

message.content.each do |block|
  puts block.text if block.type == :text
end`,
    },
  ];
}

export function buildQuickStartExamples(
  protocol: ApiProtocol,
  input: ApiExampleInput,
): ApiCodeExample[] {
  return protocol === "openai" ? openAiExamples(input) : anthropicExamples(input);
}
