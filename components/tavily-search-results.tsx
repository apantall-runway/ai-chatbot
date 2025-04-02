'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useChat } from '@ai-sdk/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import type {
  TavilySearchStatus,
  TavilySource,
  DataStreamDelta,
} from './data-stream-handler';

interface TavilySearchResultsProps {
  toolCallId: string;
  initialResult?: {
    summary?: string;
    sources?: TavilySource[];
  };
  chatId: string;
}

export function TavilySearchResults({
  toolCallId,
  initialResult,
  chatId,
}: TavilySearchResultsProps) {
  const { data: dataStream } = useChat({ id: chatId });

  const [status, setStatus] = useState<TavilySearchStatus>('Searching...');
  const [sources, setSources] = useState<TavilySource[]>(
    initialResult?.sources || [],
  );
  const [summary, setSummary] = useState<string>(initialResult?.summary || '');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<boolean>(true);

  // Process stream updates specific to this tool call
  useEffect(() => {
    if (!dataStream) return;

    // Find deltas relevant to this tool call
    const relevantDeltas = dataStream.filter((d) => {
      const delta = d as DataStreamDelta;
      return (
        delta.content &&
        typeof delta.content === 'object' &&
        'toolCallId' in delta.content &&
        delta.content.toolCallId === toolCallId
      );
    }) as DataStreamDelta[];

    relevantDeltas.forEach((delta) => {
      if (typeof delta.content === 'object' && 'toolCallId' in delta.content) {
        const content = delta.content as any; // Type assertion for simplicity

        switch (delta.type) {
          case 'tavily-search-status':
            if (content.status) setStatus(content.status);
            if (content.sources)
              setSources((s) => [
                ...s,
                ...content.sources.filter(
                  (ns: TavilySource) => !s.some((es) => es.url === ns.url),
                ),
              ]); // Append unique sources
            if (content.summary) setSummary(content.summary); // Set final summary if provided with status
            if (content.error) setError(content.error);
            break;
          case 'tavily-search-sources':
            if (content.sources)
              setSources((s) => [
                ...s,
                ...content.sources.filter(
                  (ns: TavilySource) => !s.some((es) => es.url === ns.url),
                ),
              ]); // Append unique sources
            break;
          case 'tavily-summary-delta':
            if (content.delta) setSummary((prev) => prev + content.delta);
            break;
        }
      }
    });
  }, [dataStream, toolCallId]);

  const uniqueSources = useMemo(() => {
    const seenUrls = new Set<string>();
    return sources.filter((source) => {
      if (seenUrls.has(source.url)) {
        return false;
      }
      seenUrls.add(source.url);
      return true;
    });
  }, [sources]);

  return (
    <Card className="w-full my-4">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            Web Search Results
            {(status === 'Searching...' || status === 'Summarizing...') && (
              <span className="animate-spin">⟳</span>
            )}
          </CardTitle>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded(!expanded)}
          aria-label={
            expanded ? 'Collapse search results' : 'Expand search results'
          }
          className="transition-transform duration-200"
          style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(180deg)' }}
        >
          ▲
        </Button>
      </CardHeader>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <CardContent>
              {status === 'Searching...' &&
                !error &&
                uniqueSources.length === 0 && (
                  <p className="text-gray-500">Searching the web...</p>
                )}

              {(status !== 'Searching...' || uniqueSources.length > 0) &&
                !error && (
                  <Tabs defaultValue="summary" className="w-full">
                    <TabsList>
                      <TabsTrigger
                        value="summary"
                        disabled={
                          status === 'Searching...' && summary.length === 0
                        }
                      >
                        Summary
                      </TabsTrigger>
                      <TabsTrigger
                        value="sources"
                        disabled={uniqueSources.length === 0}
                      >
                        Sources ({uniqueSources.length})
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent
                      value="summary"
                      className="mt-4 prose dark:prose-invert max-w-none"
                    >
                      {status === 'Summarizing...' && summary.length === 0 && (
                        <p className="text-gray-500">Generating summary...</p>
                      )}
                      {summary ? (
                        <Markdown>{summary}</Markdown>
                      ) : (
                        status === 'Complete' && (
                          <p className="text-gray-500">Summary generated.</p>
                        )
                      )}
                      {status === 'No results found.' && (
                        <p className="text-gray-500">
                          No relevant results found to summarize.
                        </p>
                      )}
                    </TabsContent>
                    <TabsContent value="sources" className="mt-4 space-y-3">
                      {uniqueSources.map((source, index) => (
                        <div
                          key={source.url || index}
                          className="p-3 border rounded-md bg-gray-50 dark:bg-gray-800"
                        >
                          <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              className="h-3.5 w-3.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                              />
                            </svg>
                            {source.title || source.url}
                          </a>
                          {source.content && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                              {source.content}
                            </p>
                          )}
                        </div>
                      ))}
                      {uniqueSources.length === 0 &&
                        status !== 'Searching...' && (
                          <p className="text-gray-500 text-sm">
                            No sources found.
                          </p>
                        )}
                    </TabsContent>
                  </Tabs>
                )}
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
