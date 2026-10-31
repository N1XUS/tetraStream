import { signal, onCleanup } from '@rivetjs/reactivity';
import { For, Show, clientEffect } from '@rivetjs/runtime/dom';
import { Button } from '@rivetjs/ui/button';
import { Card } from '@rivetjs/ui/card';
import { Chip } from '@rivetjs/ui/chip';
import { Avatar } from '@rivetjs/ui/avatar';
import { Tabs } from '@rivetjs/ui/tabs';
import { Modal } from '@rivetjs/ui/modal';
import { Accordion } from '@rivetjs/ui/accordion';
import { NativeSelect } from '@rivetjs/ui/native-select';
import { PlaybackSlider } from './PlaybackSlider';
import { seekStream } from './seek-stream';
import { TextArea } from '@rivetjs/ui/textarea';
import { Skeleton } from '@rivetjs/ui/skeleton';
import { Separator } from '@rivetjs/ui/separator';
import { Surface } from '@rivetjs/ui/surface';
import { Alert } from '@rivetjs/ui/alert';
import { Status } from '@rivetjs/ui/status';
import { Link } from '@rivetjs/ui/link';
import { Label } from '@rivetjs/ui/label';
import { Description } from '@rivetjs/ui/description';
import { TextField } from '@rivetjs/ui/textfield';
import { Table } from '@rivetjs/ui/table';
import { CodeBlock } from '@rivetjs/ui/code-block';
import { Navbar } from '@rivetjs/ui/navbar';
import { Toolbar } from '@rivetjs/ui/toolbar';
import { StreamingSource } from './StreamingSource';
import { BrandMark } from './BrandMark';
import { Icon } from '@rivetjs/kit/icon';
import { Play, Pause, RotateCcw, ArrowRight, ArrowDown, Check, Radio, Code2, MapPin, ExternalLink, SlidersHorizontal, StepForward, Square, CircleCheck, Package } from 'lucide';
import { StreamNormalizer, type Snapshot, type Completion } from 'tetra-stream';
import { readProfile, readSkillItems, readAvatarSource, isAvatarPending, fields } from './profile.ts';
import { examples, type ProfileFormat } from './fixtures.ts';
import { CsvGridDemo } from './CsvGridDemo';
import { CssStylingDemo } from './CssStylingDemo';
import { transportLabel } from './presentation.ts';
import { integrationExamples } from './integration-examples';
import './style.css';

interface FieldValue { value: unknown; status: Completion | 'pending'; itemStatus?: Completion[] }
const fieldLabels: Record<string, string> = { name: 'Name', avatar: 'Avatar', role: 'Role', location: 'Location', bio: 'About', skills: 'Skills', website: 'Website' };
const inspectorRows = fields.map(id => ({ id, label: fieldLabels[id] }));
const inspectorColumns = [{ id: 'field', label: 'Field' }, { id: 'value', label: 'Current value' }, { id: 'status', label: 'Status' }];
const formats: ProfileFormat[] = ['json', 'yaml', 'xml', 'html', 'ndjson', 'csv', 'tsv'];
const formatLabels: Partial<Record<ProfileFormat, string>> = { ndjson: 'JSON Lines', yaml: 'YAML / YML' };
const text = (value: unknown): string => typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value);

export default function App() {
  const format = signal<ProfileFormat>('json');
  const source = signal<Record<ProfileFormat, string>>({ ...examples });
  let parser = new StreamNormalizer({ format: 'json' });
  const snapshot = signal<Snapshot>(parser.snapshot());
  const position = signal(0);
  const active = signal(false);
  const speed = signal('1');
  const chunkSize = signal('4');
  const editorOpen = signal(false);
  const draft = signal('');
  const avatarLoading = signal('idle');
  const inspectorSort = signal<import('@rivetjs/cdk/collections/types').SortDescriptor | null>(null);
  const avatarSource = () => readAvatarSource(snapshot());
  const avatarPending = () => isAvatarPending(snapshot());
  const avatarBusy = () => avatarPending() || !!avatarSource() && !['loaded', 'error'].includes(avatarLoading());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const profile = () => readProfile(snapshot()) as Record<string, FieldValue>;
  const done = () => snapshot().state === 'complete';
  const fieldText = (name: string) => profile()[name].status === 'pending' && done() ? 'Not included' : text(profile()[name].value);
  const failed = () => snapshot().state === 'error';
  const completeCount = () => fields.filter(field => profile()[field].status === 'complete').length;
  const rawText = () => source()[format()].slice(0, position());
  const skills = () => readSkillItems(snapshot());
  const initials = () => text(profile().name.value).trim().split(/\s+/).slice(0, 2).map(part => part[0] ?? '').join('');

  function pause() { active.set(false); clearTimeout(timer); }
  function reset(next: ProfileFormat = format()) {
    pause();
    format.set(next);
    parser = new StreamNormalizer({ format: next });
    snapshot.set(parser.snapshot());
    position.set(0);
  }
  function seek(next: number) {
    pause();
    const replay = seekStream(source()[format()], format(), next);
    parser = replay.parser;
    position.set(replay.position);
    snapshot.set(replay.snapshot);
  }
  function deliver() {
    if (snapshot().state !== 'streaming') return;
    const input = source()[format()];
    const next = Math.min(position() + Number(chunkSize()), input.length);
    const chunk = input.slice(position(), next);
    position.set(next);
    try {
      snapshot.set(parser.write(chunk));
      if (next === input.length) { snapshot.set(parser.end()); pause(); }
    } catch { snapshot.set(parser.snapshot()); pause(); }
  }
  function tick() {
    if (!active()) return;
    deliver();
    if (active()) timer = setTimeout(tick, 75 / Number(speed()));
  }
  function togglePlay() {
    if (active()) { pause(); return; }
    if (done() || failed()) reset();
    active.set(true);
    tick();
  }
  function tryDemo() {
    document.getElementById('demo')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    if (!active()) togglePlay();
    document.getElementById('play')?.focus({ preventScroll: true });
  }
  function endEarly() {
    pause();
    try { snapshot.set(parser.end()); } catch { snapshot.set(parser.snapshot()); }
  }
  function applySource() {
    source.set({ ...source(), [format()]: draft() });
    editorOpen.set(false);
    reset();
  }

  clientEffect(() => {
    const visibility = () => { if (document.hidden) pause(); };
    document.addEventListener('visibilitychange', visibility);
    return () => document.removeEventListener('visibilitychange', visibility);
  });
  onCleanup(() => clearTimeout(timer));

  function FieldBadge(props: { name: string }) {
    const status = () => profile()[props.name].status;
    return <Show when={status() !== 'pending'}><Chip size="sm" variant="soft" color={status() === 'partial' ? 'warning' : 'success'} data-badge={props.name} aria-label={`${fieldLabels[props.name]}: ${status()}`}>
      <Show when={status() === 'complete'}><Icon icon={Check} size={12} /></Show>
      {status() === 'partial' ? 'Partial' : 'Complete'}
    </Chip></Show>;
  }

  function SourceEditor() { return <Modal isOpen={editorOpen} onOpenChange={open => { if (open) { pause(); draft.set(source()[format()]); } editorOpen.set(open); }}><Button variant="ghost" size="sm" id="edit-source"><Icon icon={Code2} size={15} /> Edit profile source</Button>{() => <Modal.Content size="lg" class="source-modal"><Modal.Header><Modal.Heading>Edit the profile response</Modal.Heading><p>Paste {format().toUpperCase()} data, then watch it stream into the card.</p></Modal.Header><Modal.Body><TextField fullWidth><Label for="source-input">Your {format().toUpperCase()} response</Label><TextArea id="source-input" value={draft()} onInput={event => draft.set(event.currentTarget.value)} spellCheck={false} /><Description>Use <code>name, avatar, role, location, bio, skills, website</code>. For HTML, identify fields with <code>data-field</code>. For XML, use matching element names. CSV/TSV use a header row and semicolon-separated skills. JSON Lines records update the profile field by field.</Description></TextField></Modal.Body><Modal.Footer><Button variant="ghost" onPress={() => draft.set(examples[format()])}>Restore example</Button><Button onPress={applySource} id="apply-source">Use this data <Icon icon={ArrowRight} size={15} /></Button></Modal.Footer></Modal.Content>}</Modal>; }

  return <>
    <a class="skip-link" href="#demo">Skip to the demo</a>
    <Navbar position="static" maxWidth="full" aria-label="Main navigation"><Navbar.Header class="site-header">
      <Navbar.Brand><a class="brand" href="#" aria-label="TetraStream home"><span class="brand-symbol"><BrandMark /></span>TetraStream<span class="brand-caption">Structured data, as it arrives.</span></a></Navbar.Brand>
      <Navbar.Spacer /><Navbar.Content><Navbar.Item href="#how-it-works" class="desktop-nav-item">How it works</Navbar.Item><Navbar.Item href="#developers" class="desktop-nav-item">For developers</Navbar.Item><Navbar.Item href="/guide/">Guide</Navbar.Item><Navbar.Item href="#demo" class="desktop-nav-item">Try the demo <Icon icon={ArrowRight} size={14} /></Navbar.Item></Navbar.Content>
    </Navbar.Header></Navbar>

    <main>
      <section class="hero" aria-labelledby="page-title">
        <Chip variant="soft" color="accent" class="hero-chip"><Icon icon={Radio} size={13} /> Progressive parsing · TypeScript</Chip>
        <h1 id="page-title">Render structured data<br /><em>before it’s finished.</em></h1>
        <p>Turn streaming responses into live user cards and data grids.<br class="desktop-break" /> Read JSON, YAML, XML, HTML, CSV, CSS, and more as the text arrives.</p>
        <div class="hero-actions"><Button size="lg" class="hero-cta" onPress={tryDemo}><Icon icon={Play} size={16} /> Try the user card</Button><Link href="#csv-demo">Try the CSV table <Link.Icon><Icon icon={ArrowRight} size={16} /></Link.Icon></Link></div>
        <div class="hero-reassurance"><span><Icon icon={Check} size={13} /> No API key</span><span><Icon icon={Check} size={13} /> Runs in your browser</span><span><Icon icon={Check} size={13} /> Any AI provider</span></div>
      </section>

      <section id="demo" tabIndex={-1} class="demo-section" aria-labelledby="demo-title">
        <div class="section-heading"><div><div class="eyebrow">A LITTLE DEMO. A BIG DIFFERENCE.</div><h2 id="demo-title">Watch a profile come to life.</h2><p>Press play. The card fills in as each piece of data arrives.</p></div><span class="demo-label"><Status size="sm" color="accent" /> Interactive demo</span></div>
        <Card class="playground">
          <Toolbar class="demo-toolbar" aria-label="Profile playback"><div class="play-controls"><Button id="play" class="play-button" onPress={togglePlay} ><Icon icon={active() ? Pause : done() || failed() ? RotateCcw : Play} size={16} /><span id="play-label">{active() ? 'Pause demo' : done() || failed() ? 'Play again' : position() ? 'Continue demo' : 'Start demo'}</span></Button><Button id="reset" variant="ghost" isIconOnly aria-label="Reset demo" onPress={() => reset()}><Icon icon={RotateCcw} size={17} /></Button><span class="toolbar-help">{done() ? completeCount() === fields.length ? 'All profile fields are ready.' : `${completeCount()} of ${fields.length} fields received.` : active() ? 'Keep an eye on the card →' : 'One click to see the difference.'}</span></div><div class="format-control"><Label for="format">Try a format</Label><NativeSelect variant="secondary" value={format()} onChange={value => reset(value as ProfileFormat)}><NativeSelect.Trigger id="format" aria-label="Input format"><For each={formats} by={item => item}>{item => <NativeSelect.Option value={item()}>{formatLabels[item()] ?? item().toUpperCase()}</NativeSelect.Option>}</For></NativeSelect.Trigger></NativeSelect></div></Toolbar>

          <div class="workspace-grid">
            <section class="source-panel" aria-label="Incoming text"><div class="panel-heading"><div><Chip size="sm" variant="soft">1</Chip><h3>What the AI sends</h3></div><span class="file-label">profile.{format()}</span></div><StreamingSource id="source-code" code={rawText} label="Received source text" heading="Incoming text" count={position()} total={source()[format()].length} countId="source-chars" status={transportLabel({ state: snapshot().state, playing: active(), position: position(), length: source()[format()].length })} emptyTitle="A few words at a time." emptyDescription="The AI's response will appear here as the demo runs." /><p class="panel-note"><Icon icon={CircleCheck} size={14} /> Simulated AI response. Real streaming parser.</p></section>

            <section class="preview-panel" aria-label="Live user card"><div class="panel-heading"><div><Chip size="sm" variant="soft">2</Chip><h3>What people see</h3></div><span class={`live-state ${active() ? 'is-live' : ''}`} id="live-state"><Status size="sm" color="accent" />{failed() ? 'Interrupted' : done() ? position() < source()[format()].length ? 'Ended early' : 'Complete' : active() ? 'Live' : position() ? 'Paused' : 'Your live preview'}</span></div><Surface variant="secondary" class="card-stage"><Card class="profile-card"><Card.Header class="avatar-row"><div class="avatar-field"><Avatar size="lg" id="profile-avatar" aria-busy={avatarBusy()} aria-label={!avatarSource() && !avatarPending() ? 'No avatar provided' : avatarLoading() === 'error' ? 'Avatar could not load' : avatarLoading() === 'loaded' ? 'Profile avatar' : avatarSource() ? 'Loading avatar image' : 'Waiting for the complete avatar URL'}><Avatar.Image src={avatarSource} alt={`Portrait of ${text(profile().name.value) || 'the profile user'}`} onLoadingStatusChange={status => avatarLoading.set(avatarSource() ? status : 'idle')} /><Avatar.Fallback><Show when={avatarPending() || !!avatarSource() && avatarLoading() !== 'error'} fallback={<span>{initials() || '?'}</span>}><Skeleton class="avatar-skeleton" id="avatar-skeleton" aria-label="Avatar loading" /></Show></Avatar.Fallback></Avatar><span class="avatar-field-state" id="avatar-field-state">{!avatarSource() ? avatarPending() ? profile().avatar.status === 'partial' ? 'Receiving avatar URL…' : 'Avatar pending' : 'No avatar provided' : avatarLoading() === 'error' ? 'Image unavailable' : avatarLoading() === 'loaded' ? 'Avatar ready' : 'Loading image…'}</span></div><Chip size="sm" variant="soft" color={done() ? 'success' : 'default'} id="card-document-state">{done() ? completeCount() === fields.length ? 'Profile complete' : `${completeCount()} of ${fields.length} fields received` : position() ? `${completeCount()} of ${fields.length} fields ready` : 'Waiting for data'}</Chip></Card.Header><Card.Content class="profile-content"><div class="name-row"><h3 id="profile-name" class={profile().name.status === 'pending' && done() ? 'missing-value' : ''}><Show when={profile().name.status !== 'pending' || done()} fallback={<Skeleton render={props => <span {...props} />} class="name-placeholder" aria-label="Waiting for name" />}><span>{fieldText('name')}</span></Show></h3><FieldBadge name="name" /></div><div class="role-row"><p id="profile-role" class={profile().role.status === 'pending' && done() ? 'missing-value' : ''}><Show when={profile().role.status !== 'pending' || done()} fallback={<Skeleton render={props => <span {...props} />} class="role-placeholder" aria-label="Waiting for role" />}><span>{fieldText('role')}</span></Show></p><FieldBadge name="role" /></div><div class="location-row"><Icon icon={MapPin} size={14} /><span id="profile-location" class={profile().location.status === 'pending' && done() ? 'missing-value' : ''}><Show when={profile().location.status !== 'pending' || done()} fallback={<Skeleton render={props => <span {...props} />} class="location-placeholder" aria-label="Waiting for location" />}><span>{fieldText('location')}</span></Show></span><FieldBadge name="location" /></div><Separator class="profile-divider" /><div class="field-label"><h4>About</h4><FieldBadge name="bio" /></div><div id="profile-bio"><Show when={profile().bio.status !== 'pending' || done()} fallback={<div class="bio-placeholder"><Skeleton /><Skeleton /><Skeleton /></div>}><p class={profile().bio.status === 'partial' ? 'bio-copy is-writing' : 'bio-copy'}>{fieldText('bio')}</p></Show></div><div class="field-label skills-label"><h4>Good at</h4><FieldBadge name="skills" /></div><div class="skills-list" id="profile-skills"><Show when={profile().skills.status === 'pending' && !done()}><Skeleton class="skill-placeholder" /><Skeleton class="skill-placeholder" /></Show><Show when={profile().skills.status === 'pending' && done()}><span class="missing-value">Not included</span></Show><For each={skills} by={skill => skill.sourceIndex}>{skill => <Chip size="sm" variant="soft" color={skill().status === 'partial' ? 'warning' : 'accent'} class="skill-chip">{skill().value}</Chip>}</For></div><Separator class="profile-divider" /><div class="profile-bottom"><span><Icon icon={ExternalLink} size={13} /><span id="profile-website" class={profile().website.status === 'pending' && done() ? 'missing-value' : ''}><Show when={profile().website.status !== 'pending' || done()} fallback={<Skeleton render={props => <span {...props} />} class="website-placeholder" aria-label="Waiting for website" />}><span>{fieldText('website')}</span></Show></span></span><FieldBadge name="website" /></div></Card.Content></Card></Surface><p class="avatar-note">Text streams as it arrives. The avatar waits for its complete URL.</p><div class="preview-caption"><span><Status size="sm" color="warning" /> Partial: still arriving</span><span><Status size="sm" color="success" /> Complete: value has ended</span></div></section>
          </div>
          <div class="demo-summary"><span id="transport-state" role="status" aria-live="polite">{failed() ? 'The stream stopped. Your data is still here.' : done() ? completeCount() === fields.length ? 'Done! The card was useful before the response finished.' : `Response finished. ${completeCount()} of ${fields.length} profile fields were included.` : active() ? `${completeCount()} of ${fields.length} fields ready — and the AI is still writing.` : position() ? 'Take your time. Continue whenever you’re ready.' : 'The card starts updating before the full response is ready.'}</span><div class="speed-control"><Label for="speed">Playback speed</Label><NativeSelect variant="secondary" value={speed()} onChange={value => speed.set(value)}><NativeSelect.Trigger id="speed" aria-label="Playback speed"><NativeSelect.Option value="0.5">0.5×</NativeSelect.Option><NativeSelect.Option value="1">1×</NativeSelect.Option><NativeSelect.Option value="2">2×</NativeSelect.Option><NativeSelect.Option value="4">4×</NativeSelect.Option></NativeSelect.Trigger></NativeSelect></div></div><PlaybackSlider id="profile-playback" label="Profile playback position" position={position()} total={source()[format()].length} onSeek={seek} />
        </Card>
        <Show when={failed()}><Alert status="danger" class="stream-error" role="alert" id="error-message"><Alert.Indicator /><Alert.Content><Alert.Title>The response couldn't finish.</Alert.Title><Alert.Description>{snapshot().error} The available data stays visible. Try again or edit the example.</Alert.Description></Alert.Content></Alert></Show>
        <div class="demo-options"><SourceEditor /><Link href="#csv-demo" class="csv-demo-link">Try the streaming CSV table <Link.Icon><Icon icon={ArrowDown} size={14} /></Link.Icon></Link></div>
      <Accordion class="profile-inspector" variant="surface"><Accordion.Item id="profile-inspector"><Accordion.Heading><Accordion.Trigger><span class="accordion-label"><Icon icon={SlidersHorizontal} size={17} /> Inspect profile data <span class="details-hint">Field states and parsed output</span></span><Accordion.Indicator /></Accordion.Trigger></Accordion.Heading><Accordion.Panel>{() => <Accordion.Body><div class="advanced-controls"><Button id="step" variant="secondary" size="sm" isDisabled={done() || failed()} onPress={() => { pause(); deliver(); }}><Icon icon={StepForward} size={15} /> Next chunk</Button><Button id="end-stream" variant="ghost" size="sm" isDisabled={!position() || done() || failed()} onPress={endEarly}><Icon icon={Square} size={13} /> End stream here</Button><div class="chunk-control"><Label for="chunk-size">Characters per chunk</Label><NativeSelect variant="secondary" value={chunkSize()} onChange={value => chunkSize.set(value)}><NativeSelect.Trigger id="chunk-size" aria-label="Characters per chunk"><NativeSelect.Option value="1">1</NativeSelect.Option><NativeSelect.Option value="4">4</NativeSelect.Option><NativeSelect.Option value="12">12</NativeSelect.Option></NativeSelect.Trigger></NativeSelect></div></div><Tabs defaultSelectedKey="fields" class="inspector-tabs"><Tabs.List aria-label="Data inspector"><Tabs.Tab id="fields">Field status <span id="field-count">{completeCount()}/{fields.length}</span></Tabs.Tab><Tabs.Tab id="data">Parsed data</Tabs.Tab></Tabs.List><Tabs.Panel id="fields"><Table class="inspector-table"><Table.ScrollContainer><Table.Content aria-label="Profile field status" sortDescriptor={inspectorSort}><Table.Header columns={inspectorColumns}>{(column: typeof inspectorColumns[number]) => <Table.Column id={column.id} isRowHeader={column.id === 'field'} textValue={column.label}>{column.label}</Table.Column>}</Table.Header><Table.Body items={inspectorRows}>{(row: typeof inspectorRows[number]) => <Table.Row id={row.id} textValue={row.label} columns={inspectorColumns}>{(column: typeof inspectorColumns[number]) => <Table.Cell id={`${row.id}-${column.id}`} textValue={column.id === 'field' ? row.label : column.id === 'value' ? text(profile()[row.id].value) || 'Waiting for data' : profile()[row.id].status}><Show when={column.id === 'field'} fallback={<Show when={column.id === 'value'} fallback={<Chip size="sm" variant="soft" color={profile()[row.id].status === 'partial' ? 'warning' : profile()[row.id].status === 'complete' ? 'success' : 'default'}>{profile()[row.id].status === 'pending' ? done() ? 'Not included' : 'Waiting' : profile()[row.id].status === 'partial' ? 'Partial' : 'Complete'}</Chip>}><span>{profile()[row.id].status === 'pending' ? done() ? 'Not included in response' : 'Waiting for data' : text(profile()[row.id].value)}</span></Show>}>{row.label}</Show></Table.Cell>}</Table.Row>}</Table.Body></Table.Content></Table.ScrollContainer></Table></Tabs.Panel><Tabs.Panel id="data"><CodeBlock><CodeBlock.Code id="normalized-data" code={() => JSON.stringify(snapshot(), null, 2)} language="json" wrap aria-label="Parsed profile snapshot" /></CodeBlock></Tabs.Panel></Tabs><p class="advanced-note">Field completion describes syntax. Validate against your application schema before taking actions. Markup attributes appear after the opening tag is complete.</p></Accordion.Body>}</Accordion.Panel></Accordion.Item></Accordion>
      </section>

      <CsvGridDemo />
      <CssStylingDemo />

      <section id="how-it-works" class="explanation" aria-labelledby="how-title"><div class="explanation-intro"><div class="eyebrow">LESS WAITING. MORE SHOWING.</div><h2 id="how-title">An unfinished response.<br />A useful experience.</h2><p>Most interfaces wait for a complete response.<br />TetraStream lets you show what you already have.</p></div><div class="explanation-steps"><div><span class="explanation-number">01</span><div><h3>Data arrives in small pieces.</h3><p>Use the text stream from your AI provider. Choose a document, record, or table format; keep your existing text stream.</p></div></div><div><span class="explanation-number">02</span><div><h3>Your interface updates right away.</h3><p>Names appear. Descriptions grow. The rest of the card follows as data arrives.</p></div></div><div><span class="explanation-number">03</span><div><h3>You always know what's ready.</h3><p>Every value has a partial or complete state. Validate the whole document when the stream ends.</p></div></div></div></section>

      <section id="developers" class="developer-section" aria-labelledby="developer-title"><div class="developer-copy"><Chip variant="soft" color="accent" class="typescript-chip"><Icon icon={Package} size={13} /> TypeScript. Every step included.</Chip><h2 id="developer-title">From a text chunk<br /><em>to a visible name.</em></h2><p>This example defines the stream and updates a real HTML element. The name appears while it is still arriving. No hidden rendering function.</p><div class="package-facts"><span><Icon icon={Check} size={14} /> Copyable TypeScript</span><span><Icon icon={Check} size={14} /> Explicit UI bindings</span><span><Icon icon={Check} size={14} /> Partial and complete states</span></div><p>Follow the guide to build the full user card, connect your provider, stream CSV or CSS, and validate finished data.</p><Link href="/guide/" class="guide-cta">Read the step-by-step guide <Link.Icon><Icon icon={ArrowRight} size={17} /></Link.Icon></Link><p class="package-note">Install from npm · full TypeScript declarations.</p></div><CodeBlock class="integration-window"><CodeBlock.Header><CodeBlock.Language language="ts">main.ts · browser TypeScript</CodeBlock.Language><CodeBlock.CopyButton code={() => integrationExamples.stream} aria-label="Copy integration example" copiedLabel="Code copied" /></CodeBlock.Header><CodeBlock.Code id="integration-code" code={() => integrationExamples.stream} language="ts" wrap aria-label="Complete name streaming example" /><Description class="integration-note">Add <code>&lt;h2 id="user-name"&gt;Waiting…&lt;/h2&gt;</code> to your HTML. The guide includes complete HTML and TypeScript for a user card.</Description></CodeBlock></section>



      <footer class="page-footer"><a class="brand" href="#"><span class="brand-symbol"><BrandMark size={26} /></span>TetraStream</a><span>Less waiting between an idea and an interface.</span><Link href="/guide/">Usage guide</Link><span class="built-with">Built with <Link href="https://github.com/N1XUS/rivetjs" target="_blank" rel="noopener noreferrer">RivetJS</Link> + <Link href="https://github.com/N1XUS/rivetjs/tree/main/libs/ui" target="_blank" rel="noopener noreferrer">Rivet UI</Link></span></footer>
    </main>


  </>;
}
