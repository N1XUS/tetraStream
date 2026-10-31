import { select, type Completion, type Snapshot } from 'tetra-stream';

export const fields = [
  'name',
  'avatar',
  'role',
  'location',
  'bio',
  'skills',
  'website',
  'contact',
  'projects',
] as const;
export type ProfileField = (typeof fields)[number];
export interface ProfileFieldValue {
  value: unknown;
  status: Completion | 'pending' | undefined;
  itemStatus?: (Completion | undefined)[];
}
export type ProfileProjection = Record<ProfileField, ProfileFieldValue>;
export interface SkillItem {
  value: string;
  sourceIndex: number;
  status: Completion | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isProfileField(value: unknown): value is ProfileField {
  return typeof value === 'string' && fields.some((field) => field === value);
}

/**
 * Keep completion attached to its source item when the card skips other types.
 */
export function readSkillItems(snapshot: Snapshot<unknown>): SkillItem[] {
  const field = readProfile(snapshot).skills;
  if (!Array.isArray(field.value)) return [];
  return field.value.flatMap((value, sourceIndex) =>
    typeof value === 'string'
      ? [
          {
            value,
            sourceIndex,
            status: ['json', 'yaml', 'yml'].includes(snapshot.format)
              ? snapshot.status[`/skills/${sourceIndex}`]
              : field.itemStatus?.[sourceIndex],
          },
        ]
      : [],
  );
}

/** Demo-specific projection. The normalizer itself retains the source structure. */
export function readProfile(snapshot: Snapshot<unknown>): ProfileProjection {
  const result = Object.fromEntries(
    fields.map((field) => [field, { value: undefined, status: 'pending' }]),
  ) as ProfileProjection;
  if (!snapshot.data) return result;
  if (['json', 'yaml', 'yml'].includes(snapshot.format) && isRecord(snapshot.data)) {
    for (const field of fields) {
      if (Object.hasOwn(snapshot.data, field))
        result[field] = { value: snapshot.data[field], status: snapshot.status[`/${field}`] };
    }
  } else if (['ndjson', 'jsonl'].includes(snapshot.format) && Array.isArray(snapshot.data)) {
    // This demo treats each record as a profile update; the library preserves
    // the original records and their own paths.
    snapshot.data.forEach((record, index) => {
      if (!isRecord(record)) return;
      for (const field of fields) {
        if (!Object.hasOwn(record, field)) continue;
        result[field] = { value: record[field], status: snapshot.status[`/${index}/${field}`] };
        if (field === 'skills' && Array.isArray(record.skills))
          result[field].itemStatus = record.skills.map(
            (_, item) => snapshot.status[`/${index}/skills/${item}`],
          );
      }
    });
  } else if (['csv', 'tsv'].includes(snapshot.format) && Array.isArray(snapshot.data)) {
    const [headers, row] = snapshot.data;
    if (!Array.isArray(headers) || !Array.isArray(row)) return result;
    headers.forEach((field: unknown, column: number) => {
      if (!isProfileField(field) || !Object.hasOwn(row, column)) return;
      result[field] = { value: row[column], status: snapshot.status[`/1/${column}`] };
      if (field === 'skills') {
        const cell: unknown = row[column];
        if (typeof cell !== 'string') return;
        const pieces = cell.split(';');
        const items = pieces
          .map((value, index): { value: string; status: Completion } => ({
            value: value.trim(),
            status:
              index < pieces.length - 1 || result[field].status === 'complete'
                ? 'complete'
                : 'partial',
          }))
          .filter((item) => item.value !== '');
        result[field].value = items.map((item) => item.value);
        result[field].itemStatus = items.map((item) => item.status);
      }
    });
  } else {
    const text = (node: unknown): string => {
      if (!isRecord(node)) return '';
      if (node.kind === 'text') return typeof node.value === 'string' ? node.value : '';
      return Array.isArray(node.children) ? node.children.map(text).join('') : '';
    };
    const visit = (node: unknown, path: string): void => {
      if (!isRecord(node) || node.kind === 'text' || !Array.isArray(node.children)) return;
      const field =
        snapshot.format === 'xml'
          ? node.name
          : isRecord(node.attributes)
            ? node.attributes['data-field']
            : undefined;
      if (isProfileField(field)) {
        result[field] = { value: text(node), status: snapshot.status[path] };
        if (field === 'skills') {
          const items = node.children
            .map((child: unknown, index: number) => ({ child, path: `${path}/children/${index}` }))
            .filter((item) => isRecord(item.child) && item.child.kind === 'element');
          result[field].value = items.map((item) => text(item.child));
          result[field].itemStatus = items.map((item) => snapshot.status[item.path]);
        }
      }
      node.children.forEach((child: unknown, index: number) =>
        visit(child, `${path}/children/${index}`),
      );
    };
    visit(snapshot.data, '');
  }
  return result;
}

/** Resource URLs are atomic consumers: do not fetch provisional string prefixes. */
export function readAvatarSource(snapshot: Snapshot<unknown>): string | undefined {
  const avatar = readProfile(snapshot).avatar;
  // Project this format's field into a common object path for the library policy.
  const selected = select(
    {
      format: snapshot.format,
      state: snapshot.state,
      data: avatar.value === undefined ? undefined : { avatar: avatar.value },
      status:
        avatar.status === 'pending' || avatar.status === undefined
          ? {}
          : { '/avatar': avatar.status },
    },
    '/avatar',
    { require: 'complete' },
  );
  return selected.status === 'complete' &&
    typeof selected.value === 'string' &&
    selected.value.trim() !== ''
    ? selected.value
    : undefined;
}

/** A missing resource stops loading when the stream or its value is final. */
export function isAvatarPending(snapshot: Snapshot<unknown>): boolean {
  return snapshot.state === 'streaming' && readProfile(snapshot).avatar.status !== 'complete';
}
