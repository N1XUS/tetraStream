import { signal } from '@rivetjs/reactivity';
import { Show } from '@rivetjs/runtime/dom';
import { Tabs } from '@rivetjs/ui/tabs';
import { Chip } from '@rivetjs/ui/chip';
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
import { CodeBlockRoot, CodeBlockCode } from '@rivetjs/ui/code-block';
import type { SortDescriptor } from '@rivetjs/cdk/collections/types';
import type { Snapshot } from 'tetra-stream';
import { readProfile, type ProfileField } from './profile.ts';

const columns = [
  { id: 'field', label: 'Field' },
  { id: 'value', label: 'Current value' },
  { id: 'status', label: 'Status' },
];
interface InspectorRow {
  id: ProfileField;
  label: string;
}
const text = (value: unknown) =>
  typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value);
export function ProfileInspector(props: {
  snapshot: () => Snapshot;
  rows: () => InspectorRow[];
  completeCount: () => number;
  fieldCount: () => number;
}) {
  const inspectorSort = signal<SortDescriptor | null>(null);
  const profile = () => readProfile(props.snapshot());
  const snapshot = props.snapshot;
  const done = () => snapshot().state === 'complete';
  return (
    <Tabs defaultSelectedKey="fields" class="inspector-tabs">
      <Tabs.List aria-label="Data inspector">
        <Tabs.Tab id="fields">
          Field status{' '}
          <span id="field-count">
            {props.completeCount()}/{props.fieldCount()}
          </span>
        </Tabs.Tab>
        <Tabs.Tab id="data">Parsed data</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel id="fields">
        <TableRoot class="inspector-table">
          <TableScrollContainer>
            <TableContent aria-label="Profile field status" sortDescriptor={inspectorSort}>
              <TableHeader columns={columns}>
                {(column: (typeof columns)[number]) => (
                  <TableColumn
                    id={column.id}
                    isRowHeader={column.id === 'field'}
                    textValue={column.label}
                  >
                    {column.label}
                  </TableColumn>
                )}
              </TableHeader>
              <TableBody items={props.rows}>
                {(row: InspectorRow) => (
                  <TableRow id={row.id} textValue={row.label} columns={columns}>
                    {(column: (typeof columns)[number]) => (
                      <TableCell
                        id={`${row.id}-${column.id}`}
                        textValue={
                          column.id === 'field'
                            ? row.label
                            : column.id === 'value'
                              ? text(profile()[row.id].value) || 'Waiting for data'
                              : profile()[row.id].status
                        }
                      >
                        <Show
                          when={column.id === 'field'}
                          fallback={
                            <Show
                              when={column.id === 'value'}
                              fallback={
                                <Chip
                                  size="sm"
                                  variant="soft"
                                  color={
                                    profile()[row.id].status === 'partial'
                                      ? 'warning'
                                      : profile()[row.id].status === 'complete'
                                        ? 'success'
                                        : 'default'
                                  }
                                >
                                  {profile()[row.id].status === 'pending'
                                    ? done()
                                      ? 'Not included'
                                      : 'Waiting'
                                    : profile()[row.id].status === 'partial'
                                      ? 'Partial'
                                      : 'Complete'}
                                </Chip>
                              }
                            >
                              <span>
                                {profile()[row.id].status === 'pending'
                                  ? done()
                                    ? 'Not included in response'
                                    : 'Waiting for data'
                                  : text(profile()[row.id].value)}
                              </span>
                            </Show>
                          }
                        >
                          {row.label}
                        </Show>
                      </TableCell>
                    )}
                  </TableRow>
                )}
              </TableBody>
            </TableContent>
          </TableScrollContainer>
        </TableRoot>
      </Tabs.Panel>
      <Tabs.Panel id="data">
        <CodeBlockRoot>
          <CodeBlockCode
            id="normalized-data"
            code={() => JSON.stringify(snapshot(), null, 2)}
            language="json"
            wrap
            aria-label="Parsed profile snapshot"
          />
        </CodeBlockRoot>
      </Tabs.Panel>
    </Tabs>
  );
}
