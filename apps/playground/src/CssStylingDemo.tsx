import { computed, onCleanup, signal } from '@rivetjs/reactivity';
import { clientEffect, For, Show } from '@rivetjs/runtime/dom';
import { Button } from '@rivetjs/ui/button';
import { Card } from '@rivetjs/ui/card';
import { Chip } from '@rivetjs/ui/chip';
import { DescriptionList } from '@rivetjs/ui/description-list';
import { NativeSelect } from '@rivetjs/ui/native-select';
import { Label } from '@rivetjs/ui/label';
import { Toolbar } from '@rivetjs/ui/toolbar';
import { Alert } from '@rivetjs/ui/alert';
import { Icon } from '@rivetjs/kit/icon';
import {
  ArrowUpRight,
  Check,
  Paintbrush,
  Pause,
  Play,
  RotateCcw,
  Square,
  StepForward,
} from 'lucide';
import { StreamNormalizer, type Snapshot } from 'tetra-stream';
import { PlaybackSlider } from './PlaybackSlider';
import { StreamingSource } from './StreamingSource';
import { seekStream } from './seek-stream';
import { transportLabel } from './presentation.ts';
import { cssStylingExample, cssVisualProperties, readCssPreview } from './css-styling.ts';
import './css-demo.css';

/** AI-generated CSS styles only this fixed element, one complete declaration at a time. */
export function CssStylingDemo() {
  let parser = new StreamNormalizer({ format: 'css' });
  const snapshot = signal<Snapshot>(parser.snapshot());
  const position = signal(0);
  const playing = signal(false);
  const speed = signal('1');
  const projection = computed(() =>
    readCssPreview(
      snapshot(),
      (property, value) => typeof CSS !== 'undefined' && CSS.supports(property, value),
    ),
  );
  const finished = () => snapshot().state !== 'streaming';
  let preview: HTMLDivElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function pause() {
    playing.set(false);
    clearTimeout(timer);
  }
  function reset() {
    pause();
    parser = new StreamNormalizer({ format: 'css' });
    snapshot.set(parser.snapshot());
    position.set(0);
  }
  function seek(next: number) {
    pause();
    const replay = seekStream(cssStylingExample, 'css', next);
    parser = replay.parser;
    position.set(replay.position);
    snapshot.set(replay.snapshot);
  }
  function nextChunk() {
    if (finished()) return;
    const end = Math.min(position() + 8, cssStylingExample.length);
    const chunk = cssStylingExample.slice(position(), end);
    position.set(end);
    try {
      snapshot.set(parser.write(chunk));
      if (end === cssStylingExample.length) {
        snapshot.set(parser.end());
        pause();
      }
    } catch {
      snapshot.set(parser.snapshot());
      pause();
    }
  }
  function tick() {
    if (!playing()) return;
    nextChunk();
    if (playing()) timer = setTimeout(tick, 100 / Number(speed()));
  }
  function toggle() {
    if (playing()) {
      pause();
      return;
    }
    if (finished()) reset();
    playing.set(true);
    tick();
  }
  function endStream() {
    pause();
    try {
      snapshot.set(parser.end());
    } catch {
      snapshot.set(parser.snapshot());
    }
  }
  clientEffect(() => {
    const style = projection().style;
    if (!preview) return;
    // Clearing owned properties first also restores the neutral card on rewind.
    for (const property of cssVisualProperties) preview.style.removeProperty(property);
    for (const property of cssVisualProperties) {
      const value = style[property];
      if (value !== undefined) preview.style.setProperty(property, value);
    }
  });
  clientEffect(() => {
    const onVisibility = () => {
      if (document.hidden) pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  });
  onCleanup(() => clearTimeout(timer));

  return (
    <section id="css-demo" tabIndex={-1} class="css-demo" aria-labelledby="css-title">
      <div class="section-heading">
        <div>
          <div class="eyebrow">A LITTLE STYLE. AS IT ARRIVES.</div>
          <h2 id="css-title">Watch an idea become an interface.</h2>
          <p>
            AI streams the CSS. Each finished declaration gives this card a little more character.
          </p>
        </div>
        <Chip variant="soft" color="accent">
          <Icon icon={Paintbrush} size={14} /> CSS → live styling
        </Chip>
      </div>
      <Card class="playground css-playground">
        <Toolbar class="demo-toolbar css-toolbar" aria-label="CSS playback">
          <div class="css-play-controls">
            <Button id="css-play" onPress={toggle}>
              <Icon icon={playing() ? Pause : finished() ? RotateCcw : Play} size={16} />
              {playing()
                ? 'Pause styling'
                : finished()
                  ? 'Style again'
                  : position()
                    ? 'Continue styling'
                    : 'Style this card'}
            </Button>
            <Button
              id="css-reset"
              variant="ghost"
              isIconOnly
              aria-label="Reset CSS styling"
              onPress={reset}
            >
              <Icon icon={RotateCcw} size={16} />
            </Button>
            <Button
              id="css-step"
              variant="secondary"
              size="sm"
              isDisabled={finished()}
              onPress={() => {
                pause();
                nextChunk();
              }}
            >
              <Icon icon={StepForward} size={15} /> Next chunk
            </Button>
          </div>
          <div class="speed-control">
            <Label for="css-speed">Playback speed</Label>
            <NativeSelect
              variant="secondary"
              value={speed()}
              onChange={(value) => speed.set(value)}
            >
              <NativeSelect.Trigger id="css-speed" aria-label="CSS playback speed">
                <NativeSelect.Option value="0.5">0.5×</NativeSelect.Option>
                <NativeSelect.Option value="1">1×</NativeSelect.Option>
                <NativeSelect.Option value="2">2×</NativeSelect.Option>
                <NativeSelect.Option value="4">4×</NativeSelect.Option>
              </NativeSelect.Trigger>
            </NativeSelect>
          </div>
        </Toolbar>
        <div class="css-workspace">
          <div class="css-source-panel">
            <div class="panel-heading">
              <h3>Incoming CSS</h3>
              <span class="file-label">ai-card.css</span>
            </div>
            <StreamingSource
              id="css-source"
              class="css-source-window"
              code={() => cssStylingExample.slice(0, position())}
              label="Received CSS source"
              heading="8 characters per chunk"
              count={position()}
              total={cssStylingExample.length}
              countId="css-characters"
              status={transportLabel({
                state: snapshot().state,
                playing: playing(),
                position: position(),
                length: cssStylingExample.length,
              })}
              emptyTitle="An idea, waiting for its style."
              emptyDescription="Press play to see the card take shape."
            />
          </div>
          <div class="css-preview-panel">
            <div class="panel-heading">
              <h3>One element. Styled live.</h3>
              <Chip
                id="css-applied-count"
                variant="soft"
                size="sm"
                color={snapshot().state === 'complete' ? 'success' : 'default'}
              >
                {projection().applied} applied
              </Chip>
            </div>
            <div class="css-preview-stage">
              <div
                id="css-preview"
                class="ai-card css-preview-card"
                ref={(element) => {
                  preview = element;
                }}
              >
                <div class="css-card-kicker">
                  <span class="css-card-dot" /> A SMALL CREATIVE ESCAPE
                </div>
                <h3>
                  Good ideas
                  <br />
                  take shape.
                </h3>
                <p>
                  A little color. A softer edge. Space to breathe. The same card, becoming something
                  new.
                </p>
                <div class="css-card-footer">
                  <span>Made a little more you.</span>
                  <Icon icon={ArrowUpRight} size={21} />
                </div>
              </div>
            </div>
            <p class="css-preview-caption">
              <Icon icon={Check} size={13} /> Completed values apply. Unfinished values keep
              arriving in the source.
            </p>
          </div>
        </div>
        <div class="demo-summary">
          <span id="css-summary" role="status" aria-live="polite">
            {projection().complete} complete · {projection().partial} partial ·{' '}
            {projection().applied} applied
            {snapshot().state === 'complete'
              ? '. Styling complete.'
              : playing()
                ? '. The next detail is arriving…'
                : position()
                  ? '. Continue or explore the stream below.'
                  : '. Start with a simple, neutral card.'}
          </span>
          <Button
            id="css-end"
            variant="ghost"
            size="sm"
            isDisabled={!position() || finished()}
            onPress={endStream}
          >
            <Icon icon={Square} size={13} /> End stream here
          </Button>
        </div>
        <PlaybackSlider
          id="css-playback"
          label="CSS playback position"
          position={position()}
          total={cssStylingExample.length}
          onSeek={seek}
        />
      </Card>
      <Show when={snapshot().state === 'error'}>
        <Alert status="danger" class="stream-error" role="alert" id="css-error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>This CSS couldn't finish.</Alert.Title>
            <Alert.Description>
              {snapshot().error} Completed declarations remain on the card.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      </Show>
      <Card class="css-declaration-inspector" aria-labelledby="css-declarations-title">
        <Card.Header>
          <Card.Title id="css-declarations-title">The details, as they arrive</Card.Title>
          <Card.Description>
            Only complete, supported visual declarations without <code>!important</code> apply to{' '}
            <code>.ai-card</code>.
          </Card.Description>
        </Card.Header>
        <Card.Content>
          <Show
            when={projection().declarations.length > 0}
            fallback={<Card.Description>Your first declaration will appear here.</Card.Description>}
          >
            <DescriptionList class="css-declarations">
              <For each={() => projection().declarations} by={(item) => item.id}>
                {(item) => (
                  <DescriptionList.Item
                    data-css-declaration={item().property}
                    data-completion={item().status}
                  >
                    <DescriptionList.Term>
                      <code>{item().property || 'property'}</code>
                    </DescriptionList.Term>
                    <DescriptionList.Details class="css-declaration-details">
                      <code>{item().value || '…'}</code>
                      <Chip
                        variant="soft"
                        size="sm"
                        color={
                          item().applied
                            ? 'success'
                            : item().status === 'partial'
                              ? 'warning'
                              : 'default'
                        }
                      >
                        {item().reason}
                      </Chip>
                    </DescriptionList.Details>
                  </DescriptionList.Item>
                )}
              </For>
            </DescriptionList>
          </Show>
        </Card.Content>
      </Card>
    </section>
  );
}
