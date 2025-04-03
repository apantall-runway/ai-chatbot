import * as React from 'react';

import { cn } from '@/lib/utils';

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<'textarea'>
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        'flex min-h-[80px] w-full rounded-none border-2 border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground placeholder:font-unbounded placeholder:uppercase placeholder:text-xs focus-visible:outline-none focus-visible:ring-0 focus-visible:border-black dark:focus-visible:border-white focus-visible:bg-background/90 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';

export { Textarea };
