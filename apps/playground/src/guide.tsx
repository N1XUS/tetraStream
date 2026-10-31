import { signal } from '@rivetjs/reactivity';
import { render, For } from '@rivetjs/runtime/dom';
import { Navbar } from '@rivetjs/ui/navbar';
import { Link } from '@rivetjs/ui/link';
import { Chip } from '@rivetjs/ui/chip';
import { Card } from '@rivetjs/ui/card';
import { CodeBlock } from '@rivetjs/ui/code-block';
import { Alert } from '@rivetjs/ui/alert';
import { Table } from '@rivetjs/ui/table';
import { DescriptionList } from '@rivetjs/ui/description-list';
import { Accordion } from '@rivetjs/ui/accordion';
import { Tabs } from '@rivetjs/ui/tabs';
import type { SortDescriptor } from '@rivetjs/cdk/collections/types';
import { Icon } from '@rivetjs/kit/icon';
import { ArrowLeft, ArrowRight, Download, Braces, Image, Radio } from 'lucide';
import { BrandMark } from './BrandMark';
import { exampleHtml, guideExamples, installCommand } from './guide-examples';
import { sseWireExample } from './sse-guide.ts';
import './style.css';
import './guide.css';

const sections = [
  { id: 'installation', title: 'Install TetraStream' },
  { id: 'quickstart', title: 'Build a live user card' },
  { id: 'completion', title: 'Partial vs. complete' },
  { id: 'transport', title: 'Connect your text stream' },
  { id: 'csv', title: 'Render CSV as a table' },
  { id: 'css', title: 'Style an element with CSS' },
  { id: 'patches', title: 'Use incremental patches' },
  { id: 'validation', title: 'Validate finished data' },
  { id: 'rivet', title: 'Use RivetJS + Rivet UI' },
  { id: 'strategies', title: 'Add your own language' },
  { id: 'reference', title: 'Formats & API reference' },
];
const formatColumns = [
  { id: 'name', name: 'Format', isRowHeader: true },
  { id: 'shape', name: 'Data shape' },
  { id: 'path', name: 'Example status path' },
];
const formatRows = [
  { id: 'json', name: 'JSON · YAML / YML', shape: 'Objects, arrays, and scalars', path: '/name · /skills/0' },
  { id: 'ndjson', name: 'NDJSON / JSONL', shape: 'Array of records, including the open record', path: '/0/name' },
  { id: 'csv', name: 'CSV · TSV', shape: 'Array of string rows, including the header', path: '/1/0' },
  { id: 'css', name: 'CSS', shape: 'Stylesheet, rules, declarations, and at-rules', path: '/nodes/0/nodes/0/value' },
  { id: 'markup', name: 'XML · HTML', shape: 'Document → elements → text nodes', path: '/children/0/children/0' },
];

function Example(props: { title: string; code: string; language?: string }) {
  return <CodeBlock class="guide-code"><CodeBlock.Header>
    <CodeBlock.Language language={props.language ?? 'ts'}>{props.title}</CodeBlock.Language>
    <CodeBlock.CopyButton code={() => props.code} aria-label={`Copy ${props.title}`} />
  </CodeBlock.Header><CodeBlock.Code code={() => props.code} language={props.language ?? 'ts'} wrap aria-label={props.title} /></CodeBlock>;
}

function Guide() {
  const sort = signal<SortDescriptor | null>(null);
  return <>
    <a class="skip-link" href="#quickstart">Skip to the user card guide</a>
    <Navbar position="static" maxWidth="full" aria-label="Guide navigation"><Navbar.Header class="site-header">
      <Navbar.Brand><a class="brand" href="/" aria-label="TetraStream home"><span class="brand-symbol"><BrandMark /></span>TetraStream<span class="brand-caption">Usage guide</span></a></Navbar.Brand>
      <Navbar.Spacer /><Navbar.Content><Navbar.Item href="/#demo"><Icon icon={ArrowLeft} size={14} /> Live demos</Navbar.Item></Navbar.Content>
    </Navbar.Header></Navbar>
    <main class="guide-page">
      <header class="guide-intro"><Chip variant="soft" color="accent"><Icon icon={Braces} size={14} /> TypeScript · 0.1.x</Chip>
        <h1>From a text chunk<br />to a live interface.</h1>
        <p>A practical guide to TetraStream. Start with a working user card, see exactly how values reach the page, then connect your own stream.</p>
        <div class="guide-intro-facts"><span>Complete examples</span><span>No provider required to start</span><span>Framework independent</span></div>
      </header>
      <div class="guide-layout">
        <nav class="guide-toc" aria-label="On this page"><p>ON THIS PAGE</p><For each={sections} by={section => section.id}>{section => <Link href={`#${section().id}`}>{section().title}</Link>}</For><Link href="/#demo">Back to the demos <Link.Icon><Icon icon={ArrowRight} size={14} /></Link.Icon></Link></nav>
        <div class="guide-content">
          <section id="installation" aria-labelledby="installation-title"><div class="eyebrow">01 · SET UP</div><h2 id="installation-title">Install TetraStream.</h2>
            <p>TetraStream is an ESM library written in strict TypeScript. It includes JavaScript output and TypeScript declarations for modern browsers and Node.js 20+. Your interface can use any framework.</p>
            <Alert status="accent"><Alert.Indicator /><Alert.Content><Alert.Title>An early release, ready to try.</Alert.Title><Alert.Description>Install from npm inside your application. To test the exact build used by these demos, download the archive and run <code>npm install ./tetra-stream.tgz</code>.</Alert.Description></Alert.Content></Alert>
            <div class="guide-actions"><Link href="/downloads/tetra-stream.tgz" download><Icon icon={Download} size={15} /> Download this demo build (.tgz)</Link></div>
            <Example title="Terminal · inside your application" language="bash" code={installCommand} />
            <p class="guide-note">The examples below are client-side TypeScript. Use your existing browser TypeScript bundler. With Vite, replace the root <code>index.html</code> and <code>src/main.ts</code> with the two files below, then run your development server. The simulated source works without an API key or backend.</p>
          </section>
          <section id="quickstart" aria-labelledby="quickstart-title"><div class="eyebrow">02 · FIRST WORKING EXAMPLE</div><h2 id="quickstart-title">Build a live user card.</h2>
            <p>This example uses native DOM elements so every rendering step is visible. A small async generator simulates your AI provider. Each <code>yield</code> delivers another text chunk; <code>streamStructured</code> gives you a snapshot to render.</p>
            <div class="guide-outcomes"><Card><Card.Header><Icon icon={Radio} size={20} /><Card.Title>Text appears early.</Card.Title></Card.Header><Card.Content><Card.Description><code>name.textContent</code> and <code>bio.textContent</code> update on every snapshot. No hidden render function.</Card.Description></Card.Content></Card><Card><Card.Header><Icon icon={Image} size={20} /><Card.Title>The avatar waits.</Card.Title></Card.Header><Card.Content><Card.Description>The image source is assigned only after its entire URL is complete. The placeholder stays until the image loads.</Card.Description></Card.Content></Card></div>
            <p>For the sample portrait, <Link href="/avatars/alex-morgan.png" download>download this avatar</Link> and save it as <code>public/avatars/alex-morgan.png</code>, or replace the URL in the example with an image your app serves.</p>
            <Example title="index.html" language="html" code={exampleHtml} />
            <Example title="src/main.ts · complete user card" code={guideExamples.profile} />
            <DescriptionList><DescriptionList.Item><DescriptionList.Term>First chunk</DescriptionList.Term><DescriptionList.Details><code>Alex</code> is already visible and its name status is <code>partial</code>.</DescriptionList.Details></DescriptionList.Item><DescriptionList.Item><DescriptionList.Term>Later chunks</DescriptionList.Term><DescriptionList.Details>The name completes, the bio grows, and the avatar URL is withheld while it is unfinished.</DescriptionList.Details></DescriptionList.Item><DescriptionList.Item><DescriptionList.Term>End of input</DescriptionList.Term><DescriptionList.Details>The adapter calls <code>end()</code>, validates the document syntax, and yields the final snapshot with <code>state: 'complete'</code>.</DescriptionList.Details></DescriptionList.Item></DescriptionList>
            <Link href="/#demo">Explore the same behavior with the playback slider <Link.Icon><Icon icon={ArrowRight} size={14} /></Link.Icon></Link>
          </section>
          <section id="completion" aria-labelledby="completion-title"><div class="eyebrow">03 · CHOOSE WHEN TO SHOW A VALUE</div><h2 id="completion-title">Partial is useful. Complete is specific.</h2>
            <p>A snapshot contains <code>data</code>, <code>status</code>, and <code>state</code>. Missing fields have not necessarily arrived yet. Each status key is a JSON Pointer: <code>/name</code> is the name field, and <code>/skills/0</code> is the first skill.</p>
            <DescriptionList><DescriptionList.Item><DescriptionList.Term><Chip size="sm" variant="soft">Pending</Chip></DescriptionList.Term><DescriptionList.Details>No value is available, or your completion policy is withholding it. Show a placeholder.</DescriptionList.Details></DescriptionList.Item><DescriptionList.Item><DescriptionList.Term><Chip size="sm" variant="soft" color="warning">Partial</Chip></DescriptionList.Term><DescriptionList.Details>The available value can grow or change. Good for names, descriptions, and table cells.</DescriptionList.Details></DescriptionList.Item><DescriptionList.Item><DescriptionList.Term><Chip size="sm" variant="soft" color="success">Complete</Chip></DescriptionList.Term><DescriptionList.Details>The field ended syntactically. The rest of the response can still be arriving or fail later.</DescriptionList.Details></DescriptionList.Item></DescriptionList>
            <Example title="completion.ts · run independently" code={guideExamples.fields} />
            <p><code>select(snapshot, path)</code> exposes partial values by default. Use <code>{`{ when: 'complete' }`}</code> for URLs and other values that need a closing boundary. Use <code>{`{ when: 'document' }`}</code> to wait for successful document EOF. A missing field becomes <code>missing</code> once it can no longer arrive.</p>
            <Alert status="warning"><Alert.Indicator /><Alert.Content><Alert.Title>Completion does not validate your application model.</Alert.Title><Alert.Description><code>StreamNormalizer&lt;Profile&gt;</code> provides types, not runtime proof. Data is <code>DeepPartial&lt;Profile&gt; | undefined</code>; a finished response can omit fields or have the wrong shape. Validate before acting on it.</Alert.Description></Alert.Content></Alert>
          </section>
          <section id="transport" aria-labelledby="transport-title"><div class="eyebrow">04 · CONNECT YOUR PROVIDER</div><h2 id="transport-title">Stream plain text or SSE.</h2>
            <p>You do not need a finished JSON response, and you should not wait for <code>response.json()</code>. Read arriving bytes, extract the generated text, and feed each piece to TetraStream. The document can remain unfinished throughout the connection.</p>
            <p>For example, the first text delta can be <code>{'{"name":"Al'}</code>; it already renders <strong>Al</strong> as a partial name. A later delta <code>{'ice"}'}</code> completes the name. Your transport adapter decides where those text deltas come from.</p>
            <Tabs defaultSelectedKey="sse" class="guide-transport-tabs"><Tabs.List aria-label="Provider transport"><Tabs.Tab id="sse">SSE / event stream</Tabs.Tab><Tabs.Tab id="plain">Plain text body</Tabs.Tab></Tabs.List>
              <Tabs.Panel id="sse"><h3 class="guide-subheading">Complete events. Incomplete document text.</h3><p>SSE wraps the generated text in events. Each envelope below is valid JSON, while its <code>text</code> field contains only a fragment of the document. The parser receives that fragment immediately, before the next event or the final marker.</p><Example title="HTTP body · Content-Type: text/event-stream" language="plaintext" code={sseWireExample} />
                <p>This example defines a backend contract: <code>{'{"text":"a text delta"}'}</code>, followed by <code>[DONE]</code> when generation ends. Map your provider's event names and delta fields to this contract, or adapt the extraction step to its SDK. The marker is an application convention, not part of SSE itself.</p>
                <Example title="sse-profile.ts · complete adapter and UI binding" code={guideExamples.sse} />
                <p>The adapter handles UTF-8 split across byte chunks, LF/CRLF line endings, multiline <code>data:</code>, comments, and fragmented event frames. It yields text only after a full envelope event arrives; it never waits for the whole generated document. An error event, invalid envelope, or connection closing before <code>[DONE]</code> throws and preserves the last rendered value.</p>
                <p>The <code>/api/profile/events</code> endpoint belongs to your application. This one-shot adapter cancels the reader when done and does not reconnect. Native <code>EventSource</code> or your provider SDK can also decode frames; pass their selected text deltas to the parser in order. See the <Link href="https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation" target="_blank" rel="noopener noreferrer">SSE framing specification</Link>.</p>
              </Tabs.Panel>
              <Tabs.Panel id="plain"><h3 class="guide-subheading">A chunked body containing document text.</h3><p>When the response body itself is the generated text, decode it directly. <code>TextDecoderStream</code> preserves characters split across byte chunks. Every yielded string can be an unfinished part of the document.</p><Example title="fetch-profile.ts · plain-text response body" code={guideExamples.fetch} /><p>The <code>/api/profile</code> endpoint is supplied by your application. It streams raw document text such as pieces of <code>{'{"name":"Alex Morgan"}'}</code>, rather than SSE frames or JSON event envelopes.</p></Tabs.Panel>
            </Tabs>
            <p>Both adapters produce an <code>AsyncIterable&lt;string&gt;</code> for <code>streamStructured</code>. Select one ordered response or tool call. Strip transport envelopes and Markdown fences before parsing; do not mix interleaved documents.</p>
            <p>With the direct API, call <code>parser.write(chunk)</code> for each delta and <code>parser.end()</code> exactly once when generation is complete. Parsing errors throw. Catch them and inspect <code>parser.snapshot()</code> to retain available data and its error; create a fresh parser for another document.</p>
          </section>
          <section id="csv" aria-labelledby="csv-guide-title"><div class="eyebrow">05 · STREAM ROWS AND CELLS</div><h2 id="csv-guide-title">Render CSV as a table.</h2>
            <p>CSV and TSV produce arrays of string rows. The library keeps row zero in the data; deciding whether it is a header belongs to your application. A cell can be partial before the row finishes. The following small example defines all of its own table rendering.</p>
            <Example title="table.ts · complete DOM rendering" code={guideExamples.csv} />
            <p><code>/1/0</code> describes the first cell of the first data row when row zero is your header. Cells finish at a separator, row boundary, or EOF; quoted cells wait for an unambiguous closing boundary. Values stay strings, including empty strings. Convert types after parsing if your application needs numbers or dates.</p>
            <p class="guide-note">For clarity this small example replaces the table rows on each snapshot. For larger interactive tables, preserve row and cell identities as the Rivet UI demo does, and consider patches below.</p>
            <Link href="/#csv-demo">Try the Rivet UI streaming table <Link.Icon><Icon icon={ArrowRight} size={14} /></Link.Icon></Link>
          </section>
          <section id="css" aria-labelledby="css-guide-title"><div class="eyebrow">06 · AI-GENERATED STYLES</div><h2 id="css-guide-title">Style an element as CSS arrives.</h2><p>Use <code>format: Format.CSS</code> for a structured stylesheet tree. Selectors, declarations, and their values have partial/complete metadata. A rule can stay open while its first finished declarations already update your preview.</p><p>The separate styling demo targets one <code>.ai-card</code> element. It shows arriving declarations immediately, and applies only complete values for selected visual properties supported by the browser. This constrained preview excludes !important declarations. Completed styles morph with transitions; reduced-motion preferences disable animation. Rewinding removes later styles.</p><Example title="style-card.ts · a fixed-element preview" code={guideExamples.css} /><Link href="/#css-demo">Try the AI CSS styling demo <Link.Icon><Icon icon={ArrowRight} size={14} /></Link.Icon></Link><p>The stylesheet node path is <code>/nodes</code>. For the first declaration in the first rule, <code>/nodes/0/nodes/0/value</code> describes its value. A complete declaration is syntax metadata; validate its property/value and scope before applying it to an interface.</p></section>
          <section id="patches" aria-labelledby="patches-title"><div class="eyebrow">07 · LARGER RESPONSES</div><h2 id="patches-title">Replay only the changes.</h2>
            <p>Full snapshots copy the accumulated document. Patch mode emits changed paths and decoded string suffixes instead. Replay every batch in order into one accumulator, then bind its data to your interface.</p>
            <Example title="patches.ts · explicit accumulator and DOM binding" code={guideExamples.patches} />
            <p><code>applyPatchBatch</code> mutates the consumer-owned accumulator. Batches start at sequence 1 and must stay in order. This is TetraStream’s <code>set</code>, <code>append</code>, <code>remove</code>, and <code>status</code> protocol, rather than RFC 6902 JSON Patch. Start a new accumulator for a new stream; keep a copy yourself if you need historical state.</p>
          </section>
          <section id="validation" aria-labelledby="validation-title"><div class="eyebrow">08 · ACCEPT FINISHED DATA</div><h2 id="validation-title">Validate before taking action.</h2>
            <p><code>streamValidated</code> preserves progressive input and runs a Standard Schema V1 validator after successful EOF. The example below includes the validator itself. You can supply a compatible schema from a validation library instead.</p>
            <Example title="validation.ts · no additional dependency" code={guideExamples.validation} />
            <p>Only <code>validation.status === 'valid'</code> exposes fully typed <code>validation.value</code>. Raw <code>snapshot.data</code> stays partial input. Schema failures use <code>invalid</code> with <code>issues</code>; a validator that throws produces <code>validator-error</code>. Source and parser failures still throw from the async stream.</p>
            <p>For an existing parser snapshot or patch accumulator, use <code>await validateSnapshot(snapshot, schema)</code>. Sync and async validators are supported. A generic TypeScript parameter alone never runs validation.</p>
          </section>
          <section id="rivet" aria-labelledby="rivet-title"><div class="eyebrow">09 · YOUR UI FRAMEWORK</div><h2 id="rivet-title">Use RivetJS + Rivet UI.</h2>
            <p>The parser is independent of Rivet. In a Rivet app, put arriving values in signals and render those signals with the stock UI components. This example defines its <code>UserCard</code>, simulated source, click handler, and mount point.</p>
            <Example title="src/main.tsx · Rivet component" language="tsx" code={guideExamples.rivet} />
            <p class="guide-note">Use this in an app configured with <code>@rivetjs/compiler/vite</code>, <code>@rivetjs/runtime</code>, <code>@rivetjs/reactivity</code>, and <code>@rivetjs/ui</code>. Import Tailwind and <code>@rivetjs/ui/styles</code> as in this workspace. Rivet JSX uses its own compiler. The runtime is a separate dependency from TetraStream.</p>
          </section>
          <section id="strategies" aria-labelledby="strategies-title"><div class="eyebrow">10 · EXTEND THE PARSER</div><h2 id="strategies-title">Add your own language.</h2><p>Choose a built-in with <code>Format.JSON</code>, <code>Format.CSS</code>, or another <code>Format</code> enum member. For another language, pass a class instance or object implementing <code>LanguageStrategy&lt;T&gt;</code> as <code>format</code>. No global registration is required.</p><Example title="custom-language.ts · complete strategy" code={guideExamples.strategy} /><p><code>create(options)</code> receives <code>maxLength</code> and <code>maxDepth</code> and must return a fresh parser. Each synchronous <code>write(chunk)</code> and <code>end()</code> returns data and a completion map. Use RFC 6901 pointers, and throw for invalid input; <code>end()</code> validates the original document. The normalizer enforces input length; your strategy enforces nesting depth and language rules.</p><p>Return JSON-compatible plain data with dense arrays and omitted unavailable fields. Cycles, shared object references, nested undefined values, getters, and class objects are rejected; output tree depth is checked. TetraStream owns a copy of each result, computes patch changes, and preserves partial values if your parser throws. Custom strategies also work with <code>streamPatches</code>, <code>select</code>, and schema validation.</p></section>
          <section id="reference" aria-labelledby="reference-title"><div class="eyebrow">11 · KEEP HANDY</div><h2 id="reference-title">Formats & API reference.</h2>
            <p>Choose the format explicitly. The normalizer gives every adapter the same lifecycle and completion metadata; the data shape follows the input format.</p>
            <Table aria-label="Supported streaming formats" columns={formatColumns} items={formatRows} sortDescriptor={sort} />
            <DescriptionList><DescriptionList.Item><DescriptionList.Term><code>StreamNormalizer&lt;T&gt;</code></DescriptionList.Term><DescriptionList.Details><code>write(text)</code>, <code>end()</code>, and <code>snapshot()</code> return independent snapshots. Use <code>writePatch</code> / <code>endPatch</code> for direct patch output.</DescriptionList.Details></DescriptionList.Item><DescriptionList.Item><DescriptionList.Term><code>streamStructured&lt;T&gt;</code></DescriptionList.Term><DescriptionList.Details>Consumes text chunks, yields snapshots, and finalizes at EOF.</DescriptionList.Details></DescriptionList.Item><DescriptionList.Item><DescriptionList.Term><code>select(snapshot, path)</code></DescriptionList.Term><DescriptionList.Details>Typed field access with partial, complete, or document visibility policies.</DescriptionList.Details></DescriptionList.Item><DescriptionList.Item><DescriptionList.Term><code>streamPatches</code></DescriptionList.Term><DescriptionList.Details>Consumes text chunks and yields ordered change batches for an accumulator.</DescriptionList.Details></DescriptionList.Item><DescriptionList.Item><DescriptionList.Term><code>streamValidated</code></DescriptionList.Term><DescriptionList.Details>Yields partial input and a separate final schema-validation result.</DescriptionList.Details></DescriptionList.Item><DescriptionList.Item><DescriptionList.Term>Options</DescriptionList.Term><DescriptionList.Details><code>format</code> defaults to JSON. <code>maxLength</code> defaults to 1,000,000 UTF-16 code units; <code>maxDepth</code> defaults to 128.</DescriptionList.Details></DescriptionList.Item></DescriptionList>
            <Accordion variant="surface"><Accordion.Item id="yaml-notes"><Accordion.Heading><Accordion.Trigger>What differs between formats?<Accordion.Indicator /></Accordion.Trigger></Accordion.Heading><Accordion.Panel>{() => <Accordion.Body>YAML reparses the received prefix and accepts one JSON-compatible document. Plain scalars can grow or change type; a newline alone may not complete them. XML requires well-formed input and does not support DTDs. HTML follows forgiving fragment parsing and is exposed as a tree; parsing HTML is not sanitization. JSON rejects duplicate keys and malformed syntax. NDJSON/JSONL keep the open record inside an array until EOF.</Accordion.Body>}</Accordion.Panel></Accordion.Item><Accordion.Item id="limits"><Accordion.Heading><Accordion.Trigger>What belongs to my application?<Accordion.Indicator /></Accordion.Trigger></Accordion.Heading><Accordion.Panel>{() => <Accordion.Body>Your application owns transport decoding, retries, cancellation, UI bindings, URL policies, schema choice, and side effects. TetraStream parses one ordered document. It does not repair invalid model output, remove Markdown fences, reconnect streams, or reconcile model retractions. Keep the last displayed data when a source or parse error occurs.</Accordion.Body>}</Accordion.Panel></Accordion.Item></Accordion>
          </section>
          <Card class="guide-finish"><Card.Header><Card.Title>See the states for yourself.</Card.Title><Card.Description>Scrub the live demos one character at a time, then bring the same bindings to your application.</Card.Description></Card.Header><Card.Footer><Link href="/#demo">Open the user card <Link.Icon><Icon icon={ArrowRight} size={15} /></Link.Icon></Link><Link href="/#csv-demo">Open the CSV table</Link></Card.Footer></Card>
        </div>
      </div>
      <footer class="page-footer"><a class="brand" href="/"><span class="brand-symbol"><BrandMark size={26} /></span>TetraStream</a><span>Structured data, as it arrives.</span><Link href="/#demo">Back to the demo</Link></footer>
    </main>
  </>;
}

const app = document.getElementById('app');
if (!app) throw new Error('Missing app mount point');
render(() => <Guide />, app);
