import Guide from '../guide';
export const head = {
  html: { lang: 'en', class: 'light', 'data-theme': 'light' },
  title: 'Usage guide — TetraStream',
  meta: [{ name: 'description', content: 'Complete TypeScript recipes for streaming structured data, SSE, user cards, tables, CSS, custom languages and validation.' }],
};
export default function GuidePage() { return <Guide />; }
