import { z } from 'zod';
import { tool, type DataStreamWriter } from 'ai';
import { streamText } from 'ai';
import { myProvider } from '../providers';

// Define interfaces for Tavily API response
interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilySearchResponse {
  query: string;
  response_time: number;
  results: TavilySearchResult[];
}

// Helper function to generate a UUID for tool call tracking
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

// Converts TavilySearchResult to a plain object
const serializeSearchResult = (result: TavilySearchResult) => {
  return {
    title: result.title,
    url: result.url,
    content: result.content,
    score: result.score,
  };
};

// Tool Definition
export const tavilySearch = ({
  dataStream,
}: {
  dataStream: DataStreamWriter;
}) =>
  tool({
    description: `Performs web searches using the Tavily API for multiple queries concurrently. 
                  Returns a summary of the findings along with source URLs. 
                  Use this tool when you need up-to-date information or answers about topics beyond your knowledge base.`,
    parameters: z.object({
      queries: z
        .array(z.string().describe('A specific search query string.'))
        .describe('An array of search queries to execute in parallel.'),
    }),
    execute: async ({ queries }) => {
      const apiKey = process.env.TAVILY_API_KEY;
      if (!apiKey) {
        throw new Error('Tavily API key not configured.');
      }

      const toolCallId = generateUUID();

      // Send initial status update
      dataStream.writeData({
        type: 'tavily-search-status',
        content: {
          toolCallId,
          status: 'Searching...',
          sources: [],
        },
      });

      try {
        // 1. Execute multiple search queries in parallel
        const searchPromises = queries.map(async (query) => {
          try {
            const res = await fetch('https://api.tavily.com/search', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                api_key: apiKey,
                query: query,
                search_depth: 'basic',
                include_answer: false,
                max_results: 5,
              }),
            });

            if (!res.ok) {
              console.error(
                `Tavily query failed for "${query}": ${res.statusText}`,
              );
              return {
                query,
                response_time: 0,
                results: [],
              } as TavilySearchResponse;
            }
            return (await res.json()) as TavilySearchResponse;
          } catch (error) {
            console.error(
              `Error fetching Tavily results for "${query}":`,
              error,
            );
            return {
              query,
              response_time: 0,
              results: [],
            } as TavilySearchResponse;
          }
        });

        const searchResponses = await Promise.all(searchPromises);

        // 2. Collect and stream individual results/sources incrementally
        const allSources: TavilySearchResult[] = [];
        for (const response of searchResponses) {
          if (response?.results?.length > 0) {
            const relevantResults = response.results.slice(0, 5);
            allSources.push(...relevantResults);

            // Serialize TavilySearchResults to plain objects for JSON serialization
            const serializedResults = relevantResults.map(
              serializeSearchResult,
            );

            dataStream.writeData({
              type: 'tavily-search-sources',
              content: {
                toolCallId,
                sources: serializedResults,
              },
            });
          }
        }

        if (allSources.length === 0) {
          dataStream.writeData({
            type: 'tavily-search-status',
            content: {
              toolCallId,
              status: 'No results found.',
              sources: [],
            },
          });
          return {
            toolCallId,
            summary: 'No relevant search results found.',
            sources: [],
          };
        }

        // 3. Prepare content for AI summarization
        const contextForSummarization = allSources
          .map(
            (result, index) =>
              `Source ${index + 1} (${result.url}):\n${result.content}`,
          )
          .join('\n\n---\n\n');

        const summarizationPrompt = `Based on the following search results, provide a concise summary addressing the original queries: [${queries.join(', ')}]. Cite relevant source numbers (e.g., [Source 1], [Source 2]) where appropriate.\n\nSearch Results:\n${contextForSummarization}`;

        // 4. Stream AI summary
        // Serialize TavilySearchResults to plain objects for JSON serialization
        const serializedSources = allSources.map(serializeSearchResult);

        dataStream.writeData({
          type: 'tavily-search-status',
          content: {
            toolCallId,
            status: 'Summarizing...',
            sources: serializedSources,
          },
        });

        let finalSummary = '';
        const { textStream } = await streamText({
          model: myProvider.languageModel('chat-model'),
          prompt: summarizationPrompt,
        });

        for await (const delta of textStream) {
          finalSummary += delta;
          dataStream.writeData({
            type: 'tavily-summary-delta',
            content: {
              toolCallId,
              delta,
            },
          });
        }

        // 5. Send final status and return structured result
        dataStream.writeData({
          type: 'tavily-search-status',
          content: {
            toolCallId,
            status: 'Complete',
            sources: serializedSources,
            summary: finalSummary,
          },
        });

        return {
          toolCallId,
          summary: finalSummary,
          sources: allSources.map((s) => ({
            url: s.url,
            title: s.title,
            content: `${s.content.substring(0, 150)}...`,
          })),
        };
      } catch (error) {
        console.error('Error in Tavily tool execution:', error);
        dataStream.writeData({
          type: 'tavily-search-status',
          content: {
            toolCallId,
            status: 'Error occurred during search.',
            error: (error as Error).message,
          },
        });
        return {
          toolCallId,
          summary: 'An error occurred during the search.',
          sources: [],
          error: (error as Error).message,
        };
      }
    },
  });
