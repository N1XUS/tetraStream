import { select, type Snapshot } from 'tetra-stream';

export type NestedStatus = 'pending' | 'partial' | 'complete' | 'missing';
export interface NestedText {
  value: string | undefined;
  status: NestedStatus;
  path: string;
}
export interface NestedItem extends NestedText {
  sourceIndex: number;
}
export interface ProjectPreview {
  sourceIndex: number;
  path: string;
  status: NestedStatus;
  name: NestedText;
  summary: NestedText;
  stack: NestedItem[];
  stackStatus: NestedStatus;
}
export interface SocialPreview {
  sourceIndex: number;
  network: NestedText;
  handle: NestedText;
}
export interface NestedProfile {
  supported: boolean;
  email: NestedText;
  contactStatus: NestedStatus;
  socials: SocialPreview[];
  socialsStatus: NestedStatus;
  projectsStatus: NestedStatus;
  projects: ProjectPreview[];
}
export function supportsNestedProfile(format: string): boolean {
  return ['json', 'yaml', 'yml', 'ndjson', 'jsonl'].includes(format);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Follow JSON Lines' latest update while keeping its actual completion pointers. */
function fieldPath(snapshot: Snapshot<unknown>, field: string): string {
  if (!['ndjson', 'jsonl'].includes(snapshot.format) || !Array.isArray(snapshot.data))
    return '/' + field;
  for (let index = snapshot.data.length - 1; index >= 0; index--) {
    const record: unknown = snapshot.data[index];
    if (isRecord(record) && Object.hasOwn(record, field)) return `/${index}/${field}`;
  }
  return '/' + field;
}

/** Read nested display values without flattening the parser's original tree. */
export function readNestedProfile(snapshot: Snapshot<unknown>): NestedProfile {
  const supported = supportsNestedProfile(snapshot.format);
  const read = (path: string) =>
    supported
      ? select(snapshot as Snapshot<Record<string, unknown>>, path as `/${string}`)
      : { status: 'missing' as const, state: snapshot.state };
  const raw = (path: string): unknown => {
    const field = read(path);
    return 'value' in field ? field.value : undefined;
  };
  const text = (path: string): NestedText => {
    const field = read(path);
    return {
      path,
      status: field.status,
      value: 'value' in field && typeof field.value === 'string' ? field.value : undefined,
    };
  };
  const contact = fieldPath(snapshot, 'contact');
  const projects = fieldPath(snapshot, 'projects');
  const socials = raw(contact + '/socials');
  const projectValues = raw(projects);
  return {
    supported,
    email: text(contact + '/email'),
    contactStatus: read(contact).status,
    socialsStatus: read(contact + '/socials').status,
    socials: Array.isArray(socials)
      ? socials.flatMap((value: unknown, sourceIndex: number) =>
          isRecord(value)
            ? [
                {
                  sourceIndex,
                  network: text(`${contact}/socials/${sourceIndex}/network`),
                  handle: text(`${contact}/socials/${sourceIndex}/handle`),
                },
              ]
            : [],
        )
      : [],
    projectsStatus: read(projects).status,
    projects: Array.isArray(projectValues)
      ? projectValues.flatMap((value: unknown, sourceIndex: number) => {
          if (!isRecord(value)) return [];
          const path = `${projects}/${sourceIndex}`;
          const stack = raw(path + '/details/stack');
          return [
            {
              sourceIndex,
              path,
              status: read(path).status,
              name: text(path + '/name'),
              summary: text(path + '/details/summary'),
              stackStatus: read(path + '/details/stack').status,
              stack: Array.isArray(stack)
                ? stack.flatMap((item: unknown, index: number) =>
                    typeof item === 'string'
                      ? [{ ...text(`${path}/details/stack/${index}`), sourceIndex: index }]
                      : [],
                  )
                : [],
            },
          ];
        })
      : [],
  };
}
