import { bodyAttributes, bodyTags, headTags, htmlAttributes, type DocumentShell } from '@rivetjs/router/server';

const document: DocumentShell = input => ({
  start: '<!doctype html><html' + htmlAttributes({ ...input.head, html: { ...input.head?.html, class: 'light', 'data-theme': 'light' } }, { lang: 'en' })
    + '><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<meta name="theme-color" content="#fafaf7"><link rel="icon" type="image/svg+xml" href="/tetrastream-mark.svg">'
    + headTags(input.head, input) + '</head><body' + bodyAttributes(input.head) + '>',
  end: bodyTags(input.head, input) + '</body></html>',
});
export default document;
