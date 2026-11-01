import { Card } from '@rivetjs/ui/card';
import { Skeleton } from '@rivetjs/ui/skeleton';

/** Server-rendered copy remains available before the interactive module is downloaded. */
export function DemoPreview(props: { kind: 'csv' | 'css' }) {
  const csv = props.kind === 'csv';
  return (
    <section
      id={csv ? 'csv-demo' : 'css-demo'}
      tabIndex={-1}
      class={csv ? 'csv-demo' : 'css-demo'}
      aria-labelledby={csv ? 'csv-title' : 'css-title'}
    >
      <div class="section-heading">
        <div>
          <div class="eyebrow">
            {csv ? 'FROM ONE PROFILE TO A WHOLE TABLE.' : 'A LITTLE STYLE. AS IT ARRIVES.'}
          </div>
          <h2 id={csv ? 'csv-title' : 'css-title'}>
            {csv
              ? "A table that doesn't wait for the last row."
              : 'Watch an idea become an interface.'}
          </h2>
          <p>
            {csv
              ? 'CSV streams in. Headers, rows, and individual cells appear as they arrive.'
              : 'AI streams the CSS. Each finished declaration gives this card a little more character.'}
          </p>
        </div>
      </div>
      <Card
        class="deferred-demo"
        aria-busy="true"
        aria-label={csv ? 'Loading CSV demo' : 'Loading CSS demo'}
      >
        <Card.Content>
          <p role="status">Loading interactive example…</p>
          <Skeleton class="deferred-demo-placeholder" />
        </Card.Content>
      </Card>
    </section>
  );
}
export function InspectorPreview() {
  return (
    <div aria-busy="true">
      <p role="status">Loading field inspector…</p>
      <Skeleton class="deferred-inspector-placeholder" />
    </div>
  );
}
