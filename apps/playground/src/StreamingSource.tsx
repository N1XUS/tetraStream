import { clientEffect, Show } from '@rivetjs/runtime/dom';
import { CodeBlock } from '@rivetjs/ui/code-block';
import { EmptyState } from '@rivetjs/ui/empty-state';
import { Status } from '@rivetjs/ui/status';
import { Icon } from '@rivetjs/kit/icon';
import { Code2 } from 'lucide';

interface StreamingSourceProps {
  id: string;
  class?: string;
  label: string;
  heading: string;
  code: () => string;
  status: string;
  count: number;
  total: number;
  countId: string;
  emptyTitle: string;
  emptyDescription: string;
}

export function StreamingSource(props: StreamingSourceProps) {
  let region: HTMLDivElement | undefined;
  clientEffect(() => {
    props.code();
    if (region) region.scrollTop = region.scrollHeight;
  });
  return <CodeBlock class={`source-window ${props.class ?? ''}`}>
    <CodeBlock.Header><CodeBlock.Language>{props.heading}</CodeBlock.Language></CodeBlock.Header>
    <CodeBlock.Code id={props.id} ref={element => { region = element; }} code={props.code} wrap aria-label={props.label} />
    <Show when={!props.count}><EmptyState class="empty-source">
      <EmptyState.Header>
        <EmptyState.Media variant="icon"><Icon icon={Code2} size={24} /></EmptyState.Media>
        <EmptyState.Title>{props.emptyTitle}</EmptyState.Title>
        <EmptyState.Description>{props.emptyDescription}</EmptyState.Description>
      </EmptyState.Header>
    </EmptyState></Show>
    <div class="source-footer"><Status size="sm" color="accent" /><span>{props.status}</span><span id={props.countId}>{props.count} / {props.total}</span></div>
  </CodeBlock>;
}
