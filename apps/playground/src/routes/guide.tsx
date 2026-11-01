import Guide from '../guide';
export const head = {
  html: { lang: 'en', class: 'light', 'data-theme': 'light' },
  title: 'Usage guide — TetraStream',
  meta: [
    {
      name: 'description',
      content:
        'TypeScript recipes for parser-free client/server APIs, structured SSE and NDJSON, user cards, tables, CSS and validation.',
    },
  ],
};
export default function GuidePage() {
  return <Guide />;
}
