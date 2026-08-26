export type ApiExampleId =
  | "curl"
  | "javascript"
  | "python"
  | "csharp"
  | "java"
  | "go"
  | "ruby";

export interface ApiCodeExample {
  id: ApiExampleId;
  label: string;
  code: string;
}

interface ApiExampleInput {
  apiKey: string;
  model: string;
  openAiBaseUrl: string;
}

export function buildQuickStartExamples(input: ApiExampleInput): ApiCodeExample[] {
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
