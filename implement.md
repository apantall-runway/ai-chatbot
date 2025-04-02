Here is a comprehensive implementation plan for integrating Tavily as a web search provider tool into the existing AI Chatbot codebase.

```markdown
# Tavily Web Search Integration Plan

## 1. Project Setup & Configuration

1.  **Obtain Tavily API Key:**
    *   Sign up for Tavily AI at [https://tavily.com/](https://tavily.com/).
    *   Get your API key from the Tavily dashboard.
2.  **Environment Variables:**
    *   Add the Tavily API key to your environment variables. Update `.env.example` and your deployment environment (Vercel Environment Variables or local `.env.local` file).
    ```
    # .env.example / .env.local
    TAVILY_API_KEY=your_tavily_api_key
    ```
3.  **Install Dependencies:**
    *   Add any necessary SDKs or HTTP client libraries if not already present (e.g., `node-fetch` or use the built-in `fetch`). Tavily has an official JS client, but direct `fetch` calls are also straightforward. Let's assume direct `fetch` for now.

## 2. Backend Implementation (AI Tool & API Integration)

1.  **Define the Tavily Search Tool:**
    *   Create a new file: `lib/ai/tools/tavilySearch.ts`.
    *   Use the `tool` function from the AI SDK to define the tool schema and execution logic.
    *   **Parameters:** Define parameters using `zod` to accept an array of search queries. This allows the AI to request multiple searches concurrently.
        ```typescript
        import { z } from 'zod';
        import { tool, type DataStreamWriter } from 'ai';
        import { streamText } from 'ai'; // Or generateText if streaming summary isn't needed
        import { myProvider } from '../providers'; // Your configured AI provider

        // Define interfaces for Tavily API response
        interface TavilySearchResult {
          title: string;
          url: string;
          content: string;
          score: number;
          // Add other fields as needed
        }

        interface TavilySearchResponse {
          query: string;
          response_time: number;
          results: TavilySearchResult[];
          // Add other fields as needed
        }

        // Tool Definition
        export const tavilySearch = ({ dataStream }: { dataStream: DataStreamWriter }) => tool({
            description: `Performs web searches using the Tavily API for multiple queries concurrently. 
                          Returns a summary of the findings along with source URLs. 
                          Use this tool when you need up-to-date information or answers about topics beyond your knowledge base.`,
            parameters: z.object({
                queries: z.array(z.string().describe("A specific search query string.")).describe("An array of search queries to execute in parallel."),
                // Optional: Add parameters like max_results, include_domains etc. if needed
            }),
            execute: async ({ queries }) => {
                const apiKey = process.env.TAVILY_API_KEY;
                if (!apiKey) {
                    throw new Error("Tavily API key not configured.");
                }

                const toolCallId = generateUUID(); // Assuming generateUUID is available

                // Send initial status update
                dataStream.writeData('tavily-search-status', { toolCallId, status: 'Searching...', sources: [] });

                try {
                    // 1. Execute multiple search queries in parallel
                    const searchPromises = queries.map(query =>
                        fetch("https://api.tavily.com/search", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json",
                                "Authorization": `Bearer ${apiKey}` // Ensure correct auth if needed
                            },
                            body: JSON.stringify({
                                api_key: apiKey,
                                query: query,
                                search_depth: "basic", // Or "advanced"
                                include_answer: false, // We'll summarize ourselves
                                max_results: 5
                            }),
                        }).then(res => {
                            if (!res.ok) {
                                // Log specific query failure but don't necessarily fail the whole tool
                                console.error(`Tavily query failed for "${query}": ${res.statusText}`);
                                return { query, results: [] }; // Return empty results for failed query
                            }
                            return res.json() as Promise<TavilySearchResponse>;
                        }).catch(error => {
                           console.error(`Error fetching Tavily results for "${query}":`, error);
                           return { query, results: [] }; // Return empty results on fetch error
                        })
                    );

                    const searchResponses = await Promise.all(searchPromises);

                    // 2. Collect and stream individual results/sources incrementally
                    const allSources: TavilySearchResult[] = [];
                    for (const response of searchResponses) {
                        if (response && response.results && response.results.length > 0) {
                           // Filter/process results if needed (e.g., based on score)
                           const relevantResults = response.results.slice(0, 5); // Limit sources per query
                           allSources.push(...relevantResults);
                           // Stream sources back to UI as they are found
                           dataStream.writeData('tavily-search-sources', { toolCallId, sources: relevantResults });
                        }
                    }

                     if (allSources.length === 0) {
                       dataStream.writeData('tavily-search-status', { toolCallId, status: 'No results found.', sources: [] });
                       return { toolCallId, summary: "No relevant search results found.", sources: [] };
                    }

                    // 3. Prepare content for AI summarization
                    const contextForSummarization = allSources
                        .map((result, index) => `Source ${index + 1} (${result.url}):\n${result.content}`)
                        .join("\n\n---\n\n");

                    const summarizationPrompt = `Based on the following search results, provide a concise summary addressing the original queries: [${queries.join(', ')}]. Cite relevant source numbers (e.g., [Source 1], [Source 2]) where appropriate.\n\nSearch Results:\n${contextForSummarization}`;

                    // 4. Stream AI summary
                    dataStream.writeData('tavily-search-status', { toolCallId, status: 'Summarizing...', sources: allSources });

                    let finalSummary = "";
                    const { textStream } = await streamText({
                        // Use an appropriate model for summarization
                        model: myProvider.languageModel('chat-model'), // Or artifact-model
                        prompt: summarizationPrompt,
                    });

                    for await (const delta of textStream) {
                        finalSummary += delta;
                        dataStream.writeData('tavily-summary-delta', { toolCallId, delta });
                    }

                    // 5. Send final status and return structured result
                    dataStream.writeData('tavily-search-status', { toolCallId, status: 'Complete', sources: allSources, summary: finalSummary });

                    return {
                       toolCallId,
                       summary: finalSummary,
                       sources: allSources.map(s => ({ url: s.url, title: s.title, content: s.content.substring(0, 150) + '...' })), // Return snippets for chat history
                    };

                } catch (error) {
                    console.error("Error in Tavily tool execution:", error);
                    dataStream.writeData('tavily-search-status', { toolCallId, status: 'Error occurred during search.', error: (error as Error).message });
                    return { toolCallId, summary: "An error occurred during the search.", sources: [], error: (error as Error).message };
                }
            },
        });

```
2.  **Update AI Provider Configuration:**
    *   Modify `lib/ai/providers.ts` to include the `tavilySearch` tool in the relevant model configurations (likely `chat-model` and potentially `chat-model-reasoning` if desired).
    *   Register the tool in `app/(chat)/api/chat/route.ts` within the `streamText` call's `tools` object.
    ```typescript
    // app/(chat)/api/chat/route.ts
    import { tavilySearch } from '@/lib/ai/tools/tavilySearch';
    // ... other imports

    const result = streamText({
        // ... other config
        tools: {
            getWeather,
            createDocument: createDocument({ session, dataStream }),
            updateDocument: updateDocument({ session, dataStream }),
            requestSuggestions: requestSuggestions({ session, dataStream }),
            tavilySearch: tavilySearch({ dataStream }), // Add the Tavily tool
        },
        // ... rest of config
    });
    ```

## 3. Data Streaming Definition

1.  **Define New Delta Types:**
    *   Update `components/data-stream-handler.tsx` (or a shared types file) to include new delta types for Tavily search progress. Add a `toolCallId` to associate deltas with a specific tool invocation.
    ```typescript
    // components/data-stream-handler.tsx or types file
    export type TavilySearchStatus = 'Searching...' | 'Summarizing...' | 'Complete' | 'No results found.' | 'Error occurred during search.';
    export type TavilySource = { title: string; url: string; content?: string; score?: number }; // Define more strictly if needed

    export type DataStreamDelta = {
      type:
        | 'text-delta'
        // ... other existing types
        | 'tavily-search-status' // Overall status updates
        | 'tavily-search-sources' // Batch of sources found
        | 'tavily-summary-delta'; // Incremental summary text
      content: string | Suggestion | { // Use a union for content based on type
        toolCallId: string;
        status?: TavilySearchStatus;
        sources?: TavilySource[];
        delta?: string; // For summary delta
        summary?: string; // For final summary
        error?: string;
      };
    };
    ```

## 4. Frontend Implementation (UI Components & Real-time Updates)

1.  **Create `TavilySearchResults` Component:**
    *   Create `components/tavily-search-results.tsx`. This component will render the interactive search results UI.
    *   It should receive the `toolCallId` and initial `result` data from the `message.tsx` component.
    *   **State Management:**
        *   Use `useState` or `useReducer` to manage the component's internal state: `status` (loading, summarizing, complete, error), `sources` (array), `summary` (string).
        *   Initialize state based on the `result` prop if available (for re-renders).
    *   **Listen to Data Stream:**
        *   Import `useChat` to access the raw `dataStream`.
        *   Use `useEffect` to process the `dataStream` whenever it updates.
        *   Filter deltas based on `type` (`tavily-search-status`, `tavily-search-sources`, `tavily-summary-delta`) and matching `toolCallId`.
        *   Update the component's internal state based on the filtered deltas.
        ```typescript
        // components/tavily-search-results.tsx (Simplified Example)
        import React, { useState, useEffect, useMemo } from 'react';
        import { useChat } from '@ai-sdk/react';
        import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
        import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs" // Assuming Tabs exist
        import { LoaderIcon, LinkIcon } from '@/components/icons'; // Assuming icons exist
        import { Markdown } from '@/components/markdown';
        import { type TavilySearchStatus, type TavilySource, type DataStreamDelta } from './data-stream-handler'; // Adjust import path

        interface TavilySearchResultsProps {
          toolCallId: string;
          initialResult?: { // Data passed when message re-renders
              summary?: string;
              sources?: TavilySource[];
          };
          chatId: string; // Pass chatId to useChat
        }

        export function TavilySearchResults({ toolCallId, initialResult, chatId }: TavilySearchResultsProps) {
           const { data: dataStream } = useChat({ id: chatId }); // Get the stream for this chat

           const [status, setStatus] = useState<TavilySearchStatus>('Searching...');
           const [sources, setSources] = useState<TavilySource[]>(initialResult?.sources || []);
           const [summary, setSummary] = useState<string>(initialResult?.summary || '');
           const [error, setError] = useState<string | null>(null);

           // Process stream updates specific to this tool call
           useEffect(() => {
             if (!dataStream) return;

             // Find deltas relevant to this tool call
             const relevantDeltas = dataStream.filter(d => {
               const delta = d as DataStreamDelta;
               return delta.content && typeof delta.content === 'object' && delta.content.toolCallId === toolCallId;
             }) as DataStreamDelta[];

             relevantDeltas.forEach(delta => {
                 const content = delta.content as any; // Type assertion for simplicity
                 switch (delta.type) {
                     case 'tavily-search-status':
                         setStatus(content.status);
                         if(content.sources) setSources(s => [...s, ...content.sources.filter((ns: TavilySource) => !s.some(es => es.url === ns.url))]); // Append unique sources
                         if(content.summary) setSummary(content.summary); // Set final summary if provided with status
                         if(content.error) setError(content.error);
                         break;
                     case 'tavily-search-sources':
                          setSources(s => [...s, ...content.sources.filter((ns: TavilySource) => !s.some(es => es.url === ns.url))]); // Append unique sources
                          break;
                     case 'tavily-summary-delta':
                         setSummary(prev => prev + content.delta);
                         break;
                 }
             });
             // Note: This simple processing might need refinement for handling duplicate deltas if re-renders occur.
             // Using a ref to track processed delta indices might be more robust.

           }, [dataStream, toolCallId]);

          const uniqueSources = useMemo(() => {
             const seenUrls = new Set<string>();
             return sources.filter(source => {
               if (seenUrls.has(source.url)) {
                 return false;
               }
               seenUrls.add(source.url);
               return true;
             });
           }, [sources]);

           return (
             <Card className="w-full my-4">
               <CardHeader>
                 <CardTitle className="text-lg flex items-center gap-2">
                    Web Search Results
                    {(status === 'Searching...' || status === 'Summarizing...') && <LoaderIcon className="animate-spin" />}
                 </CardTitle>
                 {error && <p className="text-sm text-destructive">{error}</p>}
               </CardHeader>
               <CardContent>
                 {status === 'Searching...' && !error && <p className="text-muted-foreground">Searching the web...</p>}

                 {(status !== 'Searching...' || uniqueSources.length > 0) && !error && (
                    <Tabs defaultValue="summary" className="w-full">
                      <TabsList>
                        <TabsTrigger value="summary" disabled={status === 'Searching...' && summary.length === 0}>Summary</TabsTrigger>
                        <TabsTrigger value="sources" disabled={uniqueSources.length === 0}>Sources ({uniqueSources.length})</TabsTrigger>
                      </TabsList>
                      <TabsContent value="summary" className="mt-4 prose dark:prose-invert max-w-none">
                         {status === 'Summarizing...' && summary.length === 0 && <p className="text-muted-foreground">Generating summary...</p>}
                         {summary ? <Markdown>{summary}</Markdown> : status === 'Complete' && <p className="text-muted-foreground">Summary generated.</p>}
                         {status === 'No results found.' && <p className="text-muted-foreground">No relevant results found to summarize.</p>}
                      </TabsContent>
                      <TabsContent value="sources" className="mt-4 space-y-3">
                        {uniqueSources.map((source, index) => (
                          <div key={source.url || index} className="p-3 border rounded-md bg-muted/50">
                            <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline flex items-center gap-1">
                               <LinkIcon size={14} /> {source.title || source.url}
                            </a>
                            {source.content && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{source.content}</p>}
                          </div>
                        ))}
                        {uniqueSources.length === 0 && status !== 'Searching...' && <p className="text-muted-foreground text-sm">No sources found.</p>}
                      </TabsContent>
                    </Tabs>
                 )}
               </CardContent>
             </Card>
           );
        }
        ```

2.  **Integrate into `Message` Component:**
    *   Modify `components/message.tsx`.
    *   Inside the `map` function iterating through `message.parts`:
        *   Add a condition `if (type === 'tool-invocation')`.
        *   Inside this, check if `toolName === 'tavilySearch'`.
        *   If `state === 'call'`, render a loading state (e.g., "Searching the web...").
        *   If `state === 'result'`, render the `<TavilySearchResults />` component, passing the `toolCallId` and the `result` object from the tool invocation part. Ensure `chatId` is also passed.
    ```typescript
    // components/message.tsx
    // ... inside parts.map ...
    if (type === 'tool-invocation') {
        const { toolInvocation } = part;
        const { toolName, toolCallId, state } = toolInvocation;

        // ... existing tool handling ...

        if (toolName === 'tavilySearch') {
            if (state === 'call') {
                return (
                    <div key={toolCallId} className="p-3 border rounded-md bg-muted/50 my-2">
                         <p className="text-sm flex items-center gap-2 text-muted-foreground">
                            <LoaderIcon className="animate-spin" /> Searching the web...
                         </p>
                    </div>
                );
            }
            if (state === 'result') {
                 // Assuming 'result' now contains { toolCallId, summary, sources }
                 const { result } = toolInvocation;
                 return (
                     <TavilySearchResults
                        key={toolCallId}
                        toolCallId={toolCallId}
                        initialResult={result} // Pass summary/sources if they are part of the final result object
                        chatId={chatId}       // Pass chatId
                     />
                 );
            }
        }
        // ... other tool handling ...
    }
    ```

## 5. Testing and Refinement

1.  **Unit/Integration Tests (Optional but Recommended):**
    *   Write tests for the `tavilySearch` tool's `execute` function, potentially mocking the `fetch` calls to Tavily and the AI summarization model.
2.  **End-to-End Tests (Playwright):**
    *   Create new Playwright tests (`tests/tavily.test.ts`):
        *   Test triggering a search via a user message (e.g., "Search the web for the latest AI news").
        *   Verify the loading indicator appears.
        *   Verify that source elements appear incrementally (might require `waitFor` selectors or polling).
        *   Verify the summary appears.
        *   Verify clicking source links works.
        *   Test cases with multiple queries.
        *   Test error handling (e.g., if Tavily API key is invalid - mock this).
        *   Test the "No results found" state.
3.  **Manual Testing:**
    *   Thoroughly test various search queries.
    *   Test responsiveness of the UI updates.
    *   Test interaction with sources and summary tabs.
    *   Test on different screen sizes.
4.  **Refinement:**
    *   Adjust prompts for summarization based on quality.
    *   Optimize the number of results requested from Tavily (`max_results`).
    *   Refine the UI/UX of the `TavilySearchResults` component.
    *   Improve error handling and user feedback. Consider adding retry logic for Tavily calls if needed.

```

**Key Considerations:**

*   **Data Stream Handling:** The plan assumes the `TavilySearchResults` component directly processes the `dataStream` from `useChat`. This keeps the component self-contained but requires careful filtering based on `toolCallId`. An alternative is enhancing `DataStreamHandler` to route deltas, which might be cleaner if more tools adopt this pattern.
*   **API Costs:** Be mindful of Tavily API costs and the cost of the LLM used for summarization.
*   **Rate Limiting:** Implement handling for potential rate limits from Tavily or the summarization LLM.
*   **Error Handling:** Robustly handle errors from both the Tavily API calls and the summarization process, providing clear feedback to the user in the UI.
*   **UI Complexity:** The `TavilySearchResults` component will manage multiple states (loading search, loading summary, displaying sources, displaying summary). Ensure the UI clearly reflects the current state.
*   **Security:** Ensure the Tavily API key is securely stored and only used server-side within the tool's `execute` function.