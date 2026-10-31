# Homepage component inventory

The playground imports the installed `@rivetjs/ui` components directly. Keep their stock anatomy, semantic colors, interactions, and theme. Check the installed types and source before adding a custom substitute.

| Homepage UI                                        | Rivet UI component                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| Navigation                                         | `Navbar` with `Header`, `Brand`, `Content`, `Item`, and `Spacer`                  |
| Calls to action and playback                       | `Button`, `Toolbar`                                                               |
| Demo containers and user card                      | `Card`; preview background uses `Surface`                                         |
| Format, speed, chunk selectors                     | `NativeSelect`, `Label`                                                           |
| Partial and complete badges, skills                | `Chip` using stock semantic colors                                                |
| Avatar and pending fields                          | `Avatar`, `Skeleton`                                                              |
| Dividers and state dots                            | `Separator`, `Status`                                                             |
| Incoming source, parsed data, integration examples | `CodeBlock`                                                                       |
| Copy integration code                              | `CodeBlock.CopyButton`                                                            |
| Empty source and table                             | `EmptyState` compound parts                                                       |
| Profile inspector and CSV grid                     | `Table` compound parts                                                            |
| Expandable inspector and CSV editor                | `Accordion` compound parts                                                        |
| Inspector and integration views                    | `Tabs`                                                                            |
| Profile source dialog                              | `Modal`                                                                           |
| Source editors and associated help                 | `TextField`, `Label`, `TextArea`, `Description`                                   |
| Nested contact and project values                  | `DescriptionList`, nested `Card`, `Chip`, `Skeleton`                              |
| CSS declaration inspector                          | `Card`, `DescriptionList`, `Chip`                                                 |
| Stream errors                                      | `Alert` compound parts                                                            |
| Secondary demo links                               | `Link`, `Link.Icon`                                                               |
| Playback position and scrubbing                    | `Slider`, `Label`, `Slider.Output`, `Slider.Track`, `Slider.Fill`, `Slider.Thumb` |

`StreamingSource` only composes `CodeBlock`, `EmptyState`, and `Status`, and follows the arriving text with the scroll position. It does not recreate their appearance or interactions.

Custom CSS handles page layout, responsive placement, content typography, fixed demo heights, skeleton dimensions, and the illustrative writing cursor. Do not redefine global Rivet selectors such as `.skeleton`, draw custom component states, or duplicate copy, accordion, table, or field behavior.

Component CSS is imported by Rivet UI's component modules. The app's global stylesheet imports only `@rivetjs/ui/styles/out/base.css` plus Tailwind with an explicit app source; it does not import the `@rivetjs/ui/styles` entry. Table, modal, navbar, and code-block imports use the public named parts so unused compound parts can be removed by the bundler. Keep stock component styles intact.

The avatar is a 256-pixel WebP (5.5 KB); the original generation is not included in the site payload.
