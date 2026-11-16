// A note body with every element the schema of SPEC 6.2 allows.
export function fullDoc(imageSrc: string) {
  const t = (text: string, marks?: unknown[]) => (marks ? { type: 'text', text, marks } : { type: 'text', text });
  const para = (...content: unknown[]) => ({ type: 'paragraph', content });
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [t('Heading one alpha')] },
      { type: 'heading', attrs: { level: 2 }, content: [t('Heading two bravo')] },
      { type: 'heading', attrs: { level: 3 }, content: [t('Heading three charlie')] },
      para(
        t('Plain delta '),
        t('bold echo', [{ type: 'bold' }]),
        t(' '),
        t('italic foxtrot', [{ type: 'italic' }]),
        t(' '),
        t('strike golf', [{ type: 'strike' }]),
        t(' '),
        t('code hotel', [{ type: 'code' }]),
        t(' '),
        t('link india', [{ type: 'link', attrs: { href: 'https://example.com/x' } }]),
        t(' '),
        t('mail juliet', [{ type: 'link', attrs: { href: 'mailto:someone@example.com' } }]),
        t(' '),
        t('coloured vermilion', [{ type: 'textColor', attrs: { color: 'sapphire' } }]),
        t(' '),
        t('highlighted saffron', [{ type: 'bold' }, { type: 'highlight', attrs: { color: 'topaz' } }]),
        t(' '),
        t('underlined quokka', [{ type: 'underline' }]),
        t(' '),
        t('lettered gecko', [{ type: 'fontFamily', attrs: { font: 'lora' } }]),
        t(' '),
        t('sized narwhal', [{ type: 'italic' }, { type: 'fontSize', attrs: { size: 24 } }]),
        { type: 'hardBreak' },
        t('after break kilo'),
      ),
      { type: 'codeBlock', attrs: { language: 'js' }, content: [t('const lima = 1;\nconsole.log(lima);')] },
      { type: 'blockquote', content: [para(t('quoted mike'))] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [para(t('bullet november'))] }, { type: 'listItem', content: [para(t('bullet two'))] }] },
      { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [para(t('numbered oscar'))] }] },
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [para(t('done papa'))] },
          { type: 'taskItem', attrs: { checked: false }, content: [para(t('todo quebec'))] },
        ],
      },
      { type: 'horizontalRule' },
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [{ type: 'tableHeader', content: [para(t('head romeo'))] }, { type: 'tableHeader', content: [para(t('head two'))] }] },
          { type: 'tableRow', content: [{ type: 'tableCell', content: [para(t('cell sierra'))] }, { type: 'tableCell', content: [para()] }] },
        ],
      },
      { type: 'image', attrs: { src: imageSrc, alt: 'tango picture', title: 'A title' } },
      para(t('last uniform')),
    ],
  };
}

export const FULL_MARKDOWN = `# Heading one alpha
## Heading two bravo
### Heading three charlie
#### Heading four victor

Plain delta **bold echo** *italic foxtrot* ~~strike golf~~ \`code hotel\` [link india](https://example.com/x) <mailto:someone@example.com>  
after break kilo

\`\`\`js
const lima = 1;
\`\`\`

> quoted mike

- bullet november
- bullet two

3. numbered oscar

- [x] done papa
- [ ] todo quebec

---

| head romeo | head two |
|:-----------|---------:|
| cell sierra | |

![tango picture](https://example.com/t.png)

<span>raw whiskey</span>

last uniform
`;
