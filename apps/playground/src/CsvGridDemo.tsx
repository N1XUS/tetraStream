import { computed, onCleanup, signal } from '@rivetjs/reactivity';
import { clientEffect, Show } from '@rivetjs/runtime/dom';
import { Button } from '@rivetjs/ui/button';
import { Chip } from '@rivetjs/ui/chip';
import { Accordion } from '@rivetjs/ui/accordion';
import { NativeSelect } from '@rivetjs/ui/native-select';
import { PlaybackSlider } from './PlaybackSlider';
import { seekStream } from './seek-stream';
import { Skeleton } from '@rivetjs/ui/skeleton';
import {
  TableRoot,
  TableBody,
  TableCell,
  TableColumn,
  TableContent,
  TableHeader,
  TableRow,
  TableScrollContainer,
} from '@rivetjs/ui/table';
import type { SortDescriptor } from '@rivetjs/cdk/collections/types';
import { TextArea } from '@rivetjs/ui/textarea';
import { TextField } from '@rivetjs/ui/textfield';
import { Label } from '@rivetjs/ui/label';
import { Description } from '@rivetjs/ui/description';
import { Alert } from '@rivetjs/ui/alert';
import { EmptyState } from '@rivetjs/ui/empty-state';
import { Card } from '@rivetjs/ui/card';
import { Toolbar } from '@rivetjs/ui/toolbar';
import { StreamingSource } from './StreamingSource';
import { Icon } from '@rivetjs/kit/icon';
import { Check, Code2, Pause, Play, RotateCcw, Square, StepForward, Table2 } from 'lucide';
import { StreamNormalizer, type Snapshot } from 'tetra-stream';
import {
  csvGridExample,
  readCsvGrid,
  type GridRow,
  type GridColumn,
  type GridCell,
} from './csv-grid.ts';
import { createCsvGridCollection } from './csv-grid-collection.ts';
import { csvEmptyState, csvSummary, transportLabel } from './presentation.ts';

export function CsvGridDemo() {
  const source = signal(csvGridExample);
  const draft = signal(csvGridExample);
  let parser = new StreamNormalizer({ format: 'csv' });
  const snapshot = signal<Snapshot>(parser.snapshot());
  const position = signal(0);
  const playing = signal(false);
  const speed = signal('1');
  const sortState = signal<SortDescriptor | null>(null);
  const grid = computed(() => readCsvGrid(snapshot()));
  const { columns, rows: tableRows, reset: resetCollection } = createCsvGridCollection(grid);
  const finished = () => snapshot().state !== 'streaming';
  const failed = () => snapshot().state === 'error';
  const summary = () =>
    csvSummary({
      state: snapshot().state,
      rows: grid().rows.length,
      completeRows: grid().completeRows,
      playing: playing(),
      position: position(),
      length: source().length,
    });
  const empty = () => csvEmptyState(snapshot(), position());
  let timer: ReturnType<typeof setTimeout> | undefined;

  function pause() {
    playing.set(false);
    clearTimeout(timer);
  }
  function reset(next = source()) {
    pause();
    source.set(next);
    resetCollection();
    parser = new StreamNormalizer({ format: 'csv' });
    snapshot.set(parser.snapshot());
    position.set(0);
  }
  function seek(next: number) {
    pause();
    const replay = seekStream(source(), 'csv', next);
    resetCollection();
    parser = replay.parser;
    position.set(replay.position);
    snapshot.set(replay.snapshot);
  }
  function nextChunk() {
    if (finished()) return;
    const end = Math.min(position() + 4, source().length);
    const chunk = source().slice(position(), end);
    position.set(end);
    try {
      snapshot.set(parser.write(chunk));
      if (end === source().length) {
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
    if (playing()) timer = setTimeout(tick, 75 / Number(speed()));
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
    const onVisibility = () => {
      if (document.hidden) pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  });
  onCleanup(() => clearTimeout(timer));

  return (
    <section id="csv-demo" tabIndex={-1} class="csv-demo" aria-labelledby="csv-title">
      <div class="section-heading">
        <div>
          <div class="eyebrow">FROM ONE PROFILE TO A WHOLE TABLE.</div>
          <h2 id="csv-title">A table that doesn't wait for the last row.</h2>
          <p>CSV streams in. Headers, rows, and individual cells appear as they arrive.</p>
        </div>
        <Chip variant="soft" color="accent">
          <Icon icon={Table2} size={14} /> CSV → data grid
        </Chip>
      </div>
      <Card class="playground csv-playground">
        <Toolbar class="demo-toolbar" aria-label="CSV playback">
          <div class="csv-play-controls">
            <Button id="csv-play" onPress={toggle}>
              <Icon icon={playing() ? Pause : finished() ? RotateCcw : Play} size={16} />
              {playing()
                ? 'Pause table'
                : finished()
                  ? 'Play again'
                  : position()
                    ? 'Continue table'
                    : 'Stream the table'}
            </Button>
            <Button
              id="csv-reset"
              variant="ghost"
              isIconOnly
              aria-label="Reset CSV table"
              onPress={() => reset()}
            >
              <Icon icon={RotateCcw} size={16} />
            </Button>
            <Button
              id="csv-step"
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
            <Label for="csv-speed">Playback speed</Label>
            <NativeSelect
              variant="secondary"
              value={speed()}
              onChange={(value) => speed.set(value)}
            >
              <NativeSelect.Trigger id="csv-speed" aria-label="CSV playback speed">
                <NativeSelect.Option value="0.5">0.5×</NativeSelect.Option>
                <NativeSelect.Option value="1">1×</NativeSelect.Option>
                <NativeSelect.Option value="2">2×</NativeSelect.Option>
                <NativeSelect.Option value="4">4×</NativeSelect.Option>
              </NativeSelect.Trigger>
            </NativeSelect>
          </div>
        </Toolbar>
        <div class="csv-workspace">
          <div class="csv-source-panel">
            <div class="panel-heading">
              <h3>Incoming CSV</h3>
              <span class="file-label">team.csv</span>
            </div>
            <StreamingSource
              id="csv-source"
              class="csv-source-window"
              code={() => source().slice(0, position())}
              label="Received CSV text"
              heading="4 characters per chunk"
              count={position()}
              total={source().length}
              countId="csv-characters"
              status={transportLabel({
                state: snapshot().state,
                playing: playing(),
                position: position(),
                length: source().length,
              })}
              emptyTitle="A table. One text stream."
              emptyDescription="Press play to start the table."
            />
          </div>
          <div class="csv-grid-panel">
            <div class="panel-heading">
              <h3>Live data grid</h3>
              <Chip
                size="sm"
                variant="soft"
                color={snapshot().state === 'complete' ? 'success' : 'default'}
                id="csv-row-count"
              >
                {grid().completeRows} complete / {grid().rows.length} rows
              </Chip>
            </div>
            <TableRoot class="csv-table" id="csv-grid">
              <TableScrollContainer>
                <TableContent
                  sortDescriptor={sortState}
                  aria-label="Streamed CSV team data"
                  aria-describedby="csv-grid-caption"
                  class="csv-table-content"
                >
                  <TableHeader columns={columns}>
                    {(column: GridColumn) => (
                      <TableColumn
                        focusMode="cell"
                        id={column.id}
                        isRowHeader={column.id === 'row-number'}
                        textValue={column.label}
                      >
                        <span class="csv-column-label">
                          {column.label}
                          <Show when={column.status === 'partial'}>
                            <Chip size="sm" color="warning" variant="soft">
                              Partial
                            </Chip>
                          </Show>
                        </span>
                      </TableColumn>
                    )}
                  </TableHeader>
                  <TableBody
                    items={tableRows}
                    renderEmptyState={() => (
                      <EmptyState class="csv-empty">
                        <EmptyState.Header>
                          <EmptyState.Media variant="icon">
                            <Icon icon={Table2} size={24} />
                          </EmptyState.Media>
                          <EmptyState.Title>{empty().title}</EmptyState.Title>
                          <EmptyState.Description>{empty().description}</EmptyState.Description>
                        </EmptyState.Header>
                      </EmptyState>
                    )}
                  >
                    {(row: GridRow) => (
                      <TableRow
                        id={row.id}
                        textValue={`Row ${row.index}`}
                        columns={() => row.cells}
                      >
                        {(cell: GridCell) => (
                          <TableCell
                            id={`${row.id}-${cell.columnId}`}
                            textValue={
                              cell.columnId === 'row-state'
                                ? row.status
                                : cell.status === 'pending'
                                  ? 'Waiting'
                                  : cell.status === 'missing'
                                    ? 'Missing'
                                    : cell.value || 'Empty'
                            }
                          >
                            <Show
                              when={cell.columnId === 'row-state'}
                              fallback={
                                <span
                                  class={`csv-cell-value csv-cell-${cell.status}`}
                                  data-csv-cell={`${row.id}/${cell.columnId}`}
                                  data-completion={cell.status}
                                >
                                  <Show
                                    when={cell.status === 'pending'}
                                    fallback={
                                      <>
                                        <span>
                                          {cell.status === 'missing'
                                            ? '—'
                                            : cell.value === ''
                                              ? 'Empty'
                                              : cell.value}
                                        </span>
                                        <Show when={cell.status === 'partial'}>
                                          <Chip size="sm" color="warning" variant="soft">
                                            Partial
                                          </Chip>
                                        </Show>
                                        <Show
                                          when={
                                            cell.status === 'complete' &&
                                            cell.columnId !== 'row-number'
                                          }
                                        >
                                          <Icon
                                            icon={Check}
                                            size={12}
                                            class="csv-cell-check"
                                            aria-label="Complete"
                                          />
                                        </Show>
                                      </>
                                    }
                                  >
                                    <Skeleton
                                      class="csv-cell-skeleton"
                                      aria-label="Waiting for this cell"
                                    />
                                  </Show>
                                </span>
                              }
                            >
                              <Chip
                                size="sm"
                                variant="soft"
                                color={row.status === 'complete' ? 'success' : 'warning'}
                              >
                                {row.status === 'complete' ? 'Complete' : 'Partial'}
                              </Chip>
                            </Show>
                          </TableCell>
                        )}
                      </TableRow>
                    )}
                  </TableBody>
                </TableContent>
              </TableScrollContainer>
            </TableRoot>
            <p class="csv-grid-caption" id="csv-grid-caption">
              Partial cells keep growing. A check means the cell is complete; the row completes at
              its line boundary. Scroll horizontally to see all columns.
            </p>
          </div>
        </div>
        <div class="demo-summary">
          <span id="csv-summary" role="status" aria-live="polite">
            {summary()}
          </span>
          <Button
            id="csv-end"
            variant="ghost"
            size="sm"
            isDisabled={!position() || finished()}
            onPress={endStream}
          >
            <Icon icon={Square} size={13} /> End stream here
          </Button>
        </div>
        <PlaybackSlider
          id="csv-playback"
          label="CSV playback position"
          position={position()}
          total={source().length}
          onSeek={seek}
        />
      </Card>
      <Show when={failed()}>
        <Alert status="danger" class="stream-error" role="alert" id="csv-error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>This CSV couldn't finish.</Alert.Title>
            <Alert.Description>
              {snapshot().error} Received rows and partial cells remain visible.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      </Show>
      <Accordion class="csv-editor" variant="surface">
        <Accordion.Item id="csv-source-editor">
          <Accordion.Heading>
            <Accordion.Trigger>
              <span class="accordion-label">
                <Icon icon={Code2} size={16} /> Edit CSV source
              </span>
              <Accordion.Indicator />
            </Accordion.Trigger>
          </Accordion.Heading>
          <Accordion.Panel>
            {() => (
              <Accordion.Body>
                <TextField fullWidth>
                  <Label for="csv-input">CSV with a header row</Label>
                  <TextArea
                    id="csv-input"
                    fullWidth
                    value={draft()}
                    onFocus={pause}
                    onInput={(event) => draft.set(event.currentTarget.value)}
                    spellCheck={false}
                  />
                  <Description>
                    Use any column names and any number of rows. Quoted commas, escaped quotes,
                    empty cells, and multiline values are supported. Values stay strings.
                  </Description>
                </TextField>
                <div class="csv-editor-actions">
                  <Button id="csv-apply" onPress={() => reset(draft())}>
                    Use this CSV
                  </Button>
                  <Button variant="ghost" onPress={() => draft.set(csvGridExample)}>
                    Restore example
                  </Button>
                </div>
              </Accordion.Body>
            )}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </section>
  );
}
