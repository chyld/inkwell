# Redesign brief: "Teal rail and paper"

The owner found the current layout too busy and chose mock-up 01 from
`drafts/redesign-mockups.html` (open it in a browser; the first frame, class
`m1`, is the one). This brief turns that picture into requirements. It changes
how the app looks and where things sit. It removes no feature, route, keyboard
shortcut or accessibility behaviour, and changes nothing on the server or in
the note schema.

Where this brief conflicts with earlier layout decisions (the Plum colour
scheme, the Sage toolbar bar, the two collapsible left panels, the title above
the toolbar), this brief wins. Flat colour only: no gradients anywhere.

## 1. Colour

Replace the Plum scheme and the Sage toolbar tokens with this palette, as
`:root` tokens. Light values are fixed; derive the dark values in the same
spirit (deep teal-black grounds, the paper a raised dark surface, coral kept
as the accent) and report them.

| Role | Light |
|---|---|
| App ground (behind list and editor) | `#f1f5f4` |
| Paper and cards | `#ffffff` |
| Text | `#17302d` |
| Soft text | `#5f7673` |
| Lines and borders | `#d5e0de` |
| Rail | `#0f5f5a` |
| Rail icons | `#cfe9e5` |
| Rail current item | paper background, rail-coloured icon |
| Accent (New button, selected card outline, checked boxes, focus ring, links) | `#ef6f53` |
| Toolbar pill | `#17302d`, icons and labels `#e7f1ef`, dividers `#3a5551`, pressed `#2f4c48` |

- Every text and icon pair meets WCAG AA in both themes; nudge a value
  minimally if one fails and report it. Coral on white is weak for small
  text: use it for fills, outlines and large elements, and use a darker coral
  for link text if needed.
- The eight text colours and eight highlights for notes (the Jewel palette)
  are unchanged, but must still pass their contrast checks on the new paper
  colour in both themes.
- Favicon, selection colour, `accent-color` and focus rings follow the new
  accent. Nothing purple or sage remains.

## 2. Layout on a wide screen

Left to right: **rail**, **list**, **editor**.

### 2.1 Rail (replaces the sidebar)

- A fixed column about 54 px wide in the rail colour, icons only, each with a
  tooltip and accessible name, the current one marked.
- Top group: All notes, Inbox, Folders, Tags. Bottom group: Fonts, Styles,
  Trash, and an account button.
- **Folders** opens a panel beside the rail holding everything the sidebar's
  folder area does today: the tree with counts, Unfiled, new folder, rename,
  move, delete, expand and collapse. **Tags** opens a panel with the tag list
  and counts. Choosing a folder or tag shows it in the list and closes the
  panel; Escape and a click outside close it; focus returns to the rail
  button. The panel sits over the list; it does not push the layout.
- The **account** button opens a small menu with the username, the storage
  line ("12 MB of 1 GB") and Sign out.
- The rail is always visible. The old sidebar collapse control goes away. The
  list keeps its collapse control and remembered state.

### 2.2 List

- On the app ground, about 290 px wide. At the top: the search box and a
  compact accent "New" button on one row; under it the name of the current
  view (All notes, a folder, a tag, Trash, search results).
- Each note is a white rounded card (12 px radius) with a small gap between
  cards: title and time on one line, one line of snippet, and the "by
  <agent>" mark where it applies. The selected card has a 2 px accent
  outline. Hover is a subtle border.
- Trash view, empty states, search highlighting, paging and the Empty Trash
  control keep working, restyled.

### 2.3 Editor

- On the app ground. From the top:
  1. One slim line: folder picker and tags on the left; created and updated
     dates, the save status and Move to Trash on the right. Soft text, small.
  2. The **toolbar**: one dark pill, centred, as wide as its content, with
     fully rounded ends. Same controls, order, dropdowns and behaviour as
     today's toolbar. When it cannot fit on one row it becomes a rounded
     rectangle (16 px radius) and wraps by section. The table tools, when
     shown, are a second smaller pill under it.
  3. The **paper**: a white sheet with rounded top corners (14 px) that runs
     to the bottom of the window, with generous side padding (about 60 px on
     a wide screen) and a comfortable text measure. The note's **title is the
     first thing on the paper**, large and bold (about 26 px), with the body
     under it; Enter in the title still moves to the body. The paper's
     content scrolls; the line and the toolbar above stay put.
- Banners (Trash, draft, conflict, save error) sit between the toolbar and
  the paper.
- The menus that open from the toolbar are light popovers on the paper
  colour with the accent for the current row.

## 3. Other screens

- `/fonts` and `/styles` take the place of the list and editor, on the app
  ground, with their cards and chips in the new palette; the rail stays, with
  the matching icon marked.
- Sign-in page, dialogs, the style form, confirmations, notices, the "note
  not found" state, image resize handles and the font and colour menus are
  restyled to the palette. No behaviour changes.

## 4. Phone width

- The rail becomes a bar along the bottom with the same icons (the folder and
  tag panels open as sheets from the bottom). List and editor remain separate
  screens with a Back control, as today.
- In the editor the paper fills the width with smaller padding, and the
  toolbar is a rounded rectangle that wraps by section. Nothing scrolls
  sideways. Touch targets stay at least 34 px.

## 5. Constraints

- Inter and JetBrains Mono stay. Lucide icons stay at 1.75 stroke; the
  toolbar's thinner stroke is dropped unless it looks better on the dark
  pill (decide and say).
- Every existing test keeps its meaning: update selectors and expected
  colours, do not delete coverage. Add tests for the rail, its panels, the
  account menu, the card list, the title on the paper, and the pill toolbar.
- Keyboard order: rail, list (search, New, cards), the slim line, toolbar,
  title, body.
- No inline styles, CSP unchanged, no new dependencies.
- `DEVIATIONS.md` records the redesign and which earlier rows it replaces.

## 6. Stages (one commit each, tests passing at each)

A. Tokens for both themes, the theme tests, and the rail with its Folders and
   Tags panels and the account menu.
B. The card list.
C. The editor: slim line, pill toolbar, paper with the title on it.
D. `/fonts`, `/styles`, sign-in, dialogs and menus, and the phone layout.
E. README and DEVIATIONS, then a browser check in light and dark at 1440,
   1280, 1024 and 390 px, with screenshots of each saved under
   `drafts/redesign-shots/` for the owner to look at.
