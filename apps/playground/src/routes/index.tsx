import App from '../main';
export const head = {
  html: { lang: 'en', class: 'light', 'data-theme': 'light' },
  title: 'TetraStream — Structured data, as it arrives.',
  meta: [
    {
      name: 'description',
      content:
        'Stream JSON, YAML, XML, HTML, CSV, TSV and CSS into live interfaces. Try the user card, data grid and AI styling demos.',
    },
  ],
};
export default function Home() {
  return <App />;
}
