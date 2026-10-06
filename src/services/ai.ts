import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from 'openai/resources/chat/completions';
import { config } from '../config.js';
import { availableTools, executeTool, type ToolExecutionContext } from '../skills/index.js';

export const openai = new OpenAI({
  apiKey: config.ODIROUTER_API_KEY,
  baseURL: config.ODIROUTER_BASE_URL,
});

const MAX_TOOL_ITERATIONS = 5;

/**
 * Единый сервис LLM с мультимодальностью и циклом вызова инструментов (Tool-calling loop)
 */
export async function generateAIResponse(
  messages: ChatCompletionMessageParam[],
  toolContext: ToolExecutionContext
): Promise<string> {
  const messageHistory: ChatCompletionMessageParam[] = [...messages];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await openai.chat.completions.create({
      model: config.MODEL_NAME,
      messages: messageHistory,
      tools: availableTools,
      tool_choice: 'auto',
      temperature: 0.7,
    });

    const choice = response.choices[0];
    if (!choice || !choice.message) {
      throw new Error('LLM не вернула ответа в choice.');
    }

    const assistantMessage = choice.message;

    // Если модель не вызывает инструменты, возвращаем финальный ответ
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      return assistantMessage.content || 'Ответ от модели пуст.';
    }

    // Сохраняем шаг ассистента с вызовами инструментов
    messageHistory.push(assistantMessage);

    // Выполняем каждый вызванный инструмент
    for (const toolCall of assistantMessage.tool_calls) {
      console.log(`[AI Tool Call] Executing: ${toolCall.function.name} with args: ${toolCall.function.arguments}`);

      let toolResult: string;
      try {
        toolResult = await executeTool(
          toolCall.function.name,
          toolCall.function.arguments,
          toolContext
        );
      } catch (toolError: unknown) {
        console.error(`[AI Tool Call Error] ${toolCall.function.name}:`, toolError);
        toolResult = JSON.stringify({
          error: `Ошибка вызова функции: ${toolError instanceof Error ? toolError.message : String(toolError)}`,
        });
      }

      const toolMessage: ChatCompletionToolMessageParam = {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResult,
      };

      messageHistory.push(toolMessage);
    }
  }

  // Если достигнут лимит итераций, делаем один финальный запрос без tools
  const finalResponse = await openai.chat.completions.create({
    model: config.MODEL_NAME,
    messages: messageHistory,
    temperature: 0.7,
  });

  return finalResponse.choices[0]?.message?.content || 'Завершено после выполнения инструментов.';
}
