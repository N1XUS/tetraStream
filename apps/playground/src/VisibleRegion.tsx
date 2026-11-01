import { Alert } from '@rivetjs/ui/alert';
import { Button } from '@rivetjs/ui/button';
import { signal } from '@rivetjs/reactivity';
import { clientEffect, Show, ErrorBoundary, type DOMValue } from '@rivetjs/runtime/dom';

/** Guard module mounting as well as downloading, including during a parent adopt run. */
export function VisibleRegion(props: { fallback: () => DOMValue; children: () => DOMValue }) {
  const visible = signal(false);
  let host: HTMLDivElement | undefined;
  clientEffect(() => {
    if (!host) return;
    if (typeof IntersectionObserver === 'undefined') {
      visible.set(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        visible.set(true);
      },
      { rootMargin: '200px 0px' },
    );
    observer.observe(host);
    return () => observer.disconnect();
  });
  return (
    <div
      ref={(element) => {
        host = element;
      }}
      class="deferred-region"
    >
      <ErrorBoundary
        fallback={(_error, retry) => (
          <Alert status="danger" role="alert">
            <Alert.Content>
              <Alert.Title>Couldn’t load this example.</Alert.Title>
              <Alert.Description>Check your connection and try again.</Alert.Description>
              <Button variant="secondary" size="sm" onPress={retry}>
                Try again
              </Button>
            </Alert.Content>
          </Alert>
        )}
      >
        <Show when={visible()} fallback={() => props.fallback()}>
          {() => props.children()}
        </Show>
      </ErrorBoundary>
    </div>
  );
}
