import type { FormatName as Format } from 'tetra-stream';

/** Formats used by the profile card; CSS has its own styling example. */
export type ProfileFormat = Exclude<Format, 'css'>;

const baseExamples = {
  json: `{
  "name": "Alex Morgan",
  "avatar": "/avatars/alex-morgan.webp",
  "role": "Product designer & creative developer",
  "location": "Portland, Oregon",
  "bio": "Making complex things feel simple. Currently exploring the space between thoughtful design and useful technology.",
  "skills": ["Interface design", "Creative coding", "Prototyping"],
  "website": "alexmorgan.design"
}`,
  xml: `<user>
  <name>Alex Morgan</name>
  <avatar>/avatars/alex-morgan.webp</avatar>
  <role>Product designer &amp; creative developer</role>
  <location>Portland, Oregon</location>
  <bio>Making complex things feel simple. Currently exploring the space between thoughtful design and useful technology.</bio>
  <skills>
    <skill>Interface design</skill>
    <skill>Creative coding</skill>
    <skill>Prototyping</skill>
  </skills>
  <website>alexmorgan.design</website>
</user>`,
  html: `<article class="user-card">
  <h2 data-field="name">Alex Morgan</h2>
  <span data-field="avatar">/avatars/alex-morgan.webp</span>
  <p data-field="role">Product designer &amp; creative developer</p>
  <p data-field="location">Portland, Oregon</p>
  <p data-field="bio">Making complex things feel simple. Currently exploring the space between thoughtful design and useful technology.</p>
  <ul data-field="skills">
    <li>Interface design</li>
    <li>Creative coding</li>
    <li>Prototyping</li>
  </ul>
  <span data-field="website">alexmorgan.design</span>
</article>`,
};

const profile: Record<string, string | string[]> = JSON.parse(baseExamples.json);
const yaml = `name: "Alex Morgan"
avatar: "/avatars/alex-morgan.webp"
role: "Product designer & creative developer"
location: "Portland, Oregon"
bio: >-
  Making complex things feel simple. Currently exploring the space between thoughtful design and useful technology.
skills:
  - Interface design
  - Creative coding
  - Prototyping
website: alexmorgan.design
`;
const ndjson =
  Object.entries(profile)
    .map(([field, value]) => JSON.stringify({ [field]: value }))
    .join('\n') + '\n';
const headers = Object.keys(profile);
const cells = Object.values(profile).map((value) =>
  Array.isArray(value) ? value.join('; ') : value,
);
const quoteCell = (value: string | string[]) => '"' + String(value).replaceAll('"', '""') + '"';
const csv = headers.join(',') + '\r\n' + cells.map(quoteCell).join(',') + '\r\n';
const tsv = headers.join('\t') + '\n' + cells.map(quoteCell).join('\t') + '\n';
export const examples: Record<ProfileFormat, string> = {
  ...baseExamples,
  yaml,
  yml: yaml,
  ndjson,
  jsonl: ndjson,
  csv,
  tsv,
};
